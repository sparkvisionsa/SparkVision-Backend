/** ثوابت الاستيراد والتحقق من نوع الملف — بلا تعريفات حقول/أنواع أصول (أعمدة Excel كما هي). */

export const MAX_COLUMN_SCAN_ROWS = 100;
export const LEGACY_XLS_SIGNATURE = "D0CF11E0A1B11AE1";

/** حد رفع الملف — جداول كبيرة (آلاف الصفوف) */
function envFileSizeBytes(name: string, fallbackMb: number) {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return Math.round(mb * 1024 * 1024);
}

export const ASSET_IMPORT_MAX_FILE_BYTES = envFileSizeBytes("ASSET_IMPORT_MAX_FILE_MB", 150);
export const VALUATION_EXCEL_MAX_FILE_BYTES = envFileSizeBytes("VALUATION_EXCEL_MAX_FILE_MB", 750);

/** أقصى عدد صفوف يُستورد في طلب واحد (حماية الذاكرة/الوقت) */
export const ASSET_IMPORT_MAX_TOTAL_ROWS = 200_000;

/** حجم دفعة الإدراج في MongoDB */
export const ASSET_IMPORT_INSERT_BATCH_SIZE = 1000;

export const MIME_TYPES_BY_EXTENSION: Record<string, Set<string>> = {
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    /** ملفات xlsx هي أرشيف ZIP */
    "application/zip",
  ]),
  xls: new Set(["application/vnd.ms-excel"]),
  csv: new Set([
    "text/csv",
    "application/csv",
    "text/plain",
    "application/vnd.ms-excel",
  ]),
};

/** أنواع MIME شائعة عندما لا يحدد المتصفح/النظام النوع بدقة (مع الاعتماد على الامتداد والتحقق من المحتوى) */
export const ASSET_IMPORT_PERMISSIVE_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-msdownload",
]);

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_TYPES_BY_EXTENSION));
export const SUPPORTED_MIME_TYPES = new Set(
  Object.values(MIME_TYPES_BY_EXTENSION).flatMap((mimeSet) => [...mimeSet]),
);
