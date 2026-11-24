/**
 * Shared by the Word and PowerPoint merges so both print what the system
 * report prints for the same project:
 * - company-level fallbacks (firm name, lead valuer and membership number)
 *   when the report data leaves them blank — the system report shows the
 *   company name / company manager in the same places;
 * - custom report fields (`field:<id>`), formatted by their type (dates and
 *   numbers exactly like the rest of the template).
 */
import { ObjectId } from "mongodb";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import { getMongoDb } from "@/server/mongodb";

export type ReportTemplateIdentity = {
  companyName: string;
  managerName: string;
  managerTitle: string;
  managerMembershipNo: string;
};

export const EMPTY_REPORT_TEMPLATE_IDENTITY: ReportTemplateIdentity = {
  companyName: "",
  managerName: "",
  managerTitle: "",
  managerMembershipNo: "",
};

const clean = (value: unknown, max = 220) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A person's display name: never a phone/login number. */
function personName(value: unknown): string {
  const name = clean(value, 200);
  if (!name || /[0-9٠-٩۰-۹]/.test(name)) return "";
  return /[A-Za-zÀ-ɏ؀-ۿ]/.test(name) ? name : "";
}

function asObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  const text = typeof value === "string" ? value.trim() : value != null ? String(value) : "";
  return ObjectId.isValid(text) ? new ObjectId(text) : null;
}

/** Company name and company manager, as printed on the system report. */
export async function loadReportTemplateIdentity(companyIdRaw: unknown): Promise<ReportTemplateIdentity> {
  const companyId = asObjectId(companyIdRaw);
  if (!companyId) return EMPTY_REPORT_TEMPLATE_IDENTITY;
  try {
    const db = await getMongoDb();
    const { companies, users, userCompanyMemberships } = getAuthCollections(db);
    const [company, managerMembership] = await Promise.all([
      companies.findOne({ _id: companyId }),
      userCompanyMemberships.findOne({ companyId, role: "company_admin" }),
    ]);
    const managerId = asObjectId(managerMembership?.userId ?? company?.adminUserId);
    const manager = managerId ? await users.findOne({ _id: managerId }) : null;
    return {
      companyName: clean(company?.name, 220),
      managerName: personName(manager?.valuationReportDisplayName) || personName(manager?.username),
      managerTitle: clean(manager?.valuationReportJobTitle, 200),
      managerMembershipNo: clean(manager?.valuationReportMembershipNo, 100),
    };
  } catch {
    return EMPTY_REPORT_TEMPLATE_IDENTITY;
  }
}

/** Fills the variables the report data left blank (never overrides typed data). */
export function applyReportTemplateIdentityFallbacks(
  values: Record<string, string>,
  identity: ReportTemplateIdentity,
  escape: (value: string) => string,
): void {
  const fill = (key: string, fallback: string) => {
    if (!String(values[key] ?? "").trim() && fallback.trim()) values[key] = escape(fallback);
  };
  fill("valuationFirmName", identity.companyName);
  fill("leadValuerName", identity.managerName);
  // The membership/title belong to the manager only when the manager is the
  // lead valuer printed on the report.
  const leadIsManager =
    !identity.managerName || String(values.leadValuerName ?? "").trim() === escape(identity.managerName);
  if (leadIsManager) {
    fill("leadValuerMembershipNo", identity.managerMembershipNo);
    fill("leadValuerTitle", identity.managerTitle);
  }
}

/** `field:<id>` values of the project's custom / model report fields. */
export function customFieldTemplateValues(
  reportData: Record<string, unknown>,
  normalizeKey: (value: unknown) => string,
  formatDate: (value: unknown) => string,
  escape: (value: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(reportData.customFields)) return out;
  for (const rawField of reportData.customFields.slice(0, 120)) {
    if (!rawField || typeof rawField !== "object") continue;
    const field = rawField as Record<string, unknown>;
    const key = normalizeKey(field.id);
    if (!key) continue;
    const raw = typeof field.value === "number" ? String(field.value) : typeof field.value === "string" ? field.value.trim() : "";
    // Dates print like every report date; other values exactly as typed
    // (same rule as the system template).
    const text = raw && field.type === "date" ? formatDate(raw) || raw : raw;
    out[key] = escape(text).slice(0, 50_000);
  }
  return out;
}
