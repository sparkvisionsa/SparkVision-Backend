import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import { MV_PROJECTS_COLLECTION } from "@/machine-valuation/collections";
import type { MvProjectDoc } from "@/machine-valuation/types";
import type { UserMongoDoc } from "@/server/auth-tracking/types";
import { AssetAuditService } from "./asset-audit.service";
import { AssetListCacheService } from "./asset-list-cache.service";
import {
  ASSET_IMPORTS_COLLECTION,
  ASSETS_COLLECTION,
  ensureAssetsCollectionsInitialized,
} from "./collections";
import {
  ASSET_IMPORT_INSERT_BATCH_SIZE,
  ASSET_IMPORT_MAX_TOTAL_ROWS,
  ASSET_IMPORT_PERMISSIVE_MIME_TYPES,
  MAX_COLUMN_SCAN_ROWS,
  MIME_TYPES_BY_EXTENSION,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from "./asset-import.constants";
import { AssetImportCacheService } from "./asset-import-cache.service";
import {
  createImportSummary,
  ensureUniqueHeader,
  extractCellValue,
  isEmptyPrimitive,
  isTextLikeBuffer,
  sanitizeTextInput,
  getFileExtension,
  isLikelyLegacyXlsBuffer,
  isLikelyXlsxZipBuffer,
  emptyMvPhotoFieldsForImportedAssetRow,
} from "./asset-import.utils";
import { decodeUploadFilename } from "@/machine-valuation/sheet-rows.util";
import { AssetProjectAccessService } from "./asset-project-access.service";
import type {
  AssetDoc,
  AssetImportDoc,
  AssetImportResult,
  AssetPrimitive,
  AssetRawData,
  ParsedAssetSheet,
} from "./types";

function primitiveToDisplayLabel(value: AssetPrimitive): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** اسم العرض للصف — أول عمود غير فارغ؛ يُستبدل لاحقاً بعمود «مجلدات المعاينة» عند توليد المجلدات. */
function resolveImportSheetRowName(
  rawData: AssetRawData,
  headers: string[],
  sheetName: string,
  rowIndex: number,
): string {
  for (const header of headers) {
    const label = primitiveToDisplayLabel(rawData[header] ?? null);
    if (label) return label.slice(0, 500);
  }
  return `${sheetName} · صف ${rowIndex}`.slice(0, 500);
}

@Injectable()
export class AssetImportService {
  constructor(
    private readonly importCache: AssetImportCacheService,
    private readonly listCache: AssetListCacheService,
    private readonly auditService: AssetAuditService,
    private readonly projectAccess: AssetProjectAccessService,
  ) {}

  async importFile(input: {
    projectId: string;
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    user: UserMongoDoc;
    activeCompanyId?: ObjectId | null;
  }): Promise<AssetImportResult> {
    const projectObjectId = this.parseProjectId(input.projectId);
    const sanitizedMimeType = sanitizeTextInput(input.mimeType).toLowerCase();
    const sanitizedFileName = sanitizeTextInput(input.originalName);

    if (!input.buffer || input.buffer.length === 0) {
      throw new BadRequestException("ملف الاستيراد فارغ.");
    }

    if (!isSupportedAssetImportFile(sanitizedFileName, sanitizedMimeType)) {
      throw new BadRequestException(
        "نوع الملف غير مدعوم. الأنواع المقبولة: XLSX و XLSM و XLS و CSV.",
      );
    }

    this.assertBufferMatchesExtension(input.buffer, getFileExtension(sanitizedFileName));

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);
    await this.ensureProjectExists(db, projectObjectId);
    await this.projectAccess.assertProjectAccess(projectObjectId, input.user, {
      claimOwnershipIfMissing: true,
      activeCompanyId: input.activeCompanyId ?? null,
    });

    const workbook = await this.loadWorkbook(
      input.buffer,
      sanitizedFileName,
      sanitizedMimeType,
    );

    if (workbook.worksheets.length === 0) {
      throw new BadRequestException("الملف لا يحتوي على أوراق قابلة للاستيراد.");
    }

    const importId = new ObjectId();
    const importedAt = new Date();
    const summary = createImportSummary(workbook.worksheets.length);
    const assetDocs: AssetDoc[] = [];

    workbook.worksheets.forEach((worksheet) => {
      const { parsedSheet, sheetWarnings } = this.parseWorksheet(worksheet);
      summary.warnings.push(...sheetWarnings);

      if (parsedSheet.headers.length === 0) {
        summary.warnings.push(`ورقة "${parsedSheet.name}" لا تحتوي على صف عناوين واضح.`);
        return;
      }

      if (parsedSheet.rows.length === 0) {
        summary.warnings.push(`ورقة "${parsedSheet.name}" لا تحتوي على صفوف بيانات بعد العناوين.`);
        return;
      }

      /** بدون تصنيف أو تطبيع حقول: كل ورقة = جدول بأسماء الأعمدة كما في Excel، وصف = سجل. */
      const assetType = "other" as const;

      summary.sheets.push({
        sheetName: parsedSheet.name,
        importId: importId.toString(),
        rowCount: parsedSheet.rows.length,
        columnCount: parsedSheet.headers.length,
      });

      parsedSheet.rows.forEach((row) => {
        const rowName = resolveImportSheetRowName(
          row.rawData,
          parsedSheet.headers,
          parsedSheet.name,
          row.rowIndex,
        );
        const assetObjectId = new ObjectId();

        assetDocs.push({
          _id: assetObjectId,
          assetId: assetObjectId.toString(),
          importId,
          projectId: projectObjectId,
          assetType,
          rawData: row.rawData,
          normalizedData: {},
          name: rowName,
          sheetName: parsedSheet.name,
          rowIndex: row.rowIndex,
          importedAt,
          updatedAt: importedAt,
          status: "pending_review",
          hasNotes: false,
          notes: "",
          ...emptyMvPhotoFieldsForImportedAssetRow({
            createdBy: input.user._id,
            createdAt: importedAt,
          }),
        });

        summary.totalRows += 1;
        summary.byType.other += 1;
      });
    });

    if (assetDocs.length > ASSET_IMPORT_MAX_TOTAL_ROWS) {
      throw new BadRequestException(
        `عدد الصفوف (${assetDocs.length.toLocaleString("ar-SA")}) يتجاوز الحد المسموح (${ASSET_IMPORT_MAX_TOTAL_ROWS.toLocaleString("ar-SA")} صف في استيراد واحد). قسّم الملف أو رفع على دفعات.`,
      );
    }

    if (assetDocs.length > 0) {
      try {
        for (let offset = 0; offset < assetDocs.length; offset += ASSET_IMPORT_INSERT_BATCH_SIZE) {
          const batch = assetDocs.slice(offset, offset + ASSET_IMPORT_INSERT_BATCH_SIZE);
          await db.collection<AssetDoc>(ASSETS_COLLECTION).insertMany(batch, {
            ordered: false,
          });
        }
        /** يضمن وجود كل حقول مجلد المعاينة على الوثيقة في BSON (حتى null) بعد الإدراج */
        await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
          { importId, projectId: projectObjectId, isAssetFolder: { $ne: true } },
          {
            $set: emptyMvPhotoFieldsForImportedAssetRow({
              createdBy: input.user._id,
              createdAt: importedAt,
            }),
          },
        );
      } catch (insertError) {
        const msg = insertError instanceof Error ? insertError.message : String(insertError);
        throw new BadRequestException(
          `تعذر حفظ الأصول في قاعدة البيانات: ${msg.slice(0, 400)}`,
        );
      }
    }

    const importDoc: AssetImportDoc = {
      _id: importId,
      projectId: projectObjectId,
      sourceFileName: sanitizedFileName,
      mimeType: sanitizedMimeType,
      totalSheets: summary.totalSheets,
      totalRows: summary.totalRows,
      byType: summary.byType,
      warnings: summary.warnings,
      importedAt,
      status: "completed",
    };

    await db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION).insertOne(importDoc);

    const result: AssetImportResult = {
      success: true,
      projectId: projectObjectId.toString(),
      importId: importId.toString(),
      summary,
    };

    await this.importCache.setImportResult(result);
    await this.listCache.invalidateProject(projectObjectId.toString());
    await this.auditService.log(
      projectObjectId,
      {
        userId: input.user._id.toString(),
        username: input.user.username,
      },
      "import",
      {
        importId: importId.toString(),
        totalSheets: summary.totalSheets,
        totalRows: summary.totalRows,
        byType: summary.byType,
        warningCount: summary.warnings.length,
      },
    );

    return result;
  }

  private parseProjectId(projectId: string) {
    const sanitized = sanitizeTextInput(projectId);
    if (!ObjectId.isValid(sanitized)) {
      throw new BadRequestException("معرف المشروع غير صالح.");
    }
    return new ObjectId(sanitized);
  }

  private async ensureProjectExists(db: Awaited<ReturnType<typeof getMongoDb>>, projectId: ObjectId) {
    const project = await db
      .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
      .findOne({ _id: projectId }, { projection: { _id: 1 } });

    if (!project) {
      throw new NotFoundException("المشروع غير موجود.");
    }
  }

  private async loadWorkbook(buffer: Buffer, fileName: string, mimeType: string) {
    const extension = getFileExtension(fileName);

    if (extension === "csv" || mimeType === "text/csv" || mimeType === "application/csv") {
      const workbook = new ExcelJS.Workbook();
      await workbook.csv.read(Readable.from(buffer), {
        sheetName: "Sheet1",
        parserOptions: { trim: true },
      });
      return workbook;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      return workbook;
    } catch (firstError) {
      const hint =
        firstError instanceof Error && firstError.message
          ? ` (${firstError.message.slice(0, 280)})`
          : "";
      if (extension === "xls") {
        if (isLikelyLegacyXlsBuffer(buffer)) {
          throw new BadRequestException(
            "تعذر قراءة ملف XLS الثنائي القديم ضمن المكتبات الحالية. استخدم XLSX أو CSV.",
          );
        }

        if (isTextLikeBuffer(buffer)) {
          const csvWorkbook = new ExcelJS.Workbook();
          await csvWorkbook.csv.read(Readable.from(buffer), {
            sheetName: "Sheet1",
            parserOptions: { trim: true },
          });
          return csvWorkbook;
        }
      }

      throw new BadRequestException(
        `تعذر قراءة ملف الاستيراد. تحقق أن الملف ليس تالفاً وأنه محفوظ كـ XLSX أو XLSM حقيقي (وليس «صفحة ويب» بامتداد Excel).${hint}`,
      );
    }
  }

  private assertBufferMatchesExtension(buffer: Buffer, extension: string) {
    if (extension === "xlsx" || extension === "xlsm") {
      if (!isLikelyXlsxZipBuffer(buffer)) {
        throw new BadRequestException(
          `الملف بامتداد .${extension} لكن المحتوى لا يطابق تنسيق Excel الحديث (ملف Zip). أعد الحفظ من Excel بصيغة XLSX أو XLSM صحيحة.`,
        );
      }
    }
    if (extension === "xls") {
      if (!isLikelyLegacyXlsBuffer(buffer) && !isTextLikeBuffer(buffer) && isLikelyXlsxZipBuffer(buffer)) {
        throw new BadRequestException(
          "الملف بامتداد .xls لكنه يبدو بتنسيق XLSX (Zip). غيّر الامتداد إلى .xlsx أو أعد الحفظ بالصيغة الصحيحة.",
        );
      }
    }
  }

  private parseWorksheet(worksheet: ExcelJS.Worksheet): {
    parsedSheet: ParsedAssetSheet;
    sheetWarnings: string[];
  } {
    const sheetWarnings: string[] = [];
    const rawSheetTitle = (worksheet.name ?? "").replace(/\u0000/g, "");
    const sheetName = rawSheetTitle.length > 0 ? rawSheetTitle : "Sheet";
    const maxColumnCount = this.resolveMaxColumnCount(worksheet);

    if (worksheet.rowCount === 0 || maxColumnCount === 0) {
      return {
        parsedSheet: {
          name: sheetName,
          headers: [],
          rows: [],
        },
        sheetWarnings: [`ورقة "${sheetName}" لا تحتوي على بيانات.`],
      };
    }

    const headerRowIndex = this.resolveHeaderRowIndexForImport(worksheet);
    if (!headerRowIndex) {
      return {
        parsedSheet: {
          name: sheetName,
          headers: [],
          rows: [],
        },
        sheetWarnings,
      };
    }

    const headerRow = worksheet.getRow(headerRowIndex);
    const usedHeaders = new Set<string>();
    const headers = Array.from({ length: maxColumnCount }, (_, index) => {
      const headerValue = extractCellValue(headerRow.getCell(index + 1));
      return ensureUniqueHeader(
        typeof headerValue === "string" ? headerValue : "",
        index + 1,
        usedHeaders,
      );
    });

    const dimBottom =
      worksheet.dimensions && typeof worksheet.dimensions.bottom === "number"
        ? worksheet.dimensions.bottom
        : 0;
    const lastRowIndex = Math.max(worksheet.rowCount, dimBottom);

    const rows = [];
    for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRowIndex; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      const rawData: AssetRawData = {};
      let hasData = false;

      headers.forEach((header, columnIndex) => {
        const value = extractCellValue(row.getCell(columnIndex + 1));
        rawData[header] = value === undefined ? null : value;
        if (!isEmptyPrimitive(value)) {
          hasData = true;
        }
      });

      if (hasData) {
        rows.push({ rowIndex, rawData });
      }
    }

    return {
      parsedSheet: {
        name: sheetName,
        headers,
        rows,
      },
      sheetWarnings,
    };
  }

  private resolveMaxColumnCount(worksheet: ExcelJS.Worksheet) {
    const worksheetWithColumnCount = worksheet as ExcelJS.Worksheet & {
      columnCount?: number;
      actualColumnCount?: number;
    };

    let maxColumnCount = Math.max(
      worksheetWithColumnCount.columnCount ?? 0,
      worksheetWithColumnCount.actualColumnCount ?? 0,
    );

    const dimRight = worksheet.dimensions?.right;
    if (typeof dimRight === "number" && dimRight > 0) {
      maxColumnCount = Math.max(maxColumnCount, dimRight);
    }

    /** ‎cellCount/actualCellCount‎ قد يقلّان عن عدد الأعمدة الفعلي (خلايا بلا قيمة في الصف). ‎eachCell(includeEmpty: true)‎ يطابق عرض Excel. */
    const scanLimit = Math.min(worksheet.rowCount, MAX_COLUMN_SCAN_ROWS);
    for (let rowIndex = 1; rowIndex <= scanLimit; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex);
      row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
        maxColumnCount = Math.max(maxColumnCount, colNumber);
      });
    }

    return maxColumnCount;
  }

  /** صف العناوين = الصف 1 حصراً كما في ورقة Excel (دون تخمين أو مطابقة عناوين مع حقول نظامية). */
  private resolveHeaderRowIndexForImport(worksheet: ExcelJS.Worksheet) {
    return worksheet.rowCount >= 1 ? 1 : undefined;
  }
}

export function isSupportedAssetImportMimeType(mimeType: string) {
  const m = sanitizeTextInput(mimeType).toLowerCase();
  return SUPPORTED_MIME_TYPES.has(m) || ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m);
}

/**
 * قبول رفع multipart: النوع المعروف، أو نوع عام مع امتداد مدعوم (يتبعه تحقق من محتوى الملف).
 */
export function isAssetImportMultipartAllowed(mimeType: string, originalFilename: string) {
  const name = decodeUploadFilename(originalFilename || "");
  const ext = getFileExtension(name || sanitizeTextInput(originalFilename));
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    return false;
  }
  const m = sanitizeTextInput(mimeType).toLowerCase();
  const allowed = MIME_TYPES_BY_EXTENSION[ext];
  if (allowed?.has(m)) return true;
  if (ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m)) return true;
  return false;
}

export function isSupportedAssetImportFile(fileName: string, mimeType: string) {
  const extension = getFileExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return false;
  }

  const allowedMimeTypes = MIME_TYPES_BY_EXTENSION[extension];
  if (!allowedMimeTypes) return false;

  const m = sanitizeTextInput(mimeType).toLowerCase();
  if (allowedMimeTypes.has(m)) return true;
  return ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m);
}
