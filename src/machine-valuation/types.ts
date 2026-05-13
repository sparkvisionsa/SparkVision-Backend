import type { ObjectId, WithId } from "mongodb";
import type { AssetDoc, AssetType } from "@/assets/types";

export type MvColumnFormatKind =
  | "general"
  | "number"
  | "currency"
  | "percent"
  | "date";

export type MvCellFontFamily =
  | "default"
  | "sans"
  | "display"
  | "serif"
  | "mono";

export type MvCellTextAlign = "start" | "center" | "end";

export interface MvCellStyle {
  backgroundColor?: string;
  textColor?: string;
  fontSize?: number;
  fontFamily?: MvCellFontFamily;
  fontWeight?: "normal" | "bold";
  textAlign?: MvCellTextAlign;
}

export interface MvSpreadsheetMeta {
  columnFormats?: MvColumnFormatKind[];
  columnWidths?: number[];
  frozenCols?: number;
  cellStyles?: (MvCellStyle | null)[][];
}

/** حالة سير المشروع (تحديث يدوي): جديد ← مراجعة ← معتمدة */
export const MV_PROJECT_WORKFLOW_STATUSES = ["new", "review", "approved"] as const;
export type MvProjectWorkflowStatus = (typeof MV_PROJECT_WORKFLOW_STATUSES)[number];

export const MV_PROJECT_REPORT_TYPES = ["simple", "advanced"] as const;
export type MvProjectReportType = (typeof MV_PROJECT_REPORT_TYPES)[number];

export interface MvProjectReportData {
  valuationMethod?: string;
  valuationPurpose?: string;
  valuePremise?: string;
  includeAssetImages?: boolean;
  includeValuationAccountImages?: boolean;
  reportIssueDate?: string;
  /** تاريخ اتفاقية نطاق العمل */
  agreementDate?: string;
  inspectionDate?: string;
  valuationDate?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  importantAssumptions?: string;
  specialAssumptions?: string;
  finalValue?: number | null;
  finalValueWords?: string;
  /** مسودة: علامة مائية وإخفاء صور التوقيع في رأي القيمة */
  reportPresentationDraft?: boolean;
  /** HTML — مستندات مستلمة من العميل */
  receivedClientDocumentsHtml?: string;
  /** HTML — شهادة التسجيل في بوابة «تقييم» */
  sceRegistrationCertificateHtml?: string;
}

export interface MvProjectLocation {
  region: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  mapUrl?: string;
}

export type MvProjectContactType = "primary" | "secondary";

export interface MvProjectContact {
  type: MvProjectContactType;
  phone: string;
}

/** نوع منطقي لملف المعاين (للواجهة والتصفية) */
export type MvInspectorLogicalFileType =
  | "pdf"
  | "excel"
  | "word"
  | "image"
  | "video"
  | "audio"
  | "other";

export type MvInspectorStorageKind = "digitalocean" | "gridfs" | "external";

/** عنصر ملف معاين في `mv_projects.inspectorFiles` — التخزين الجديد على DigitalOcean Spaces. */
export interface MvInspectorFileDoc {
  id: string;
  name: string;
  type: MvInspectorLogicalFileType;
  /** رابط الكائن في Spaces أو مسار API للمعاينة والتنزيل. */
  url: string;
  uploadedBy: string | null;
  createdAt: Date;
  storage?: MvInspectorStorageKind;
  spacesKey?: string;
  sizeBytes?: number;
  /** Legacy files only. New inspector uploads go to DigitalOcean Spaces. */
  gridFsFileId?: ObjectId | string;
  mimeType?: string;
}

/** حقول مشروع MV في `mv_projects` — بدون `_id`؛ يُولَّد تلقائياً في Atlas عند الإدراج. */
export interface MvProjectDoc {
  name: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * منشئ المشروع — نفس `users._id` (يفضّل ObjectId في BSON).
   * قد يُخزَّن كنص hex في بيانات قديمة أو يدوية.
   */
  userId?: ObjectId | string;
  /** FK إلى `companies._id` — مشروع واحد لشركة واحدة؛ ObjectId أو نص hex نادراً. */
  companyId?: ObjectId | string;
  /** اختياري؛ المستندات القديمة تُعامل كـ `new` */
  workflowStatus?: MvProjectWorkflowStatus;
  /** نوع مسار التقرير: مبسط حالياً، ومتقدم لاحقاً. */
  reportType?: MvProjectReportType;
  /** بيانات التقرير التي تُملأ من كارد "بيانات التقرير". */
  reportData?: MvProjectReportData;
  locations?: MvProjectLocation[];
  contacts?: MvProjectContact[];
  /** ملفات معاينة المشروع المخزنة على DigitalOcean Spaces مع بيانات وصفية. */
  inspectorFiles?: MvInspectorFileDoc[];
  /**
   * حالة واجهة «إجراءات التقييم» (مسار النظام): مصادر Excel/PDF/صورة + اقتطاعات — بيانات وصفية فقط (بدون dataUrl).
   * الملفات الثنائية: يُفضَّل DigitalOcean Spaces (مع ‎spacesKey‎ في ‎fs.files‎) عند التهيئة؛ وإلا GridFS.
   */
  valuationAccountingWorkspace?: unknown;
  /**
   * حالة مسار «إكسيل جاهز»: نتيجة الاستيراد + صور مقتطعة من الجدول (مرجع ملفات) + شريحة التقرير.
   */
  valuationReadyExcelWorkspace?: unknown;
}

export type MvProjectMongoDoc = WithId<MvProjectDoc>;

