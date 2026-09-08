// ─── build-report-data.ts ───────────────────────────────────────────────────
// Pure function: TransactionDoc + evalData + media + signatories -> ReportData.
// No I/O here — the service does fetching/file-reading, this just shapes data.

import {
  VALUATION_PURPOSES,
  VALUATION_BASES,
  OWNERSHIP_TYPES,
  VALUATION_HYPOTHESES,
  PROPERTY_TYPES,
  SURROUNDING_ENV_LABELS,
  resolve,
} from "./label-maps";
import type {
  ReportData,
  ReportImage,
  PdfAttachment,
  ImageAttachment,
  OtherAttachment,
  ComparisonRow,
  BoundaryRow,
  AuthorSignature,
  InvestmentApproach,
} from "./report-types";

const COMPANY_NAME = "Spark Vision";
const COMPANY_NAME_AR = "سبارك فيجن للتقييم العقاري";

// One entry per possible signatory, keyed by their id. Built by the service
// from the company's `users` (valuationReportDisplayName/JobTitle/
// MembershipNo) and `reportOnlySignatories` arrays — see
// transactions-pdf-html.service.ts's buildSignatoryMap().
export type SignatoryInfo = {
  name: string;
  jobTitle: string;
  membershipNo: string;
  signatureImageDataUrl: string | null;
};
export type SignatoryMap = Map<string, SignatoryInfo>;

function n(v: unknown): number {
  const s = String(v ?? "").replace(/,/g, "").trim();
  const f = parseFloat(s);
  return Number.isFinite(f) ? f : 0;
}

