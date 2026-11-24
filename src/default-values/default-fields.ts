import { randomUUID } from "crypto";

/**
 * Registry of every "simple" default a company can set.
 * To add a new default: add one entry here (server) + one field in the page (UI).
 *   target "transaction" -> prefilled in the New Transaction form
 *   target "evalData"    -> written into the transaction's evalData when it is created
 */
export type FieldKind =
  | "text" | "textarea" | "number" | "date" | "enum" | "tri" | "multi" | "authors";

type Def = { kind: FieldKind; target: "transaction" | "evalData" };

const T = (kind: FieldKind): Def => ({ kind, target: "transaction" });
const E = (kind: FieldKind): Def => ({ kind, target: "evalData" });

export const DEFAULT_FIELDS: Record<string, Def> = {
  // transaction form
  assignmentDate: T("date"),
  valuationPurpose: T("enum"),
  intendedUse: T("text"),
  valuationBasis: T("enum"),
  ownershipType: T("enum"),
  valuationHypothesis: T("enum"),
  branch: T("enum"),

  // people & documents
  authorizedName: E("text"),
  otherUsers: E("text"),
  deedSource: E("text"),
  inspector: E("text"),
  contactNo: E("text"),
  reviewer: E("text"),

  // location & property
  regionId: E("enum"), regionName: E("text"),
  cityId: E("enum"), cityName: E("text"),
  neighborhoodId: E("enum"), neighborhoodName: E("text"),
  assetCategoryId: E("enum"),
  elevation: E("enum"),
  inspectionBoundaries: E("enum"),
  streetWidth: E("text"),
  streetFronts: E("enum"),
  authorizedLandCoverPct: E("number"),
  buildingConditionStatus: E("enum"), // -> evalData.buildingCondition.status
  finishLevel: E("enum"),
  buildQuality: E("enum"),
  electricity: E("tri"),              // -> evalData.availableServices.*
  sanitaryDrainage: E("tri"),
  telephoneLine: E("tri"),
  surroundingEnvironment: E("multi"),

  // valuation parameters
  managementPct: E("number"),
  professionalPct: E("number"),
  utilityNetworkPct: E("number"),
  emergencyPct: E("number"),
  financePct: E("number"),
  yearDev: E("number"),
  earningsRate: E("number"),
  defaultAge: E("number"),
  economicPct: E("number"),
  careerPct: E("number"),
  evalDate: E("date"),       // also copied into evalData.appraiserData
  completedDate: E("date"),
  reportDate: E("date"),

  // report
  standards: E("textarea"),
  scope: E("textarea"),
  assumptions: E("textarea"),
  risks: E("textarea"),
  reportAuthors: E("authors"), // -> evalData.authorEntries
};

const SERVICE_KEYS = ["electricity", "sanitaryDrainage", "telephoneLine"] as const;
const APPRAISER_DATES = ["evalDate", "completedDate", "reportDate"];

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Keep only known keys with correctly-shaped values. */
export function sanitizeValues(raw: unknown): Record<string, unknown> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, def] of Object.entries(DEFAULT_FIELDS)) {
    const v = src[key];
    if (v === undefined || v === null) continue;

    switch (def.kind) {
      case "text": { const s = str(v, 200); if (s) out[key] = s; break; }
      case "textarea": { const s = str(v, 4000); if (s) out[key] = s; break; }
      case "enum": { const s = str(v, 60); if (s) out[key] = s; break; }
      case "number": {
        const s = str(v, 12);
        if (/^-?\d+(\.\d+)?$/.test(s)) out[key] = s;
        break;
      }
      case "date": if (v === "today") out[key] = "today"; break;
      case "tri": if (v === "yes" || v === "no") out[key] = v; break;
      case "multi": {
        if (Array.isArray(v)) {
          const list = v.map((x) => str(x, 40)).filter(Boolean).slice(0, 20);
          if (list.length) out[key] = list;
        }
        break;
      }
      case "authors": {
        if (Array.isArray(v)) {
          const list = v
            .map((a: any) => ({ signatoryId: str(a?.signatoryId, 60), title: str(a?.title, 200) }))
            .filter((a) => a.signatoryId || a.title)
            .slice(0, 10);
          if (list.length) out[key] = list;
        }
        break;
      }
    }
  }
  return out;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Turn stored defaults into ready-to-use values ("today" -> real date). */
export function buildResolved(values: Record<string, unknown>, today: Date) {
  const transaction: Record<string, string> = {};
  const evalData: Record<string, unknown> = {};
  const services: Record<string, boolean | null> = {
    electricity: null, electricityUnits: null, sanitaryDrainage: null,
    telephoneLine: null, waterMetersCount: null, electricityMetersCount: null,
  };
  let hasServices = false;
  const appraiserData: Record<string, string> = {};

  for (const [key, v] of Object.entries(values)) {
    const def = DEFAULT_FIELDS[key];
    if (!def) continue;

    if (def.target === "transaction") {
      transaction[key] = def.kind === "date" ? iso(today) : String(v);
      continue;
    }

    if ((SERVICE_KEYS as readonly string[]).includes(key)) {
      services[key] = v === "yes";
      hasServices = true;
    } else if (key === "buildingConditionStatus") {
      evalData.buildingCondition = { status: String(v), completionPct: null, otherText: "" };
    } else if (key === "reportAuthors") {
      evalData.authorEntries = (v as { signatoryId: string; title: string }[]).map((a) => ({
        id: randomUUID(), signatoryId: a.signatoryId, title: a.title,
      }));
    } else if (def.kind === "date") {
      evalData[key] = iso(today);
      if (APPRAISER_DATES.includes(key)) appraiserData[key] = iso(today);
    } else {
      evalData[key] = v;
    }
  }

  if (hasServices) evalData.availableServices = services;
  if (Object.keys(appraiserData).length) evalData.appraiserData = appraiserData;
  return { transaction, evalData };
}