/** Scope for MV APIs: tenant users see only their company’s projects; super_admin may see all. */
export interface MvAccessContext {
  userId: string | null;
  companyId: string | null;
  isSuperAdmin: boolean;
  /** من ‎`users.role`‎ — يُستعمل لتقييد عرض المجلدات (مثلاً ‎`inspector`‎) */
  userRole: string | null;
}

/**
 * مجلد فرعي فقط — هيكل شجرة الملفات في ‎`mv_subprojects`‎.
 * ‎`parent`‎: معرّف المجلد الأب؛ ‎`null`‎ عند جذر المشروع (مثل المجلدات الافتراضية غير ‎2.صور المعاينة‎).
 * مجلدات أصول الصور (مولّدة أو يدويًا) تُخزَّن في مجموعة ‎`assets`‎ مع ‎`isAssetFolder: true`‎.
 */
export interface MvSubProjectDoc {
  projectId: ObjectId;
  parent?: ObjectId | null;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * شكل حقول مجلد صور المعاينة عند الإدراج (بدون حقول استيراد Excel الإلزامية).
 * التخزين الفعلي: مجموعة ‎`assets`‎ مع ‎`isAssetFolder: true`‎.
 */
export interface PicAssetDoc {
  projectId: ObjectId;
  parent: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  isAssetFolder: true;
  writtenDescription: string | null;
  condition: string | null;
  assetType: AssetType;
  brand: string | null;
  code: string | null;
  model: string | null;
  manufactureYear: number | string | null;
  kilometersDriven: number | string | null;
  isPresent: boolean;
  createdBy: ObjectId | null;
  /** معرّفات GridFS ‎(ObjectId)‎ أو كائنات صور خارجية ‎(url, publicId, …)‎ */
  images: unknown[];
  voiceNotes: ObjectId[] | unknown[];
  isDone: boolean;
}

/** وثيقة مجلد صور في ‎`assets`‎ */
export type PicAssetMongoDoc = AssetDoc;

/** تحديث بيانات مجلد صور المعاينة (PATCH) */
export type PicAssetPatch = Partial<{
  writtenDescription: string | null;
  condition: string | null;
  assetType: AssetType;
  brand: string | null;
  code: string | null;
  model: string | null;
  manufactureYear: number | null;
  kilometersDriven: number | null;
  isPresent: boolean;
  isDone: boolean;
  /** معرّفات GridFS أو مصفوفة كائنات وسائط خارجية ‎(لإعادة الترتيب/الحذف)‎ */
  images: string[] | unknown[];
  voiceNotes: string[] | unknown[];
}>;

/** @deprecated استخدم ‎PicAssetPatch‎ */
export type MvSubProjectAssetPatch = PicAssetPatch;

export type MvSubProjectMongoDoc = WithId<MvSubProjectDoc>;

/**
 * وثيقة ‎2.صور المعاينة‎ (الجذر) — نفس شكل ‎`MvSubProjectDoc`‎ لكن تُخزَّن في ‎`items`‎.
 */
export type MvItemDoc = MvSubProjectDoc;

export interface MvStoredFileMetadata {
  projectId: ObjectId;
  subProjectId?: ObjectId;
  /** مجلد صور معاينة في ‎`assets`‎ (بلا ‎`mv_subprojects`‎) */
  picAssetId?: ObjectId;
  /** نطاق الملف داخل واجهة المشروع، مثل صور الأصول. */
  scope?: string;
  /** مسار الملف النسبي كما رفعه المستخدم عند رفع مجلدات/صور. */
  relativePath?: string;
  /** مسار المجلد النسبي بدون اسم الملف؛ فارغ يعني جذر صور الأصول. */
  folderPath?: string;
  /** ترتيب العرض داخل المجلد (صور الأصول). */
  displayOrder?: number;
  /** يحدد هل تظهر الصورة داخل إعداد/تصدير التقرير. القيمة الافتراضية true للملفات القديمة. */
  includeInReport?: boolean;
  mimeType?: string;
  extension?: string;
  originalFileName?: string;
  sourceUrl?: string;
  updatedAt?: Date;
  /** معرف عنصر `inspectorFiles[].id` عند ‎scope ===‎ ‎mv-inspector‎ */
  inspectorEntryId?: string;
  /**
   * الملف الثنائي على DigitalOcean Spaces (بدون أجزاء GridFS).
   * عند التعيين مع ‎spacesKey‎ يُستَرَد المحتوى من S3 وليس من ‎openDownloadStream‎.
   */
  storage?: "digitalocean" | "gridfs";
  spacesKey?: string;
}

export interface MvSheetDoc {
  projectId: ObjectId;
  subProjectId?: ObjectId;
  name: string;
  headers: string[];
  /** Compact row storage (preferred; avoids duplicate header keys per cell in BSON) */
  rowValues?: (string | number | null)[][];
  /** Legacy documents only */
  rows?: Record<string, string | number | null>[];
  sourceType: "file-import" | "manual";
  sourceFileName?: string;
  spreadsheetMeta?: MvSpreadsheetMeta;
  createdAt: Date;
  updatedAt: Date;
}

export type MvSheetMongoDoc = WithId<MvSheetDoc>;

export interface MvHeaderOptionDoc {
  name: string;
  userId?: string;
}

export type MvHeaderOptionMongoDoc = WithId<MvHeaderOptionDoc>;

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, string | number | null>[];
  spreadsheetMeta?: MvSpreadsheetMeta;
}

export interface ParsedFileResult {
  sheets: ParsedSheet[];
  sourceFileName: string;
}
