import * as ExcelJS from "exceljs";
import type { ObjectId } from "mongodb";
import { LEGACY_XLS_SIGNATURE } from "./asset-import.constants";
import type { AssetDoc, AssetImportSummary, AssetPrimitive, AssetTypeCounter } from "./types";

export function createEmptyTypeCounter(): AssetTypeCounter {
  return {
    vehicles: 0,
    machinery: 0,
    electronics: 0,
    furniture: 0,
    other: 0,
  };
}

export function createImportSummary(totalSheets: number): AssetImportSummary {
  const warnings: string[] = [];
  return {
    totalSheets,
    totalRows: 0,
    byType: createEmptyTypeCounter(),
    warnings,
    sheets: [],
  };
}

export function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.trim().toLowerCase() ?? "";
}

/** ملفات ‎.xlsx‎ تبدأ بمقدمة ZIP ‎PK‎ */
export function isLikelyXlsxZipBuffer(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** ملف ‎.xls‎ الثنائي (OLE) */
export function isLikelyLegacyXlsBuffer(buffer: Buffer) {
  if (buffer.length < 8) return false;
  return buffer.subarray(0, 8).toString("hex").toUpperCase() === LEGACY_XLS_SIGNATURE;
}

export function isTextLikeBuffer(buffer: Buffer) {
  const sampleSize = Math.min(buffer.length, 512);
  if (sampleSize === 0) return false;

  let printable = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const code = buffer[index];
    if (
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 32 && code <= 126) ||
      code >= 160
    ) {
      printable += 1;
    }
  }

  return printable / sampleSize >= 0.75;
}

export function sanitizeTextInput(value: string) {
  return value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function toWesternDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (char) => String(char.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (char) => String(char.charCodeAt(0) - 1776))
    .replace(/٬/g, ",")
    .replace(/٫/g, ".");
}

export function normalizeLookupText(value: string) {
  return toWesternDigits(sanitizeTextInput(value).toLowerCase())
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[ى]/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function isEmptyPrimitive(value: AssetPrimitive | undefined) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return sanitizeTextInput(value).length === 0;
  return false;
}

export function isProbablyNumericText(value: string) {
  const normalized = toWesternDigits(value)
    .replace(/[,\s]/g, "")
    .replace(/٫/g, ".");
  return /^-?\d+(?:\.\d+)?$/.test(normalized);
}

function primitiveFromResultField(result: unknown): AssetPrimitive {
  if (result == null) return null;
  if (result instanceof Date) {
    return result.toISOString().split("T")[0] ?? null;
  }
  if (typeof result === "number") return Number.isFinite(result) ? result : null;
  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    const sanitized = sanitizeTextInput(result);
    return sanitized.length > 0 ? sanitized : null;
  }
  if (result && typeof result === "object" && "error" in result) {
    const errorValue = String((result as { error?: unknown }).error ?? "").trim();
    return errorValue.length > 0 ? errorValue : null;
  }
  return null;
}

/** قراءة القيمة من ‎cell.value‎؛ قد تُرجع ‎null‎ رغم وجود نص معروض في ‎cell.text‎ / نتيجة في ‎cell.result‎. */
function extractCellValueFromPayload(raw: ExcelJS.CellValue): AssetPrimitive {
  if (raw == null) return null;

  if (typeof raw === "string") {
    const sanitized = sanitizeTextInput(raw);
    return sanitized.length > 0 ? sanitized : null;
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  if (typeof raw === "boolean") return raw;

  if (raw instanceof Date) {
    return raw.toISOString().split("T")[0] ?? null;
  }

  if (typeof raw === "object") {
    /** نتيجة الصيغة في النموذج أولاً — تجنّب الاكتفاء بـ ‎value === null‎ مع وجود نتيجة محسوبة */
    if ("result" in raw && raw.result !== undefined && raw.result !== null) {
      const fromModel = primitiveFromResultField(raw.result);
      if (!isEmptyPrimitive(fromModel)) return fromModel;
    }

    if ("text" in raw && typeof raw.text === "string") {
      const sanitized = sanitizeTextInput(raw.text);
      return sanitized.length > 0 ? sanitized : null;
    }

    if ("hyperlink" in raw && typeof raw.hyperlink === "string") {
      const text =
        "text" in raw && typeof raw.text === "string" ? raw.text : raw.hyperlink;
      const sanitized = sanitizeTextInput(text);
      return sanitized.length > 0 ? sanitized : null;
    }

    if ("richText" in raw && Array.isArray(raw.richText)) {
      const text = raw.richText
        .map((item) => ("text" in item && typeof item.text === "string" ? item.text : ""))
        .join(" ");
      const sanitized = sanitizeTextInput(text);
      return sanitized.length > 0 ? sanitized : null;
    }

    if ("formula" in raw && typeof raw.formula === "string") {
      const sanitized = sanitizeTextInput(`=${raw.formula}`);
      return sanitized.length > 0 ? sanitized : null;
    }
  }

  const fallback = sanitizeTextInput(String(raw));
  return fallback.length > 0 ? fallback : null;
}

export function extractCellValue(cell: ExcelJS.Cell): AssetPrimitive {
  let value = extractCellValueFromPayload(cell.value);

  if (isEmptyPrimitive(value)) {
    value = primitiveFromResultField(cell.result);
  }

  if (isEmptyPrimitive(value)) {
    const fromText = sanitizeTextInput(cell.text ?? "");
    value = fromText.length > 0 ? fromText : null;
  }

  return value;
}

export function parseNumberValue(value: AssetPrimitive): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") return undefined;

  const normalized = toWesternDigits(value)
    .replace(/[,\s]/g, "")
    .replace(/٫/g, ".");
  if (!normalized) return undefined;

  if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  const matched = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return undefined;

  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseBooleanValue(value: AssetPrimitive): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") return undefined;

  const normalized = normalizeLookupText(value);
  if (!normalized) return undefined;

  if (
    ["نعم", "yes", "true", "1", "موجود", "مكتمل", "complete"].includes(normalized)
  ) {
    return true;
  }

  if (
    ["لا", "no", "false", "0", "غير موجود", "غير مكتمل", "incomplete"].includes(
      normalized,
    )
  ) {
    return false;
  }

  return undefined;
}

