import type { ObjectId } from "mongodb";

/**
 * حقول مجلد معاينة الصور (MV) — تُخزَّن في مجموعة `assets` بجانب صفوف استيراد Excel.
 * صفوف الاستيراد العادية تضع `isAssetFolder` غير `true` (عادةً null).
 */
export interface MvPhotoFolderAssetFields {
  isAssetFolder?: boolean | null;
  /** مجلد الصور: تاريخ الإنشاء؛ صف الاستيراد: غالباً ‎null‎ */
  createdAt?: Date | null;
  /** مجلد أب في شجرة صور المعاينة */
  parent?: ObjectId | null;
  /** اسم المجلد (يطابق اسم مجلد mv_subprojects تحت 2.صور المعاينة) */
  name?: string | null;
  writtenDescription?: string | null;
  code?: string | null;
  /** طراز/وصف نموذجي لمعاينة الصور — منفصل عن حقول الأنواع الأخرى */
  model?: string | null;
  kilometersDriven?: number | string | null;
  isPresent?: boolean | null;
  /** صف استيراد/جدول ومجلد معاينة صور: الافتراضي ‎true‎ عند الإنشاء في ‎MongoDB‎ */
  isDone?: boolean | null;
  createdBy?: ObjectId | null;
  images?: unknown[];
  voiceNotes?: ObjectId[] | unknown[];
}

export type AssetType =
  | "vehicles"
  | "machinery"
  | "electronics"
  | "furniture"
  | "other";

export type AssetStatus =
  | "pending_review"
  | "reviewed"
  | "valued"
  | "archived";

export type AssetPrimitive = string | number | boolean | null;

export type AssetRawData = Record<string, AssetPrimitive>;

export type AssetNormalizedData = Record<string, AssetPrimitive>;

export type AssetColumnType = "text" | "number" | "date" | "boolean";

export interface AssetBaseFields {
  assetId: string;
  assetName?: string | null;
  purchaseDate?: string | null;
  originalCost?: number | null;
  currency?: string | null;
  condition?: number | null;
  location?: string | null;
  /** ملاحظات نصية على مستوى الوثيقة (منفصلة عن أعمدة الشيت في rawData) */
  notes?: string;
  /** يُحدَّد عند وجود ملاحظات فعلية — الافتراضي عند الاستيراد ‎false‎ */
  hasNotes?: boolean;
  valuationMethod?: string | null;
  valuationDate?: string | null;
  valuedBy?: string | null;
}

export interface VehicleAssetFields {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  mileageKm?: number | null;
  engineSize?: string | null;
  fuelType?: string | null;
  licensePlate?: string | null;
  chassisNumber?: string | null;
  lastServiceDate?: string | null;
  accidentHistory?: boolean | null;
}

export interface MachineryAssetFields {
  manufacturer?: string | null;
  modelNumber?: string | null;
  serialNumber?: string | null;
  manufactureYear?: number | null;
  operatingHours?: number | null;
  powerOutput?: number | null;
  powerUnit?: string | null;
  lastMaintenanceDate?: string | null;
  nextMaintenanceDate?: string | null;
  capacityTons?: number | null;
}

export interface ElectronicsAssetFields {
  brand?: string | null;
  modelName?: string | null;
  serialNumber?: string | null;
  processorSpec?: string | null;
  ramGB?: number | null;
  storageGB?: number | null;
  osVersion?: string | null;
  warrantyExpiry?: string | null;
  screenSizeInch?: number | null;
  batteryHealthPercent?: number | null;
}

export interface FurnitureAssetFields {
  furnitureType?: string | null;
  material?: string | null;
  color?: string | null;
  setComplete?: boolean | null;
  setTotalPieces?: number | null;
  presentPieces?: number | null;
  woodType?: string | null;
  manufacturer?: string | null;
}

export interface AssetTypeCounter {
  vehicles: number;
  machinery: number;
  electronics: number;
  furniture: number;
  other: number;
}

