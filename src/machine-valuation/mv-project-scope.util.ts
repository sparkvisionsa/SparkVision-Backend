import { ObjectId } from "mongodb";
import { tryParseObjectId } from "@/common/object-id.util";
import type { MvProjectDoc } from "./types";

/** المشروع مرتبط بهذه الشركة عبر الحقل `companyId` (ObjectId أو نص hex مطابق). */
export function mvProjectSharesCompany(project: MvProjectDoc, companyOid: ObjectId): boolean {
  const c = project.companyId;
  if (c === undefined || c === null) return false;
  if (c === "") return false;
  if (c instanceof ObjectId) return c.equals(companyOid);
  const s = String(c).trim();
  if (!s) return false;
  const parsed = tryParseObjectId(s);
  if (parsed && parsed.equals(companyOid)) return true;
  return s === companyOid.toString();
}