function excelSerialToIsoDate(serial: number) {
  const epoch = Date.UTC(1899, 11, 30);
  const utcTime = epoch + serial * 24 * 60 * 60 * 1000;
  const date = new Date(utcTime);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().split("T")[0];
}

export function parseDateValue(value: AssetPrimitive): string | undefined {
  if (typeof value === "number") {
    if (value > 0 && value < 60000) {
      return excelSerialToIsoDate(value);
    }
    return undefined;
  }
  if (typeof value !== "string") return undefined;

  const sanitized = sanitizeTextInput(value);
  if (!sanitized) return undefined;

  const forParsing = toWesternDigits(sanitized);
  /**
   * تجنّب اعتبار الأرقام النصية تواريخاً: ‎`new Date("45000")`‎ و‎`new Date("100")`‎
   * يعيدان تواريخاً صالحة (سنوات موسّعة) في محركات ‎JS‎، فيُحوَّل رقم مثل الكمية إلى تاريخ خاطئ.
   */
  if (isProbablyNumericText(forParsing)) {
    return undefined;
  }

  const parsed = new Date(forParsing);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }
  return undefined;
}

export function parseStringValue(value: AssetPrimitive): string | undefined {
  if (typeof value === "string") {
    const sanitized = sanitizeTextInput(value);
    return sanitized.length > 0 ? sanitized : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function ensureUniqueHeader(
  rawHeader: string,
  columnNumber: number,
  usedHeaders: Set<string>,
) {
  const baseHeader = sanitizeTextInput(rawHeader) || `عمود ${columnNumber}`;
  let candidate = baseHeader;
  let suffix = 2;

  while (usedHeaders.has(candidate)) {
    candidate = `${baseHeader} (${suffix})`;
    suffix += 1;
  }

  usedHeaders.add(candidate);
  return candidate;
}

/**
 * حقول مجلد المعاينة (موحّدة مع ‎assets‎) على صف الاستيراد — قيم null/فارغة لتوحيد شكل الوثيقة في MongoDB.
 * يُستعمل في ‎$set‎ بعد الإدراج لضمان بقاء المفاتيح حتى لو عامل الإدراج أهمل بعضها.
 */
export function emptyMvPhotoFieldsForImportedAssetRow(opts?: {
  createdBy?: ObjectId | null;
  createdAt?: Date | null;
}): Pick<
  AssetDoc,
  | "isAssetFolder"
  | "parent"
  | "createdAt"
  | "writtenDescription"
  | "condition"
  | "brand"
  | "code"
  | "model"
  | "manufactureYear"
  | "kilometersDriven"
  | "isPresent"
  | "isDone"
  | "createdBy"
  | "images"
  | "voiceNotes"
> {
  return {
    isAssetFolder: null,
    parent: null,
    createdAt: opts?.createdAt ?? null,
    writtenDescription: null,
    condition: null,
    brand: null,
    code: null,
    model: null,
    manufactureYear: null,
    kilometersDriven: null,
    isPresent: null,
    /** صفوف الاستيراد/الجدول: مكتمل افتراضياً؛ مجلدات المعاينة تُعيَّن لاحقاً عبر ‎MV‎ */
    isDone: true,
    createdBy: opts?.createdBy ?? null,
    images: [],
    voiceNotes: [],
  };
}