export interface AssetDoc
  extends Omit<AssetBaseFields, "condition">,
    Omit<MachineryAssetFields, "manufactureYear">,
    VehicleAssetFields,
    ElectronicsAssetFields,
    FurnitureAssetFields,
    MvPhotoFolderAssetFields {
  _id: ObjectId;
  importId?: ObjectId;
  projectId: ObjectId;
  assetType: AssetType;
  rawData: AssetRawData;
  normalizedData: AssetNormalizedData;
  sheetName?: string;
  rowIndex?: number;
  importedAt: Date;
  updatedAt: Date;
  status: AssetStatus;
  /**
   * تقييم حالة الأصل رقمياً أو وصف نصي لحالة المعاينة (مجلد صور) — لا يُفرض نوع واحد في BSON.
   */
  condition?: number | string | null;
  /** سنة الصنع — قد تُخزَّن كنص في سجلات معاينة الصور */
  manufactureYear?: number | string | null;
}

/** إحصاء لكل ورقة في Excel بعد الاستيراد (بيانات خام دون معالجة) */
export interface AssetImportSheetStat {
  sheetName: string;
  importId?: string;
  rowCount: number;
  columnCount: number;
}

export interface AssetImportSummary {
  totalSheets: number;
  totalRows: number;
  byType: AssetTypeCounter;
  warnings: string[];
  /** أوراق ضُمّت صفوفها فعلياً (اسم الورقة + عدد الصفوف والأعمدة) */
  sheets: AssetImportSheetStat[];
}

/** عمود أُضيف يدوياً من الشبكة — يُعرض دائماً بعد أعمدة الاستيراد */
export interface AssetImportManualColumnEntry {
  fieldKey: string;
  label: string;
}

export interface AssetImportSheetManualColumns {
  sheetName: string;
  columns: AssetImportManualColumnEntry[];
}

export interface AssetImportDoc {
  _id: ObjectId;
  projectId: ObjectId;
  sourceFileName: string;
  mimeType: string;
  totalSheets: number;
  totalRows: number;
  byType: AssetTypeCounter;
  warnings: string[];
  importedAt: Date;
  status: "completed";
  /** ترتيب أعمدة مضافة يدوياً لكل ورقة (تُلحق في آخر الجدول) */
  sheetManualColumnSheets?: AssetImportSheetManualColumns[];
  /** أسماء رؤوس معروضة لأعمدة الاستيراد: [اسم الورقة][مفتاح الحقل] = التسمية الظاهرة */
  sheetColumnHeaderLabels?: Record<string, Record<string, string>>;
}

export interface ParsedAssetSheetRow {
  rowIndex: number;
  rawData: AssetRawData;
}

export interface ParsedAssetSheet {
  name: string;
  headers: string[];
  rows: ParsedAssetSheetRow[];
}

export interface AssetImportResult {
  success: true;
  projectId: string;
  importId: string;
  summary: AssetImportSummary;
}

export interface AssetColumnConfigDoc {
  _id: ObjectId;
  projectId: ObjectId;
  assetType: AssetType;
  columnName: string;
  fieldKey: string;
  columnType: AssetColumnType;
  createdAt: Date;
  createdBy: string;
}

export type AssetAuditAction =
  | "import"
  | "update"
  | "bulk_update"
  | "delete"
  | "bulk_delete"
  | "add_column"
  | "delete_column";

export interface AssetAuditLogDoc {
  _id: ObjectId;
  projectId: ObjectId;
  assetId?: ObjectId;
  assetType?: AssetType;
  action: AssetAuditAction;
  changes: Record<string, unknown>;
  actorUserId: string;
  actorUsername: string;
  createdAt: Date;
}

export interface AssetColumnDescriptor {
  key: string;
  label: string;
  type: AssetColumnType;
  isCustom: boolean;
}
