import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import type { AssetColumnType, AssetType } from "../types";

const ASSET_TYPES: AssetType[] = [
  "vehicles",
  "machinery",
  "electronics",
  "furniture",
  "other",
];

const SORT_ORDERS = ["asc", "desc"] as const;
const EXPORT_FORMATS = ["xlsx"] as const;
const COLUMN_TYPES: AssetColumnType[] = ["text", "number", "date", "boolean"];

export class ImportAssetsBodyDto {
  @IsMongoId()
  projectId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceFileNameUtf8?: string;
}

export class ListAssetImportsQueryDto {
  @IsMongoId()
  projectId!: string;
}

export class ListAssetsQueryDto {
  @IsMongoId()
  projectId!: string;

  @IsOptional()
  @IsMongoId()
  importId?: string;

  /** تصفية صفوف استيراد محدّد حسب اسم ورقة Excel */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;

  @IsOptional()
  @IsIn(ASSET_TYPES)
  assetType?: AssetType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sortBy?: string;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: (typeof SORT_ORDERS)[number];

  /** عند true مع importId: أعمدة من بيانات الشيت فقط (rawData) بدون حقول النظام الافتراضية */
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true" || value === "1" || value === 1)
  @IsBoolean()
  sheetColumns?: boolean;

  /** لتحميل الأعمدة المخصّصة عند غياب assetType في الاستعلام (مثل الشبكة بدون فلتر نوع) */
  @IsOptional()
  @IsIn(ASSET_TYPES)
  schemaAssetType?: AssetType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 50;
}

export class ExportAssetsQueryDto {
  @IsMongoId()
  projectId!: string;

  @IsOptional()
  @IsIn(ASSET_TYPES)
  assetType?: AssetType;

  @IsIn(EXPORT_FORMATS)
  format!: "xlsx";
}

export class UpdateAssetDto {
  @IsOptional()
  @IsMongoId()
  projectId?: string;

  @IsObject()
  @IsNotEmptyObject()
  changes!: Record<string, unknown>;
}

export class BulkUpdateAssetsDto {
  @IsMongoId()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  assetIds!: string[];

  @IsObject()
  @IsNotEmptyObject()
  changes!: Record<string, unknown>;
}

/** تعيين نوع أصل موحّد لعدة صفوف (تجهيز التقييم) — خارج normalizeChanges لأن assetType غير قابل للتعديل عبر bulk العادي */
export class BulkReassignAssetTypeDto {
  @IsMongoId()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @IsMongoId({ each: true })
  assetIds!: string[];

  @IsIn(ASSET_TYPES)
  assetType!: AssetType;
}

export class BulkDeleteAssetsDto {
  @IsMongoId()
  projectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsMongoId({ each: true })
  assetIds!: string[];
}

/** حذف كل صفوف أصل مرتبطة بورقة واحدة داخل استيراد محدّد */
export class DeleteImportSheetQueryDto {
  @IsMongoId()
  projectId!: string;

  @IsMongoId()
  importId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  sheetName!: string;
}

export class AddAssetColumnDto {
  @IsMongoId()
  projectId!: string;

  @IsIn(ASSET_TYPES)
  assetType!: AssetType;

  @IsString()
  @MaxLength(2000)
  columnName!: string;

  @IsIn(COLUMN_TYPES)
  columnType!: AssetColumnType;

  /** مع sheetName: يُضاف العمود فقط لصفوف تلك الورقة ضمن الاستيراد (وليس كل الشيتات). */
  @IsOptional()
  @IsMongoId()
  importId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;
}

export class RenameSheetColumnDto {
  @IsMongoId()
  projectId!: string;

  @IsIn(ASSET_TYPES)
  assetType!: AssetType;

  @IsMongoId()
  importId!: string;

  @IsString()
  @MaxLength(200)
  sheetName!: string;

  /** مفتاح الحقل في البيانات (مثلاً اسم عمود الاستيراد أو mvsc_…) */
  @IsString()
  @MaxLength(500)
  fieldKey!: string;

  @IsString()
  @MaxLength(2000)
  newLabel!: string;
}

export class DeleteAssetColumnQueryDto {
  @IsMongoId()
  projectId!: string;

  @IsIn(ASSET_TYPES)
  assetType!: AssetType;

  @IsOptional()
  @IsMongoId()
  importId?: string;

  /** مع importId: يُحذف الحقل فقط من صفوف تلك الورقة. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;
}

export class RenameImportSheetDto {
  @IsMongoId()
  projectId!: string;

  @IsMongoId()
  importId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  oldSheetName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  newSheetName!: string;
}

export class CreateBlankImportRowDto {
  @IsMongoId()
  projectId!: string;

  @IsMongoId()
  importId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  sheetName?: string;
}
