"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetImportService = void 0;
exports.isSupportedAssetImportMimeType = isSupportedAssetImportMimeType;
exports.isAssetImportMultipartAllowed = isAssetImportMultipartAllowed;
exports.isSupportedAssetImportFile = isSupportedAssetImportFile;
const common_1 = require("@nestjs/common");
const ExcelJS = __importStar(require("exceljs"));
const node_stream_1 = require("node:stream");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const collections_1 = require("../machine-valuation/collections");
const asset_audit_service_1 = require("./asset-audit.service");
const asset_list_cache_service_1 = require("./asset-list-cache.service");
const collections_2 = require("./collections");
const asset_import_constants_1 = require("./asset-import.constants");
const asset_import_cache_service_1 = require("./asset-import-cache.service");
const asset_import_utils_1 = require("./asset-import.utils");
const sheet_rows_util_1 = require("../machine-valuation/sheet-rows.util");
const asset_project_access_service_1 = require("./asset-project-access.service");
function primitiveToDisplayLabel(value) {
    if (value == null)
        return "";
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    return "";
}
function resolveImportSheetRowName(rawData, headers, sheetName, rowIndex) {
    for (const header of headers) {
        const label = primitiveToDisplayLabel(rawData[header] ?? null);
        if (label)
            return label.slice(0, 500);
    }
    return `${sheetName} · صف ${rowIndex}`.slice(0, 500);
}
let AssetImportService = class AssetImportService {
    constructor(importCache, listCache, auditService, projectAccess) {
        this.importCache = importCache;
        this.listCache = listCache;
        this.auditService = auditService;
        this.projectAccess = projectAccess;
    }
    async importFile(input) {
        const projectObjectId = this.parseProjectId(input.projectId);
        const sanitizedMimeType = (0, asset_import_utils_1.sanitizeTextInput)(input.mimeType).toLowerCase();
        const sanitizedFileName = (0, asset_import_utils_1.sanitizeTextInput)(input.originalName);
        if (!input.buffer || input.buffer.length === 0) {
            throw new common_1.BadRequestException("ملف الاستيراد فارغ.");
        }
        if (!isSupportedAssetImportFile(sanitizedFileName, sanitizedMimeType)) {
            throw new common_1.BadRequestException("نوع الملف غير مدعوم. الأنواع المقبولة: XLSX و XLS و CSV.");
        }
        this.assertBufferMatchesExtension(input.buffer, (0, asset_import_utils_1.getFileExtension)(sanitizedFileName));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_2.ensureAssetsCollectionsInitialized)(db);
        await this.ensureProjectExists(db, projectObjectId);
        await this.projectAccess.assertProjectAccess(projectObjectId, input.user, {
            claimOwnershipIfMissing: true,
            activeCompanyId: input.activeCompanyId ?? null,
        });
        const workbook = await this.loadWorkbook(input.buffer, sanitizedFileName, sanitizedMimeType);
        if (workbook.worksheets.length === 0) {
            throw new common_1.BadRequestException("الملف لا يحتوي على أوراق قابلة للاستيراد.");
        }
        const importId = new mongodb_1.ObjectId();
        const importedAt = new Date();
        const summary = (0, asset_import_utils_1.createImportSummary)(workbook.worksheets.length);
        const assetDocs = [];
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
            const assetType = "other";
            summary.sheets.push({
                sheetName: parsedSheet.name,
                importId: importId.toString(),
                rowCount: parsedSheet.rows.length,
                columnCount: parsedSheet.headers.length,
            });
            parsedSheet.rows.forEach((row) => {
                const rowName = resolveImportSheetRowName(row.rawData, parsedSheet.headers, parsedSheet.name, row.rowIndex);
                const assetObjectId = new mongodb_1.ObjectId();
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
                    ...(0, asset_import_utils_1.emptyMvPhotoFieldsForImportedAssetRow)({
                        createdBy: input.user._id,
                        createdAt: importedAt,
                    }),
                });
                summary.totalRows += 1;
                summary.byType.other += 1;
            });
        });
        if (assetDocs.length > asset_import_constants_1.ASSET_IMPORT_MAX_TOTAL_ROWS) {
            throw new common_1.BadRequestException(`عدد الصفوف (${assetDocs.length.toLocaleString("ar-SA")}) يتجاوز الحد المسموح (${asset_import_constants_1.ASSET_IMPORT_MAX_TOTAL_ROWS.toLocaleString("ar-SA")} صف في استيراد واحد). قسّم الملف أو رفع على دفعات.`);
        }
        if (assetDocs.length > 0) {
            try {
                for (let offset = 0; offset < assetDocs.length; offset += asset_import_constants_1.ASSET_IMPORT_INSERT_BATCH_SIZE) {
                    const batch = assetDocs.slice(offset, offset + asset_import_constants_1.ASSET_IMPORT_INSERT_BATCH_SIZE);
                    await db.collection(collections_2.ASSETS_COLLECTION).insertMany(batch, {
                        ordered: false,
                    });
                }
                await db.collection(collections_2.ASSETS_COLLECTION).updateMany({ importId, projectId: projectObjectId, isAssetFolder: { $ne: true } }, {
                    $set: (0, asset_import_utils_1.emptyMvPhotoFieldsForImportedAssetRow)({
                        createdBy: input.user._id,
                        createdAt: importedAt,
                    }),
                });
            }
            catch (insertError) {
                const msg = insertError instanceof Error ? insertError.message : String(insertError);
                throw new common_1.BadRequestException(`تعذر حفظ الأصول في قاعدة البيانات: ${msg.slice(0, 400)}`);
            }
        }
        const importDoc = {
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
        await db.collection(collections_2.ASSET_IMPORTS_COLLECTION).insertOne(importDoc);
        const result = {
            success: true,
            projectId: projectObjectId.toString(),
            importId: importId.toString(),
            summary,
        };
        await this.importCache.setImportResult(result);
        await this.listCache.invalidateProject(projectObjectId.toString());
        await this.auditService.log(projectObjectId, {
            userId: input.user._id.toString(),
            username: input.user.username,
        }, "import", {
            importId: importId.toString(),
            totalSheets: summary.totalSheets,
            totalRows: summary.totalRows,
            byType: summary.byType,
            warningCount: summary.warnings.length,
        });
        return result;
    }
    parseProjectId(projectId) {
        const sanitized = (0, asset_import_utils_1.sanitizeTextInput)(projectId);
        if (!mongodb_1.ObjectId.isValid(sanitized)) {
            throw new common_1.BadRequestException("معرف المشروع غير صالح.");
        }
        return new mongodb_1.ObjectId(sanitized);
    }
    async ensureProjectExists(db, projectId) {
        const project = await db
            .collection(collections_1.MV_PROJECTS_COLLECTION)
            .findOne({ _id: projectId }, { projection: { _id: 1 } });
        if (!project) {
            throw new common_1.NotFoundException("المشروع غير موجود.");
        }
    }
    async loadWorkbook(buffer, fileName, mimeType) {
        const extension = (0, asset_import_utils_1.getFileExtension)(fileName);
        if (extension === "csv" || mimeType === "text/csv" || mimeType === "application/csv") {
            const workbook = new ExcelJS.Workbook();
            await workbook.csv.read(node_stream_1.Readable.from(buffer), {
                sheetName: "Sheet1",
                parserOptions: { trim: true },
            });
            return workbook;
        }
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(buffer);
            return workbook;
        }
        catch (firstError) {
            const hint = firstError instanceof Error && firstError.message
                ? ` (${firstError.message.slice(0, 280)})`
                : "";
            if (extension === "xls") {
                if ((0, asset_import_utils_1.isLikelyLegacyXlsBuffer)(buffer)) {
                    throw new common_1.BadRequestException("تعذر قراءة ملف XLS الثنائي القديم ضمن المكتبات الحالية. استخدم XLSX أو CSV.");
                }
                if ((0, asset_import_utils_1.isTextLikeBuffer)(buffer)) {
                    const csvWorkbook = new ExcelJS.Workbook();
                    await csvWorkbook.csv.read(node_stream_1.Readable.from(buffer), {
                        sheetName: "Sheet1",
                        parserOptions: { trim: true },
                    });
                    return csvWorkbook;
                }
            }
            throw new common_1.BadRequestException(`تعذر قراءة ملف الاستيراد. تحقق أن الملف ليس تالفاً وأنه محفوظ كـ XLSX حقيقي (وليس «صفحة ويب» بامتداد xlsx).${hint}`);
        }
    }
    assertBufferMatchesExtension(buffer, extension) {
        if (extension === "xlsx") {
            if (!(0, asset_import_utils_1.isLikelyXlsxZipBuffer)(buffer)) {
                throw new common_1.BadRequestException("الملف بامتداد .xlsx لكن المحتوى لا يطابق تنسيق Excel (ملف مضغوط). أعد الحفظ من Excel بصيغة «مصنف Excel (*.xlsx)» أو تأكد أن المرفوع ليس ملفاً آخر بامتداد خاطئ.");
            }
        }
        if (extension === "xls") {
            if (!(0, asset_import_utils_1.isLikelyLegacyXlsBuffer)(buffer) && !(0, asset_import_utils_1.isTextLikeBuffer)(buffer) && (0, asset_import_utils_1.isLikelyXlsxZipBuffer)(buffer)) {
                throw new common_1.BadRequestException("الملف بامتداد .xls لكنه يبدو بتنسيق XLSX (Zip). غيّر الامتداد إلى .xlsx أو أعد الحفظ بالصيغة الصحيحة.");
            }
        }
    }
    parseWorksheet(worksheet) {
        const sheetWarnings = [];
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
        const usedHeaders = new Set();
        const headers = Array.from({ length: maxColumnCount }, (_, index) => {
            const headerValue = (0, asset_import_utils_1.extractCellValue)(headerRow.getCell(index + 1));
            return (0, asset_import_utils_1.ensureUniqueHeader)(typeof headerValue === "string" ? headerValue : "", index + 1, usedHeaders);
        });
        const dimBottom = worksheet.dimensions && typeof worksheet.dimensions.bottom === "number"
            ? worksheet.dimensions.bottom
            : 0;
        const lastRowIndex = Math.max(worksheet.rowCount, dimBottom);
        const rows = [];
        for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRowIndex; rowIndex += 1) {
            const row = worksheet.getRow(rowIndex);
            const rawData = {};
            let hasData = false;
            headers.forEach((header, columnIndex) => {
                const value = (0, asset_import_utils_1.extractCellValue)(row.getCell(columnIndex + 1));
                rawData[header] = value === undefined ? null : value;
                if (!(0, asset_import_utils_1.isEmptyPrimitive)(value)) {
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
    resolveMaxColumnCount(worksheet) {
        const worksheetWithColumnCount = worksheet;
        let maxColumnCount = Math.max(worksheetWithColumnCount.columnCount ?? 0, worksheetWithColumnCount.actualColumnCount ?? 0);
        const dimRight = worksheet.dimensions?.right;
        if (typeof dimRight === "number" && dimRight > 0) {
            maxColumnCount = Math.max(maxColumnCount, dimRight);
        }
        const scanLimit = Math.min(worksheet.rowCount, asset_import_constants_1.MAX_COLUMN_SCAN_ROWS);
        for (let rowIndex = 1; rowIndex <= scanLimit; rowIndex += 1) {
            const row = worksheet.getRow(rowIndex);
            row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
                maxColumnCount = Math.max(maxColumnCount, colNumber);
            });
        }
        return maxColumnCount;
    }
    resolveHeaderRowIndexForImport(worksheet) {
        return worksheet.rowCount >= 1 ? 1 : undefined;
    }
};
exports.AssetImportService = AssetImportService;
exports.AssetImportService = AssetImportService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [asset_import_cache_service_1.AssetImportCacheService,
        asset_list_cache_service_1.AssetListCacheService,
        asset_audit_service_1.AssetAuditService,
        asset_project_access_service_1.AssetProjectAccessService])
], AssetImportService);
function isSupportedAssetImportMimeType(mimeType) {
    const m = (0, asset_import_utils_1.sanitizeTextInput)(mimeType).toLowerCase();
    return asset_import_constants_1.SUPPORTED_MIME_TYPES.has(m) || asset_import_constants_1.ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m);
}
function isAssetImportMultipartAllowed(mimeType, originalFilename) {
    const name = (0, sheet_rows_util_1.decodeUploadFilename)(originalFilename || "");
    const ext = (0, asset_import_utils_1.getFileExtension)(name || (0, asset_import_utils_1.sanitizeTextInput)(originalFilename));
    if (!asset_import_constants_1.SUPPORTED_EXTENSIONS.has(ext)) {
        return false;
    }
    const m = (0, asset_import_utils_1.sanitizeTextInput)(mimeType).toLowerCase();
    const allowed = asset_import_constants_1.MIME_TYPES_BY_EXTENSION[ext];
    if (allowed?.has(m))
        return true;
    if (asset_import_constants_1.ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m))
        return true;
    return false;
}
function isSupportedAssetImportFile(fileName, mimeType) {
    const extension = (0, asset_import_utils_1.getFileExtension)(fileName);
    if (!asset_import_constants_1.SUPPORTED_EXTENSIONS.has(extension)) {
        return false;
    }
    const allowedMimeTypes = asset_import_constants_1.MIME_TYPES_BY_EXTENSION[extension];
    if (!allowedMimeTypes)
        return false;
    const m = (0, asset_import_utils_1.sanitizeTextInput)(mimeType).toLowerCase();
    if (allowedMimeTypes.has(m))
        return true;
    return asset_import_constants_1.ASSET_IMPORT_PERMISSIVE_MIME_TYPES.has(m);
}