// Always renders plain Western-Arabic numerals (0-9), regardless of the
// current locale/runtime — using "en-US" explicitly avoids Node ever
// substituting Eastern-Arabic digits (٠١٢...) when ICU/locale defaults
// differ between environments. The template also has a CSS-level guard
// (font-feature-settings: "locl" 0) in case the Arabic webfont tries to
// re-shape digits via the `locl` OpenType feature.
function fmt(v: unknown, digits = 2): string {
  const f = n(v);
  if (!f) return "—";
  return f.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function pick(...vals: (string | undefined | null)[]): string {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return "—";
}

// Very small best-effort Arabic number-to-words for the "written amount"
// line. Real projects usually want a dedicated tafqeet library (e.g.
// `tafqeet` on npm) — wired in as a TODO.
function spellOutSar(amount: number): string {
  if (!amount) return "—";
  // TODO: replace with a proper Arabic number-to-words (tafqeet) library.
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })} ريال سعودي`;
}

function computeSettlementNetMeter(
  compRows: any[],
  section1Rows: any[],
  settlementRows: any[],
  bases: string[],
  weights: string[],
): number {
  const activeComps = compRows
    .map((r, i) => ({ row: r, originalIndex: i }))
    .filter(({ row }) => row.inReport !== false);
  const count = activeComps.length;
  if (!count) return 0;

  const getBase = (c: number) => {
    const origIdx = activeComps[c]?.originalIndex ?? c;
    const stored = bases[origIdx];
    return stored !== undefined && stored !== "" ? stored : (compRows[origIdx]?.price ?? "");
  };

  const effectiveBases = Array.from({ length: count }, (_, c) => n(getBase(c)));

  const s1AdjAmounts = Array.from({ length: count }, (_, c) => {
    const base = effectiveBases[c];
    return (section1Rows || [])
      .filter((r) => r.inReport !== false)
      .reduce((sum, r) => {
        const origIdx = activeComps[c]?.originalIndex ?? c;
        const adj = (r.colAdj || [])[origIdx] ?? "";
        return sum + base * (n(adj) / 100);
      }, 0);
  });

  const priceAfterS1 = Array.from({ length: count }, (_, c) =>
    effectiveBases[c] ? effectiveBases[c] + s1AdjAmounts[c] : 0,
  );

  const s2AdjAmounts = Array.from({ length: count }, (_, c) => {
    const base = priceAfterS1[c];
    return (settlementRows || [])
      .filter((r) => r.inReport !== false)
      .reduce((sum, r) => {
        const origIdx = activeComps[c]?.originalIndex ?? c;
        const adj = (r.colAdj || [])[origIdx] ?? "";
        return sum + base * (n(adj) / 100);
      }, 0);
  });

  const priceAfterAll = Array.from({ length: count }, (_, c) => priceAfterS1[c] + s2AdjAmounts[c]);

  const totalWeight = Array.from({ length: count }, (_, c) => {
    const origIdx = activeComps[c]?.originalIndex ?? c;
    return n(weights[origIdx]);
  }).reduce((s, v) => s + v, 0);

  if (Math.abs(totalWeight - 100) > 0.5) return 0;

  return Array.from({ length: count }, (_, c) => {
    const origIdx = activeComps[c]?.originalIndex ?? c;
    return priceAfterAll[c] * (n(weights[origIdx]) / 100);
  }).reduce((s, v) => s + v, 0);
}

// Mirrors the exact math the wizard's Investment/Rental Value tabs use to
// compute "Property Value" (investmentTotal in TransactionEvaluationPage):
// NOI / capRate, where NOI = (sum of capitalized line income) - vacancy - maintenance.
function computeCapRateValue(entry: any): number {
  const lines = entry?.lines ?? [];
  const capIncludedIncome = lines
    .filter((l: any) => l?.inCapitalization !== false)
    .reduce(
      (s: number, l: any) =>
        s + n(l.space) * n(l.value) * (l?.multiplier !== undefined ? n(l.multiplier) || 1 : 1),
      0,
    );
  const vacancyAmt = capIncludedIncome * (n(entry?.vacancyRate) / 100);
  const effectiveIncome = capIncludedIncome - vacancyAmt;
  const maintenanceAmt = effectiveIncome * (n(entry?.maintenanceRate) / 100);
  const noi = effectiveIncome - maintenanceAmt;
  const capRate = n(entry?.capitalizationRate);
  return capRate > 0 ? noi / (capRate / 100) : 0;
}

// Pulls the "market extraction" comparables (entry.marketComps) out of each
// investment/rental entry — same table the wizard shows under "تحليل معدل
// الرسملة" — so the appraiser's cap-rate justification actually makes it
// into the PDF instead of only the resulting number.
function collectMarketComps(
  entries: any[],
  defaultLabelPrefix: string,
): InvestmentApproach["marketComps"] {
  const out: InvestmentApproach["marketComps"] = [];
  entries.forEach((entry: any, i: number) => {
    const entryTitle = entry?.title || `${defaultLabelPrefix} ${i + 1}`;
    (entry?.marketComps ?? []).forEach((c: any) => {
      const income = n(c.income);
      const propertyValue = n(c.propertyValue);
      const capRate = income > 0 && propertyValue > 0 ? (income / propertyValue) * 100 : 0;
      out.push({
        entryTitle,
        title: c.title || "—",
        income: income > 0 ? fmt(income) : "—",
        propertyValue: propertyValue > 0 ? fmt(propertyValue) : "—",
        capRate: capRate > 0 ? `${capRate.toFixed(2)}%` : "—",
        notes: c.notes || "—",
      });
    });
  });
  return out;
}

function buildInvestmentApproach(ev: any): InvestmentApproach {
  const rows: { label: string; value: string }[] = [];

  (ev.investmentEntries || []).forEach((entry: any, i: number) => {
    const val = computeCapRateValue(entry);
    rows.push({
      label: entry?.title || `استثمار ${i + 1}`,
      value: val > 0 ? fmt(val) : "—",
    });
  });

  (ev.rentalValueEntries || []).forEach((entry: any, i: number) => {
    const val = computeCapRateValue(entry);
    rows.push({
      label: entry?.title || `القيمة الإيجارية ${i + 1}`,
      value: val > 0 ? fmt(val) : "—",
    });
  });

  (ev.residualValueEntries || []).forEach((entry: any, i: number) => {
    const typeLabel =
      entry?.rvlId === "1" ? "أرض تطويرية" : entry?.rvlId === "2" ? "مبنى" : "—";
    rows.push({
      label: `القيمة المتبقية ${i + 1} (${typeLabel})`,
      value: entry?.landSpace ? `${fmt(entry.landSpace, 2)} م²` : "—",
    });
  });

  (ev.dcfEntries || []).forEach((entry: any, i: number) => {
    const meta = [entry?.num ? `${entry.num} سنة` : null, entry?.date || null]
      .filter(Boolean)
      .join(" — ");
    rows.push({
      label: entry?.title || `تدفقات نقدية مخصومة ${i + 1}`,
      value: meta || "—",
    });
  });

  const marketComps = [
    ...collectMarketComps(ev.investmentEntries || [], "استثمار"),
    ...collectMarketComps(ev.rentalValueEntries || [], "القيمة الإيجارية"),
  ];

  const computedTotal =
    (ev.investmentEntries || []).reduce((s: number, e: any) => s + computeCapRateValue(e), 0) +
    (ev.rentalValueEntries || []).reduce((s: number, e: any) => s + computeCapRateValue(e), 0);

  const used = rows.length > 0 || n(ev.incomeTotal) > 0;
  return {
    used,
    rows,
    total: fmt(n(ev.incomeTotal) || computedTotal),
    marketComps,
  };
}

// Resolves an authorEntry's signatoryId against the company's signatory
// records. Falls back gracefully to the job title / a blank membership
// number if the id isn't found (e.g. the signatory was later deleted) —
// this must never throw, since a missing lookup is a display-quality issue,
// not a reason to fail PDF generation.
function resolveSignatory(
  signatoryId: string | undefined,
  fallbackTitle: string,
  signatories: SignatoryMap,
): AuthorSignature {
  const info = signatoryId ? signatories.get(signatoryId) : undefined;
  return {
    name: info?.name ?? "—",
    title: info?.jobTitle || fallbackTitle || "—",
    membership: info?.membershipNo ?? "—",
    signatureImageDataUrl: info?.signatureImageDataUrl ?? null,
  };
}

export function buildReportData(
  tx: any, // TransactionDoc (parent-level fields)
  ev: any, // tx.evalData
  media: {
    images: ReportImage[];
    pdfAttachments: PdfAttachment[];
    imageAttachments: ImageAttachment[];
    otherAttachments: OtherAttachment[];
    mapImageDataUri?: string | null;
  },
  signatories: SignatoryMap,
): ReportData {
  // ── comparisons ──
  const comparisons: ComparisonRow[] = (ev.comparisonRows || [])
    .filter((r: any) => r.inReport !== false)
    .map((r: any) => ({
      evalDate: r.evalDate || "—",
      propertyType: resolve(PROPERTY_TYPES, r.propertyTypeId),
      comparisonKind: r.comparisonKind || "—",
      landSpace: fmt(r.landSpace),
      price: fmt(r.price),
      total: fmt(r.total || n(r.price) * n(r.landSpace)),
      description: r.description || "—",
      roads: r.roads || "—",
      street: r.street || "—",
      source: r.source || "—",
    }));

  const boundaries: BoundaryRow[] = [
    { side: "شمالي", description: ev.northBoundary || "—", length: ev.northLength ? `${ev.northLength} م` : "—" },
    { side: "جنوبي", description: ev.southBoundary || "—", length: ev.southLength ? `${ev.southLength} م` : "—" },
    { side: "شرقي", description: ev.eastBoundary || "—", length: ev.eastLength ? `${ev.eastLength} م` : "—" },
    { side: "غربي", description: ev.westBoundary || "—", length: ev.westLength ? `${ev.westLength} م` : "—" },
  ];

  const surroundingEnvironment: string[] = (ev.surroundingEnvironment || []).map(
    (k: string) => SURROUNDING_ENV_LABELS[k] ?? k,
  );

  // ── settlement / adjustments ──
  const activeComps = (ev.comparisonRows || []).filter((r: any) => r.inReport !== false);
  const settlementColumns = activeComps.map((r: any, i: number) => ({
    header: `المقارنة ${i + 1}`,
    base: fmt(ev.settlementBases?.[i] || r.price),
  }));
  const settlementRows = (ev.settlementRows || []).map((r: any) => ({
    title: r.title,
    colAdj: (r.colAdj || []).map((v: string) => (v ? `${v}%` : "—")),
  }));
  const netMeter = computeSettlementNetMeter(
    ev.comparisonRows || [],
    ev.section1Rows || [],
    ev.settlementRows || [],
    ev.settlementBases || [],
    ev.settlementWeights || [],
  );

  // ── replacement cost ──
  const replacementLines = (ev.replacementLines || [])
    .filter((l: any) => l.title || l.total)
    .map((l: any) => ({
      title: l.title || "—",
      space: fmt(l.space),
      unitPrice: fmt(l.unitPrice),
      total: fmt(l.total || n(l.space) * n(l.unitPrice)),
      notes: l.notes || "—",
    }));
  const totalArea = (ev.replacementLines || []).reduce((s: number, l: any) => s + n(l.space), 0);
  const netBuildings = n(ev.costNetBuildings) || 0;
  const netLandPrice = n(ev.costNetLandPrice) || n(ev.meterPriceLand) * n(ev.landSpace);
  const landBuildTotal = n(ev.costLandBuildTotal) || netBuildings + netLandPrice;

  // ── fair value / method weighting ──
  const marketTotal = n(ev.marketMethodTotal) || n(ev.marketMeterPrice) * n(ev.propertyAreaMethod || ev.propertyArea);
  const costTotal = landBuildTotal;
  const finalValue = n(ev.appraiserData?.finalAssetValue) || n(ev.finalAssetValue) || marketTotal || costTotal;

  const methodWeights = [
    { method: "أسلوب التكلفة", value: fmt(costTotal), weightPct: `${ev.appraiserData?.costWeight ?? "0"}%`, contribution: fmt((costTotal * n(ev.appraiserData?.costWeight)) / 100) },
    { method: "أسلوب السوق", value: fmt(marketTotal), weightPct: `${ev.appraiserData?.marketWeight ?? ev.marketWeightPct ?? "0"}%`, contribution: fmt((marketTotal * n(ev.appraiserData?.marketWeight ?? ev.marketWeightPct)) / 100) },
  ];

  // ── author signatures — resolved from the company's signatory records ──
  // authorEntry.title is a JOB TITLE ("مقيم أساسي زميل آلات ومعدات"), not a
  // person's name, and authorEntry.signatoryId is an internal id, not a
  // membership number. Both were previously displayed verbatim, which is
  // why the sign-off block looked wrong.
  const authorEntries = (ev.authorEntries || []).filter((a: any) => a?.title || a?.signatoryId);
  const authorSignatures: AuthorSignature[] = authorEntries.map((a: any) =>
    resolveSignatory(a.signatoryId, a.title, signatories),
  );

  const leadEntry = authorEntries[0];
  const leadSignatory = leadEntry?.signatoryId ? signatories.get(leadEntry.signatoryId) : undefined;

  const investmentApproach = buildInvestmentApproach(ev);

  return {
    companyName: COMPANY_NAME,
    companyNameAr: COMPANY_NAME_AR,
    reportNumber: tx.assignmentNumber || String(tx._id ?? ""),
    reportVersion: tx.reportVersion || "1.0",

    clientName: pick(ev.clientName, tx.clientName, tx.clientId),
    propertyTypeLabel: pick(ev.propertyType, resolve(PROPERTY_TYPES, ev.propertyTypeId)),
    cityLine: `${pick(ev.cityName)}، ${pick(ev.neighborhoodName)}`,
    evalDate: pick(ev.evalDate, ev.appraiserData?.evalDate),
    valuationPurposeLabel: resolve(VALUATION_PURPOSES, tx.valuationPurpose),
    valuationBasisLabel: resolve(VALUATION_BASES, tx.valuationBasis),
    appraiserName: leadSignatory?.name ?? pick(leadEntry?.title, "—"),
    appraiserMembershipNo: leadSignatory?.membershipNo ?? "—",

    reportAuthorName: pick(ev.reviewer, ev.inspector),
    // NB: the system has no dedicated appraiser "license number" field —
    // per product decision, the deed number is reused for this line.
    reportAuthorLicenseNo: pick(ev.deedNumber),
    inspectionDate: pick(ev.evalDate),
    reportDate: pick(ev.reportDate, ev.appraiserData?.reportDate),
    valuationHypothesisLabel: resolve(VALUATION_HYPOTHESES, tx.valuationHypothesis),
    approachesUsed: {
      market: !!ev.marketMeterPrice || comparisons.length > 0,
      income: n(ev.incomeTotal) > 0,
      cost: !!ev.costLandBuildTotal || replacementLines.length > 0,
      incomeCapitalization: investmentApproach.used,
      marketComparison: comparisons.length > 0,
      replacement: replacementLines.length > 0,
    },
    independenceStatement:
      "نقر بأن شركتنا لا يوجد لديها أي مصلحة خاصة بالعقار محل التقييم، ولا يوجد تضارب في المصالح مع أي طرف من الأطراف ذات العلاقة سواء في الوقت الحالي أو مستقبلًا.",

    city: pick(ev.cityName),
    neighborhood: pick(ev.neighborhoodName),
    parcelNumber: pick(ev.parcelNumber),
    deedNumber: pick(ev.deedNumber),
    ownerName: pick(ev.ownerName),
    propertyUse: pick(ev.landUse),
    boundaries,
    landSpace: fmt(ev.landSpace || ev.propertyArea),
    surroundingEnvironment,
    buildingLicenseNumber: pick(ev.buildingLicense),
    buildingLicenseDate: pick(ev.buildingLicenseDate),

    comparisons,
    fairValue: fmt(finalValue, 2),
    fairValueWritten: spellOutSar(finalValue),
    methodWeights,

    settlementColumns,
    settlementRows,
    settlementWeights: (ev.settlementWeights || []).map((w: string) => (w ? `${w}%` : "—")),
    netMeterPrice: fmt(netMeter),

    replacementLines,
    replacementSummary: {
      totalArea: fmt(totalArea),
      directTotal: fmt(ev.replacementLines?.reduce((s: number, l: any) => s + n(l.total), 0)),
      netBuildings: fmt(netBuildings),
      netLandPrice: fmt(netLandPrice),
      landBuildTotal: fmt(landBuildTotal),
      netMeterPrice: fmt(totalArea ? netBuildings / totalArea : 0),
    },

    investmentApproach,

    finalAssetValue: fmt(finalValue),
    appraiserDesc: pick(ev.appraiserDesc, ev.appraiserData?.appraiserDesc),
    appraiserNotes: pick(ev.appraiserNotes, ev.appraiserData?.appraiserNotes),
    standards: pick(ev.standards),
    scope: pick(ev.scope),
    assumptions: pick(ev.assumptions),
    risks: pick(ev.risks),

    inspectorName: pick(ev.inspector),
    preparerName: pick(ev.reviewer),
    preparerCategory: "أساسي",
    leadAppraiserName: leadSignatory?.name ?? pick(leadEntry?.title),
    leadAppraiserTitle: leadSignatory?.jobTitle ?? pick(leadEntry?.title),
    leadAppraiserMembership: leadSignatory?.membershipNo ?? "—",
    authorSignatures,

    assignmentDate: pick(tx.assignmentDate),
    lat: pick(ev.lat),
    lng: pick(ev.lng),
    buildingConditionLabel:
      { "10001": "جديد", "10002": "مستخدم", "10003": "تحت الإنشاء", "10004": "اخرى" }[
        ev.buildingCondition?.status as string
      ] ?? "—",
    buildingCompletionPct:
      ev.buildingCondition?.completionPct != null ? `${ev.buildingCondition.completionPct}%` : "—",
    finishLevelLabel:
      { "23": "تشطيب فاخر", "24": "تشطيب متوسط", "25": "تشطيب عادي", "10006": "بدون تشطيب" }[
        ev.finishLevel as string
      ] ?? "—",
    services: {
      electricity: ev.availableServices?.electricity ?? null,
      electricityMetersCount: ev.availableServices?.electricityMetersCount != null ? String(ev.availableServices.electricityMetersCount) : "0",
      sanitaryDrainage: ev.availableServices?.sanitaryDrainage ?? null,
      telephoneLine: ev.availableServices?.telephoneLine ?? null,
      water: ev.availableServices?.waterMetersCount != null ? true : null,
      waterMetersCount: ev.availableServices?.waterMetersCount != null ? String(ev.availableServices.waterMetersCount) : "0",
    },
    buildingBreakdown: [
      { label: "مساحة الأرض", area: fmt(ev.landSpace || ev.propertyArea), unitPrice: fmt(ev.marketMeterPrice), total: fmt(n(ev.landSpace || ev.propertyArea) * n(ev.marketMeterPrice)) },
      ...replacementLines.map((l: any) => ({ label: l.title, area: l.space, unitPrice: l.unitPrice, total: l.total })),
    ],
    totalBuiltArea: fmt(totalArea),

    leadAppraiserSignatureDataUrl: leadSignatory?.signatureImageDataUrl ?? null,
    mapImageDataUri: media.mapImageDataUri ?? null,

    images: media.images,
    pdfAttachments: media.pdfAttachments,
    imageAttachments: media.imageAttachments,
    otherAttachments: media.otherAttachments,
  };
}
