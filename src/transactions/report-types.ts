// ─── report-types.ts ────────────────────────────────────────────────────────
// Shape of the data report-template.ts renders. build-report-data.ts is
// responsible for resolving labels, merging tx/evalData/company-signatory
// fields, and formatting numbers/dates into this shape.

export type ReportImage = {
  dataUri: string; // data:image/...;base64,...
  name: string;
};

export type PdfAttachment = {
  name: string;
  bytes: Buffer; // raw PDF bytes, merged page-for-page
  pageCount?: number; // filled in at merge time
};

export type ImageAttachment = {
  dataUri: string;
  name: string;
};

export type OtherAttachment = {
  name: string;
  size: number;
  mimeType: string;
};

export type ComparisonRow = {
  evalDate: string;
  propertyType: string;
  comparisonKind: string;
  landSpace: string;
  price: string;
  total: string;
  description: string;
  roads: string;
  street: string;
  source: string;
};

export type BoundaryRow = {
  side: string;
  description: string;
  length: string;
};

export type SettlementColumn = {
  base: string;
  header: string;
};

export type SettlementAdjustmentRow = {
  title: string;
  colAdj: string[];
};

export type InvestmentApproach = {
  used: boolean;
  rows: { label: string; value: string }[];
  total: string;
  marketComps: {
    entryTitle: string;
    title: string;
    income: string;
    propertyValue: string;
    capRate: string;
    notes: string;
  }[];
};

// One row in the "المشاركون في إعداد التقرير" / sign-off section. name and
// membership are resolved from the company's signatory records (users +
// reportOnlySignatories), keyed by authorEntry.signatoryId — NOT copied
// from authorEntry.title, which is only ever a job title.
export type AuthorSignature = {
  name: string;
  title: string; // job title, e.g. "مقيم أساسي زميل آلات ومعدات"
  membership: string; // membership number, resolved from the signatory record
  signatureImageDataUrl: string | null;
};

export type ReportData = {
  companyName: string;
  companyNameAr: string;
  reportNumber: string;
  reportVersion?: string;

  // ── cover ──
  clientName: string;
  propertyTypeLabel: string;
  cityLine: string;
  evalDate: string;
  valuationPurposeLabel: string;
  valuationBasisLabel: string;
  appraiserName: string;
  appraiserMembershipNo: string;

  // ── scope of work ──
  reportAuthorName: string;
  reportAuthorLicenseNo: string;
  inspectionDate: string;
  reportDate: string;
  valuationHypothesisLabel: string;
  approachesUsed: {
    market: boolean;
    income: boolean;
    cost: boolean;
    incomeCapitalization: boolean;
    marketComparison: boolean;
    replacement: boolean;
  };
  independenceStatement: string;

  // ── property details ──
  city: string;
  neighborhood: string;
  parcelNumber: string;
  deedNumber: string;
  ownerName: string;
  propertyUse: string;
  boundaries: BoundaryRow[];
  landSpace: string;
  surroundingEnvironment: string[];
  buildingLicenseNumber: string;
  buildingLicenseDate: string;

  // ── market approach ──
  comparisons: ComparisonRow[];
  fairValue: string;
  fairValueWritten: string;
  methodWeights: { method: string; value: string; weightPct: string; contribution: string }[];

  // ── settlement / adjustments ──
  settlementColumns: SettlementColumn[];
  settlementRows: SettlementAdjustmentRow[];
  settlementWeights: string[];
  netMeterPrice: string;

  // ── replacement cost ──
  replacementLines: { title: string; space: string; unitPrice: string; total: string; notes: string }[];
  replacementSummary: {
    totalArea: string;
    directTotal: string;
    netBuildings: string;
    netLandPrice: string;
    landBuildTotal: string;
    netMeterPrice: string;
  };

  // ── investment approach (only rendered if investmentApproach.used) ──
  investmentApproach: InvestmentApproach;

  // ── appraiser opinion & report items ──
  finalAssetValue: string;
  appraiserDesc: string;
  appraiserNotes: string;
  standards: string;
  scope: string;
  assumptions: string;
  risks: string;

  // ── sign-off ──
  inspectorName: string;
  preparerName: string;
  preparerCategory: string;
  leadAppraiserName: string;
  leadAppraiserTitle: string;
  leadAppraiserMembership: string;

  // ── extra fields for the Taqdeer-style flow ──
  assignmentDate: string;
  lat: string;
  lng: string;
  buildingConditionLabel: string;
  buildingCompletionPct: string;
  finishLevelLabel: string;
  services: {
    electricity: boolean | null;
    electricityMetersCount: string;
    sanitaryDrainage: boolean | null;
    telephoneLine: boolean | null;
    water: boolean | null;
    waterMetersCount: string;
  };
  buildingBreakdown: { label: string; area: string; unitPrice: string; total: string }[];
  totalBuiltArea: string;

  // ── signature wiring ──
  // Resolved from the company's users + reportOnlySignatories, keyed by
  // signatoryId on each authorEntry.
  authorSignatures: AuthorSignature[];
  leadAppraiserSignatureDataUrl: string | null;

  // ── maps ──
  mapImageDataUri: string | null;

  // ── back matter ──
  images: ReportImage[];
  pdfAttachments: PdfAttachment[];
  imageAttachments: ImageAttachment[];
  otherAttachments: OtherAttachment[];
};
