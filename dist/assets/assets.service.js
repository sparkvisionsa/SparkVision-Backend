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
exports.AssetsService = void 0;
const common_1 = require("@nestjs/common");
const ExcelJS = __importStar(require("exceljs"));
const node_crypto_1 = require("node:crypto");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const asset_audit_service_1 = require("./asset-audit.service");
const asset_list_cache_service_1 = require("./asset-list-cache.service");
const collections_1 = require("./collections");
const asset_field_definitions_1 = require("./asset-field-definitions");
const asset_project_access_service_1 = require("./asset-project-access.service");
const asset_import_utils_1 = require("./asset-import.utils");
const EXPORTABLE_TYPES = [
    "vehicles",
    "machinery",
    "electronics",
    "furniture",
    "other",
];
function toObjectId(id, label = "المعرف") {
    const sanitized = (0, asset_import_utils_1.sanitizeTextInput)(id);
    if (!mongodb_1.ObjectId.isValid(sanitized)) {
        throw new common_1.BadRequestException(`${label} غير صالح.`);
    }
    return new mongodb_1.ObjectId(sanitized);
}
function buildCacheKey(value) {
    return (0, node_crypto_1.createHash)("sha1").update(JSON.stringify(value)).digest("hex");
}
function getActor(user) {
    return {
        userId: user._id.toString(),
        username: user.username,
    };
}
function normalizeOrder(sortOrder) {
    return sortOrder === "asc" ? 1 : -1;
}
function resolveAssetFieldValue(asset, fieldKey) {
    const directValue = asset[fieldKey];
    if (typeof directValue === "string" ||
        typeof directValue === "number" ||
        typeof directValue === "boolean" ||
        directValue === null) {
        return directValue;
    }
    const normalizedValue = asset.normalizedData?.[fieldKey];
    if (normalizedValue !== undefined)
        return normalizedValue;
    const rawValue = asset.rawData?.[fieldKey];
    return rawValue ?? null;
}
function sanitizePrimitiveValue(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "string") {
        const sanitized = (0, asset_import_utils_1.sanitizeTextInput)(value);
        return sanitized.length > 0 ? sanitized : null;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new common_1.BadRequestException("القيم الرقمية غير الصالحة غير مسموحة.");
        }
        return value;
    }
    if (typeof value === "boolean")
        return value;
    throw new common_1.BadRequestException("القيمة المرسلة غير مدعومة.");
}
function inferColumnTypeFromValue(value) {
    if (typeof value === "number")
        return "number";
    if (typeof value === "boolean")
        return "boolean";
    if (typeof value === "string") {
        const trimmed = (0, asset_import_utils_1.sanitizeTextInput)(value);
        if (trimmed && (0, asset_import_utils_1.isProbablyNumericText)(trimmed))
            return "number";
        if ((0, asset_import_utils_1.parseDateValue)(value) !== undefined)
            return "date";
    }
    return "text";
}
function parseColumnValue(fieldKey, value, columnType) {
    const sanitized = sanitizePrimitiveValue(value);
    const expectedType = columnType ?? inferColumnTypeFromValue(sanitized);
    if (sanitized === null) {
        return null;
    }
    switch (expectedType) {
        case "number": {
            const parsed = (0, asset_import_utils_1.parseNumberValue)(sanitized);
            if (parsed === undefined) {
                throw new common_1.BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون رقمية.`);
            }
            return parsed;
        }
        case "date": {
            const parsed = (0, asset_import_utils_1.parseDateValue)(sanitized);
            if (!parsed) {
                throw new common_1.BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون تاريخاً صالحاً.`);
            }
            return parsed;
        }
        case "boolean": {
            const parsed = (0, asset_import_utils_1.parseBooleanValue)(sanitized);
            if (parsed === undefined) {
                throw new common_1.BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون منطقية.`);
            }
            return parsed;
        }
        case "text":
        default: {
            const parsed = (0, asset_import_utils_1.parseStringValue)(sanitized);
            return parsed ?? null;
        }
    }
}
function collectSheetStyleDynamicColumns(assets) {
    const ordered = [];
    const seen = new Set();
    const recordKeys = (obj) => {
        if (!obj || typeof obj !== "object")
            return;
        for (const key of Object.keys(obj)) {
            if (seen.has(key))
                continue;
            seen.add(key);
            ordered.push(key);
        }
    };
    for (const asset of assets) {
        recordKeys(asset.rawData);
    }
    const inferTypeForKey = (key) => {
        for (const asset of assets) {
            const raw = asset.rawData?.[key];
            if (raw !== undefined && raw !== null && raw !== "") {
                return inferColumnTypeFromValue(sanitizePrimitiveValue(raw));
            }
        }
        return "text";
    };
    return ordered.map((key) => ({
        key,
        label: key,
        type: inferTypeForKey(key),
        isCustom: false,
    }));
}
function normalizeSheetDuplicateLabel(value) {
    return (0, asset_import_utils_1.sanitizeTextInput)(value).replace(/\s+/g, " ").trim();
}
async function collectOrderedSheetDataColumns(db, filter, manualKeySet, typeHintDocs) {
    const coll = db.collection(collections_1.ASSETS_COLLECTION);
    const keyAgg = await coll
        .aggregate([
        { $match: filter },
        {
            $project: {
                ra: {
                    $map: {
                        input: { $objectToArray: { $ifNull: ["$rawData", {}] } },
                        as: "x",
                        in: "$$x.k",
                    },
                },
            },
        },
        { $unwind: "$ra" },
        { $group: { _id: "$ra" } },
    ])
        .toArray();
    const allKeysFromDb = new Set(keyAgg.map((r) => r._id));
    const dataKeysSet = new Set([...allKeysFromDb].filter((k) => {
        if (manualKeySet.has(k))
            return false;
        return true;
    }));
    const firstDoc = await coll.findOne(filter, {
        sort: { rowIndex: 1, _id: 1 },
        projection: { rawData: 1 },
    });
    const fromFirst = collectSheetStyleDynamicColumns(firstDoc ? [firstDoc] : []);
    const ordered = [];
    const seen = new Set();
    for (const d of fromFirst) {
        if (dataKeysSet.has(d.key) && !seen.has(d.key)) {
            ordered.push(d.key);
            seen.add(d.key);
        }
    }
    const remaining = new Set();
    for (const k of dataKeysSet) {
        if (!seen.has(k))
            remaining.add(k);
    }
    if (remaining.size > 0) {
        const cursor = coll.find(filter, {
            projection: { rawData: 1, rowIndex: 1 },
        }).sort({ rowIndex: 1, _id: 1 });
        for await (const doc of cursor) {
            const obj = doc.rawData;
            if (!obj)
                continue;
            for (const key of Object.keys(obj)) {
                if (!remaining.has(key))
                    continue;
                ordered.push(key);
                remaining.delete(key);
                if (remaining.size === 0)
                    break;
            }
            if (remaining.size === 0)
                break;
        }
        if (remaining.size > 0) {
            ordered.push(...[...remaining].sort((a, b) => a.localeCompare(b, "ar")));
        }
    }
    const inferPoolRaw = [firstDoc, ...typeHintDocs].filter((d) => Boolean(d));
    const inferPool = [];
    const idSeen = new Set();
    for (const d of inferPoolRaw) {
        const id = d._id ? String(d._id) : "";
        if (id) {
            if (idSeen.has(id))
                continue;
            idSeen.add(id);
        }
        inferPool.push(d);
    }
    const inferTypeForKey = (key) => {
        for (const asset of inferPool) {
            const raw = asset.rawData?.[key];
            if (raw !== undefined && raw !== null && raw !== "") {
                return inferColumnTypeFromValue(sanitizePrimitiveValue(raw));
            }
        }
        return "text";
    };
    return ordered.map((key) => ({
        key,
        label: key,
        type: inferTypeForKey(key),
        isCustom: false,
    }));
}
async function collectExistingDuplicateLabelsForSheet(db, scopeFilter, sheetManualColumns, headerLabelOverrides) {
    const labels = new Set();
    const manualKeySet = new Set(sheetManualColumns.map((c) => c.fieldKey));
    const overrides = headerLabelOverrides ?? {};
    for (const c of sheetManualColumns) {
        labels.add(normalizeSheetDuplicateLabel(c.label));
    }
    const coll = db.collection(collections_1.ASSETS_COLLECTION);
    const keyAgg = await coll
        .aggregate([
        { $match: scopeFilter },
        {
            $project: {
                ra: {
                    $map: {
                        input: { $objectToArray: { $ifNull: ["$rawData", {}] } },
                        as: "x",
                        in: "$$x.k",
                    },
                },
            },
        },
        { $unwind: "$ra" },
        { $group: { _id: "$ra" } },
    ])
        .toArray();
    for (const row of keyAgg) {
        const k = row._id;
        if (manualKeySet.has(k))
            continue;
        const display = overrides[k] ?? k;
        labels.add(normalizeSheetDuplicateLabel(display));
    }
    return labels;
}
function formatForExport(value) {
    if (typeof value === "boolean") {
        return value ? "نعم" : "لا";
    }
    return value;
}
async function appendSheetManualColumnToImportDoc(db, projectId, importOid, sheetName, entry) {
    const coll = db.collection(collections_1.ASSET_IMPORTS_COLLECTION);
    const doc = await coll.findOne({ _id: importOid, projectId });
    if (!doc)
        return;
    const sheets = [...(doc.sheetManualColumnSheets ?? [])];
    const idx = sheets.findIndex((s) => s.sheetName === sheetName);
    if (idx === -1) {
        sheets.push({ sheetName, columns: [entry] });
    }
    else {
        const prev = sheets[idx];
        sheets[idx] = { ...prev, columns: [...prev.columns, entry] };
    }
    await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
}
async function removeSheetManualColumnFromImportDoc(db, projectId, importOid, sheetName, fieldKey) {
    const coll = db.collection(collections_1.ASSET_IMPORTS_COLLECTION);
    const doc = await coll.findOne({ _id: importOid, projectId });
    if (!doc?.sheetManualColumnSheets?.length)
        return;
    const sheets = doc.sheetManualColumnSheets
        .map((s) => s.sheetName === sheetName
        ? { ...s, columns: s.columns.filter((c) => c.fieldKey !== fieldKey) }
        : s)
        .filter((s) => s.columns.length > 0);
    await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
}
let AssetsService = class AssetsService {
    constructor(projectAccess, listCache, auditService) {
        this.projectAccess = projectAccess;
        this.listCache = listCache;
        this.auditService = auditService;
    }
    projectAccessOpts(activeCompanyId, extra) {
        return {
            activeCompanyId: activeCompanyId ?? null,
            ...extra,
        };
    }
    async listAssetImports(query, user, activeCompanyId) {
        const projectId = toObjectId(query.projectId, "Ù…Ø¹Ø±Ù Ø§Ù„Ù…Ø´Ø±ÙˆØ¹");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const imports = await db
            .collection(collections_1.ASSET_IMPORTS_COLLECTION)
            .find({ projectId, status: "completed" })
            .project({
            _id: 1,
            warnings: 1,
            importedAt: 1,
        })
            .sort({ importedAt: 1, _id: 1 })
            .toArray();
        const importSortIndex = new Map(imports.map((doc, index) => [doc._id.toString(), index]));
        const assetMatch = (0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            importId: { $exists: true, $ne: null },
            sheetName: { $type: "string", $ne: "" },
        });
        const [sheetRows, byTypeRows] = await Promise.all([
            db
                .collection(collections_1.ASSETS_COLLECTION)
                .aggregate([
                { $match: assetMatch },
                {
                    $project: {
                        importId: 1,
                        sheetName: 1,
                        rawKeys: {
                            $map: {
                                input: { $objectToArray: { $ifNull: ["$rawData", {}] } },
                                as: "kv",
                                in: "$$kv.k",
                            },
                        },
                    },
                },
                {
                    $group: {
                        _id: { importId: "$importId", sheetName: "$sheetName" },
                        rowCount: { $sum: 1 },
                        rawKeyLists: { $addToSet: "$rawKeys" },
                    },
                },
            ])
                .toArray(),
            db
                .collection(collections_1.ASSETS_COLLECTION)
                .aggregate([
                { $match: assetMatch },
                { $group: { _id: "$assetType", count: { $sum: 1 } } },
            ])
                .toArray(),
        ]);
        const sheets = sheetRows.map((row) => {
            const columnKeys = new Set();
            for (const list of row.rawKeyLists ?? []) {
                if (!Array.isArray(list))
                    continue;
                for (const key of list) {
                    if (typeof key === "string" && key.length > 0)
                        columnKeys.add(key);
                }
            }
            return {
                importId: row._id.importId.toString(),
                sheetName: row._id.sheetName,
                rowCount: row.rowCount,
                columnCount: columnKeys.size,
            };
        });
        sheets.sort((a, b) => {
            const ai = importSortIndex.get(a.importId ?? "") ?? Number.MAX_SAFE_INTEGER;
            const bi = importSortIndex.get(b.importId ?? "") ?? Number.MAX_SAFE_INTEGER;
            if (ai !== bi)
                return ai - bi;
            return a.sheetName.localeCompare(b.sheetName, "ar");
        });
        const byType = {
            vehicles: 0,
            machinery: 0,
            electronics: 0,
            furniture: 0,
            other: 0,
        };
        for (const row of byTypeRows) {
            if (row._id in byType) {
                byType[row._id] = row.count;
            }
        }
        const latestImportId = (imports.length > 0 ? imports[imports.length - 1]?._id.toString() : undefined) ??
            sheets[sheets.length - 1]?.importId ??
            "";
        return {
            success: true,
            projectId: projectId.toString(),
            importId: latestImportId,
            summary: {
                totalSheets: sheets.length,
                totalRows: sheets.reduce((total, sheet) => total + sheet.rowCount, 0),
                byType,
                warnings: imports.flatMap((doc) => doc.warnings ?? []),
                sheets,
            },
        };
    }
    async listAssets(query, user, activeCompanyId) {
        const projectId = toObjectId(query.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));
        const sheetNameFilter = query.sheetName && query.sheetName.trim().length > 0
            ? (0, asset_import_utils_1.sanitizeTextInput)(query.sheetName)
            : null;
        const useSheetColumns = Boolean(query.sheetColumns && query.importId);
        const implicitListOrder = !query.sortBy?.trim() && query.importId && sheetNameFilter
            ? "rowIndexAsc"
            : "importedAtDesc";
        const normalizedQuery = {
            projectId: query.projectId,
            importId: query.importId ?? null,
            sheetName: sheetNameFilter,
            assetType: query.assetType ?? null,
            sortBy: query.sortBy ?? null,
            sortOrder: query.sortOrder ?? "desc",
            page: query.page,
            limit: query.limit,
            sheetColumns: useSheetColumns,
            schemaAssetType: query.schemaAssetType ?? null,
            implicitListOrder,
        };
        const cacheKey = buildCacheKey(normalizedQuery);
        const cached = await this.listCache.get(query.projectId, cacheKey);
        if (cached) {
            return cached;
        }
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const filter = (0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            ...(query.importId ? { importId: toObjectId(query.importId, "معرف الاستيراد") } : {}),
            ...(sheetNameFilter ? { sheetName: sheetNameFilter } : {}),
            ...(query.assetType ? { assetType: query.assetType } : {}),
        });
        const schemaForCustom = (query.schemaAssetType ?? query.assetType);
        const [total, customColumnDocs] = await Promise.all([
            db.collection(collections_1.ASSETS_COLLECTION).countDocuments(filter),
            schemaForCustom
                ? this.getCustomColumns(projectId, schemaForCustom)
                : Promise.resolve([]),
        ]);
        const sortField = await this.resolveSortField(projectId, schemaForCustom ?? (useSheetColumns ? "other" : undefined), query.sortBy);
        const sortOrder = normalizeOrder(query.sortOrder);
        const skip = (query.page - 1) * query.limit;
        const pipeline = [{ $match: filter }];
        const sortByKey = (0, asset_import_utils_1.sanitizeTextInput)(query.sortBy ?? "");
        if (sortField) {
            pipeline.push({
                $addFields: {
                    __sortValue: sortByKey === "rowIndex"
                        ? { $ifNull: ["$rowIndex", 2147483647] }
                        : {
                            $ifNull: [sortField.primaryPath, sortField.fallbackPath],
                        },
                },
            });
            pipeline.push({
                $sort: sortByKey === "rowIndex"
                    ? {
                        __sortValue: sortOrder,
                        _id: 1,
                    }
                    : {
                        __sortValue: sortOrder,
                        importedAt: -1,
                        _id: 1,
                    },
            });
        }
        else if (implicitListOrder === "rowIndexAsc") {
            pipeline.push({
                $addFields: {
                    __sheetRowOrder: {
                        $ifNull: ["$rowIndex", 2147483647],
                    },
                },
            });
            pipeline.push({
                $sort: {
                    __sheetRowOrder: 1,
                    _id: 1,
                },
            });
        }
        else {
            pipeline.push({
                $sort: {
                    importedAt: -1,
                    _id: 1,
                },
            });
        }
        pipeline.push({ $skip: skip });
        pipeline.push({ $limit: query.limit });
        pipeline.push({
            $project: {
                __sortValue: 0,
                __sheetRowOrder: 0,
            },
        });
        const docs = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .aggregate(pipeline)
            .toArray();
        const items = docs.map((doc) => this.toAssetListItem(doc));
        const customDescriptors = customColumnDocs.map((column) => ({
            key: column.fieldKey,
            label: column.columnName,
            type: column.columnType,
            isCustom: true,
        }));
        let sheetManualDescriptors = [];
        let sheetHeaderLabelOverrides = {};
        if (useSheetColumns && query.importId && sheetNameFilter) {
            const importMeta = await db.collection(collections_1.ASSET_IMPORTS_COLLECTION).findOne({ _id: toObjectId(query.importId, "معرف الاستيراد"), projectId }, { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } });
            sheetHeaderLabelOverrides = importMeta?.sheetColumnHeaderLabels?.[sheetNameFilter] ?? {};
            const manualEntry = importMeta?.sheetManualColumnSheets?.find((s) => s.sheetName === sheetNameFilter);
            sheetManualDescriptors = (manualEntry?.columns ?? []).map((c) => ({
                key: c.fieldKey,
                label: c.label,
                type: "text",
                isCustom: true,
            }));
        }
        const columns = await (async () => {
            const manualKeys = new Set(sheetManualDescriptors.map((column) => column.key));
            const dynamics = await collectOrderedSheetDataColumns(db, filter, manualKeys, docs);
            const dynamicsSafe = dynamics.filter((column) => !manualKeys.has(column.key));
            const overrides = useSheetColumns && sheetNameFilter ? sheetHeaderLabelOverrides : {};
            const dynamicsWithLabels = dynamicsSafe.map((column) => ({
                ...column,
                label: overrides[column.key] ?? column.label,
            }));
            const dynamicKeys = new Set([
                ...dynamicsWithLabels.map((column) => column.key),
                ...sheetManualDescriptors.map((column) => column.key),
            ]);
            const trailingCustom = customDescriptors.filter((column) => !dynamicKeys.has(column.key));
            return [...dynamicsWithLabels, ...sheetManualDescriptors, ...trailingCustom];
        })();
        const payload = {
            items,
            columns,
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.max(Math.ceil(total / query.limit), 1),
        };
        await this.listCache.set(query.projectId, cacheKey, payload);
        return payload;
    }
    async updateAsset(assetId, body, user, activeCompanyId) {
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetObjectId = toObjectId(assetId, "معرف الأصل");
        const asset = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .findOne((0, collections_1.spreadsheetAssetsFilter)({ _id: assetObjectId }));
        if (!asset) {
            throw new common_1.NotFoundException("الأصل غير موجود.");
        }
        if (body.projectId && body.projectId !== asset.projectId.toString()) {
            throw new common_1.BadRequestException("projectId لا يطابق الأصل المطلوب تعديله.");
        }
        await this.projectAccess.assertProjectAccess(asset.projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const normalizedChanges = await this.normalizeChanges(asset.projectId, asset.assetType, body.changes);
        const updateDocument = this.buildUpdateDocument(normalizedChanges);
        await db.collection(collections_1.ASSETS_COLLECTION).updateOne({ _id: assetObjectId }, updateDocument);
        const updated = await db.collection(collections_1.ASSETS_COLLECTION).findOne({ _id: assetObjectId });
        if (!updated) {
            throw new common_1.NotFoundException("تعذر إعادة قراءة الأصل بعد التعديل.");
        }
        await this.listCache.invalidateProject(asset.projectId.toString());
        await this.auditService.log(asset.projectId, getActor(user), "update", this.buildAuditChanges(asset, normalizedChanges), {
            assetId: asset._id,
            assetType: asset.assetType,
        });
        return this.toAssetListItem(updated);
    }
    async bulkReassignAssetType(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
        const count = await db.collection(collections_1.ASSETS_COLLECTION).countDocuments((0, collections_1.spreadsheetAssetsFilter)({
            _id: { $in: assetIds },
            projectId,
        }));
        if (count !== assetIds.length) {
            throw new common_1.NotFoundException("تعذر العثور على بعض الأصول المحددة في هذا المشروع.");
        }
        const now = new Date();
        const result = await db.collection(collections_1.ASSETS_COLLECTION).updateMany((0, collections_1.spreadsheetAssetsFilter)({ _id: { $in: assetIds }, projectId }), { $set: { assetType: body.assetType, updatedAt: now } });
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.log(projectId, getActor(user), "bulk_update", {
            action: "bulk_reassign_asset_type",
            assetIds: body.assetIds,
            newAssetType: body.assetType,
            modifiedCount: result.modifiedCount,
        });
        return {
            success: true,
            modifiedCount: result.modifiedCount,
            assetType: body.assetType,
        };
    }
    async bulkUpdateAssets(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
        const assets = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .find((0, collections_1.spreadsheetAssetsFilter)({ _id: { $in: assetIds }, projectId }))
            .toArray();
        if (assets.length !== assetIds.length) {
            throw new common_1.NotFoundException("تعذر العثور على بعض الأصول المحددة.");
        }
        const operations = [];
        const auditEntries = [];
        for (const asset of assets) {
            const normalizedChanges = await this.normalizeChanges(asset.projectId, asset.assetType, body.changes);
            operations.push({
                updateOne: {
                    filter: { _id: asset._id, projectId },
                    update: this.buildUpdateDocument(normalizedChanges),
                },
            });
            auditEntries.push({
                projectId,
                actor: getActor(user),
                action: "bulk_update",
                changes: this.buildAuditChanges(asset, normalizedChanges),
                assetId: asset._id,
                assetType: asset.assetType,
            });
        }
        const result = await db.collection(collections_1.ASSETS_COLLECTION).bulkWrite(operations, {
            ordered: false,
        });
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.logMany(auditEntries);
        return {
            success: true,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            assetIds: body.assetIds,
        };
    }
    async deleteAsset(assetId, user, activeCompanyId) {
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetObjectId = toObjectId(assetId, "معرف الأصل");
        const asset = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .findOne((0, collections_1.spreadsheetAssetsFilter)({ _id: assetObjectId }));
        if (!asset) {
            throw new common_1.NotFoundException("الأصل غير موجود.");
        }
        await this.projectAccess.assertProjectAccess(asset.projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        await db.collection(collections_1.ASSETS_COLLECTION).deleteOne({ _id: assetObjectId });
        await this.listCache.invalidateProject(asset.projectId.toString());
        await this.auditService.log(asset.projectId, getActor(user), "delete", {
            assetId: asset.assetId,
            assetType: asset.assetType,
            assetName: asset.assetName ?? null,
        }, {
            assetId: asset._id,
            assetType: asset.assetType,
        });
        return { success: true, assetId };
    }
    async deleteImportSheet(query, user, activeCompanyId) {
        const projectId = toObjectId(query.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const importId = toObjectId(query.importId, "معرف الاستيراد");
        const sheetName = (0, asset_import_utils_1.sanitizeTextInput)(query.sheetName);
        if (!sheetName) {
            throw new common_1.BadRequestException("اسم الورقة غير صالح.");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const result = await db.collection(collections_1.ASSETS_COLLECTION).deleteMany((0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            importId,
            sheetName,
        }));
        const importDoc = await db
            .collection(collections_1.ASSET_IMPORTS_COLLECTION)
            .findOne({ _id: importId, projectId }, { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } });
        const updates = {};
        if (importDoc?.sheetManualColumnSheets?.some((s) => s.sheetName === sheetName)) {
            updates.sheetManualColumnSheets = importDoc.sheetManualColumnSheets.filter((s) => s.sheetName !== sheetName);
        }
        if (importDoc?.sheetColumnHeaderLabels && sheetName in importDoc.sheetColumnHeaderLabels) {
            const nextLabels = { ...importDoc.sheetColumnHeaderLabels };
            delete nextLabels[sheetName];
            updates.sheetColumnHeaderLabels = nextLabels;
        }
        if (Object.keys(updates).length > 0) {
            await db.collection(collections_1.ASSET_IMPORTS_COLLECTION).updateOne({ _id: importId, projectId }, { $set: updates });
        }
        await this.listCache.invalidateProject(query.projectId);
        await this.auditService.log(projectId, getActor(user), "bulk_delete", {
            mode: "import_sheet",
            importId: query.importId,
            sheetName,
            deletedCount: result.deletedCount,
        });
        return { success: true, deletedCount: result.deletedCount };
    }
    async renameImportSheet(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const importId = toObjectId(body.importId, "معرف الاستيراد");
        const oldName = (0, asset_import_utils_1.sanitizeTextInput)(body.oldSheetName);
        const newName = (0, asset_import_utils_1.sanitizeTextInput)(body.newSheetName);
        if (!oldName || !newName)
            throw new common_1.BadRequestException("اسم الورقة غير صالح.");
        if (oldName === newName)
            return { success: true, modifiedCount: 0 };
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const result = await db.collection(collections_1.ASSETS_COLLECTION).updateMany((0, collections_1.spreadsheetAssetsFilter)({ projectId, importId, sheetName: oldName }), { $set: { sheetName: newName, updatedAt: new Date() } });
        const importDoc = await db
            .collection(collections_1.ASSET_IMPORTS_COLLECTION)
            .findOne({ _id: importId, projectId }, { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } });
        const sheetUpdates = {};
        if (importDoc?.sheetManualColumnSheets?.some((s) => s.sheetName === oldName)) {
            sheetUpdates.sheetManualColumnSheets = importDoc.sheetManualColumnSheets.map((s) => s.sheetName === oldName ? { ...s, sheetName: newName } : s);
        }
        if (importDoc?.sheetColumnHeaderLabels && oldName in importDoc.sheetColumnHeaderLabels) {
            const nextLabels = { ...importDoc.sheetColumnHeaderLabels };
            nextLabels[newName] = nextLabels[oldName];
            delete nextLabels[oldName];
            sheetUpdates.sheetColumnHeaderLabels = nextLabels;
        }
        if (Object.keys(sheetUpdates).length > 0) {
            await db.collection(collections_1.ASSET_IMPORTS_COLLECTION).updateOne({ _id: importId, projectId }, { $set: sheetUpdates });
        }
        await this.listCache.invalidateProject(body.projectId);
        return { success: true, modifiedCount: result.modifiedCount };
    }
    async bulkDeleteAssets(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
        const assets = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .find((0, collections_1.spreadsheetAssetsFilter)({ _id: { $in: assetIds }, projectId }))
            .toArray();
        if (assets.length !== assetIds.length) {
            throw new common_1.NotFoundException("تعذر العثور على بعض الأصول المحددة.");
        }
        const operations = assets.map((asset) => ({
            deleteOne: {
                filter: {
                    _id: asset._id,
                    projectId,
                },
            },
        }));
        const result = await db.collection(collections_1.ASSETS_COLLECTION).bulkWrite(operations, {
            ordered: false,
        });
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.logMany(assets.map((asset) => ({
            projectId,
            actor: getActor(user),
            action: "bulk_delete",
            changes: {
                assetId: asset.assetId,
                assetType: asset.assetType,
                assetName: asset.assetName ?? null,
            },
            assetId: asset._id,
            assetType: asset.assetType,
        })));
        return {
            success: true,
            deletedCount: result.deletedCount,
            assetIds: body.assetIds,
        };
    }
    async addColumn(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const sheetScoped = Boolean(body.importId?.trim() && body.sheetName?.trim());
        if (sheetScoped) {
            const importOid = toObjectId(body.importId, "معرف الاستيراد");
            const sheetNameOnly = (0, asset_import_utils_1.sanitizeTextInput)(body.sheetName);
            const importExists = await db
                .collection(collections_1.ASSET_IMPORTS_COLLECTION)
                .findOne({ _id: importOid, projectId });
            if (!importExists) {
                throw new common_1.NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
            }
            const rawLabel = typeof body.columnName === "string" ? body.columnName.replace(/\u0000/g, "") : "";
            const displayLabel = /\S/.test(rawLabel) ? rawLabel : "عمود";
            const scopeFilter = (0, collections_1.spreadsheetAssetsFilter)({
                projectId,
                assetType: body.assetType,
                importId: importOid,
                sheetName: sheetNameOnly,
            });
            const manualCols = importExists.sheetManualColumnSheets?.find((s) => s.sheetName === sheetNameOnly)?.columns ??
                [];
            const headerOverrides = importExists.sheetColumnHeaderLabels?.[sheetNameOnly] ?? {};
            const existingLabels = await collectExistingDuplicateLabelsForSheet(db, scopeFilter, manualCols, headerOverrides);
            if (existingLabels.has(normalizeSheetDuplicateLabel(displayLabel))) {
                throw new common_1.ConflictException("لا يمكن إضافة عمود باسم موجود مسبقاً. من فضلك استبدل الاسم.");
            }
            const fieldKey = (0, asset_field_definitions_1.generateSheetManualColumnFieldKey)();
            const updateResult = await db.collection(collections_1.ASSETS_COLLECTION).updateMany(scopeFilter, {
                $set: {
                    [`normalizedData.${fieldKey}`]: null,
                    [`rawData.${fieldKey}`]: null,
                    updatedAt: new Date(),
                },
            });
            await appendSheetManualColumnToImportDoc(db, projectId, importOid, sheetNameOnly, {
                fieldKey,
                label: displayLabel,
            });
            await this.listCache.invalidateProject(body.projectId);
            await this.auditService.log(projectId, getActor(user), "add_column", {
                assetType: body.assetType,
                columnName: displayLabel,
                fieldKey,
                columnType: body.columnType,
                updatedAssets: updateResult.matchedCount,
                sheetScoped: true,
                importId: body.importId,
                sheetName: sheetNameOnly,
            });
            return {
                success: true,
                column: {
                    key: fieldKey,
                    label: displayLabel,
                    type: body.columnType,
                    isCustom: true,
                },
                updatedAssets: updateResult.matchedCount,
            };
        }
        const columnName = (0, asset_import_utils_1.sanitizeTextInput)(body.columnName);
        if (!columnName) {
            throw new common_1.BadRequestException("اسم العمود مطلوب.");
        }
        const fieldKey = (0, asset_field_definitions_1.sanitizeCustomColumnKey)(columnName);
        if ((0, asset_field_definitions_1.isUnsafeMongoFieldKey)(fieldKey)) {
            throw new common_1.BadRequestException("اسم العمود يحتوي على محارف غير صالحة.");
        }
        const existingConfig = await db
            .collection(collections_1.ASSET_COLUMN_CONFIGS_COLLECTION)
            .findOne({
            projectId,
            assetType: body.assetType,
            $or: [{ fieldKey }, { columnName }],
        });
        if (existingConfig) {
            throw new common_1.ConflictException("يوجد عمود بنفس الاسم أو المفتاح مسبقاً.");
        }
        const overlappingAsset = await db.collection(collections_1.ASSETS_COLLECTION).findOne((0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            assetType: body.assetType,
            $or: [
                { [`normalizedData.${fieldKey}`]: { $exists: true } },
                { [`rawData.${fieldKey}`]: { $exists: true } },
                { [`rawData.${columnName}`]: { $exists: true } },
            ],
        }));
        if (overlappingAsset) {
            throw new common_1.ConflictException("يوجد حقل موجود فعلياً بنفس المفتاح داخل بيانات الأصول.");
        }
        const doc = {
            _id: new mongodb_1.ObjectId(),
            projectId,
            assetType: body.assetType,
            columnName,
            fieldKey,
            columnType: body.columnType,
            createdAt: new Date(),
            createdBy: user._id.toString(),
        };
        await db.collection(collections_1.ASSET_COLUMN_CONFIGS_COLLECTION).insertOne(doc);
        const updateResult = await db.collection(collections_1.ASSETS_COLLECTION).updateMany((0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            assetType: body.assetType,
        }), {
            $set: {
                [`normalizedData.${fieldKey}`]: null,
                updatedAt: new Date(),
            },
        });
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.log(projectId, getActor(user), "add_column", {
            assetType: body.assetType,
            columnName,
            fieldKey,
            columnType: body.columnType,
            updatedAssets: updateResult.matchedCount,
        });
        return {
            success: true,
            column: {
                key: fieldKey,
                label: columnName,
                type: body.columnType,
                isCustom: true,
            },
            updatedAssets: updateResult.matchedCount,
        };
    }
    async renameSheetColumn(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const fieldKey = body.fieldKey.replace(/\u0000/g, "");
        if (!fieldKey.trim()) {
            throw new common_1.BadRequestException("مفتاح العمود غير صالح.");
        }
        const importOid = toObjectId(body.importId, "معرف الاستيراد");
        const sheetNameOnly = (0, asset_import_utils_1.sanitizeTextInput)(body.sheetName);
        const rawNew = typeof body.newLabel === "string" ? body.newLabel.replace(/\u0000/g, "") : "";
        const displayLabel = /\S/.test(rawNew) ? rawNew : "عمود";
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const importDoc = await db
            .collection(collections_1.ASSET_IMPORTS_COLLECTION)
            .findOne({ _id: importOid, projectId });
        if (!importDoc) {
            throw new common_1.NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
        }
        const scopeFilter = (0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            assetType: body.assetType,
            importId: importOid,
            sheetName: sheetNameOnly,
        });
        const manualCols = importDoc.sheetManualColumnSheets?.find((s) => s.sheetName === sheetNameOnly)?.columns ?? [];
        const manualEntry = manualCols.find((c) => c.fieldKey === fieldKey);
        const currentEffective = manualEntry
            ? manualEntry.label
            : importDoc.sheetColumnHeaderLabels?.[sheetNameOnly]?.[fieldKey] ?? fieldKey;
        const labelsExcluding = await collectExistingDuplicateLabelsForSheet(db, scopeFilter, manualCols, importDoc.sheetColumnHeaderLabels?.[sheetNameOnly]);
        labelsExcluding.delete(normalizeSheetDuplicateLabel(currentEffective));
        if (labelsExcluding.has(normalizeSheetDuplicateLabel(displayLabel))) {
            throw new common_1.ConflictException("لا يمكن إضافة عمود باسم موجود مسبقاً. من فضلك استبدل الاسم.");
        }
        const coll = db.collection(collections_1.ASSET_IMPORTS_COLLECTION);
        if (manualEntry) {
            const sheets = [...(importDoc.sheetManualColumnSheets ?? [])];
            const si = sheets.findIndex((s) => s.sheetName === sheetNameOnly);
            if (si === -1) {
                throw new common_1.BadRequestException("تعذّر العثور على الورقة في سجل الاستيراد.");
            }
            sheets[si] = {
                ...sheets[si],
                columns: sheets[si].columns.map((c) => c.fieldKey === fieldKey ? { ...c, label: displayLabel } : c),
            };
            await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
        }
        else {
            const nextHeader = {
                ...(importDoc.sheetColumnHeaderLabels ?? {}),
            };
            const sheetMap = { ...(nextHeader[sheetNameOnly] ?? {}) };
            sheetMap[fieldKey] = displayLabel;
            nextHeader[sheetNameOnly] = sheetMap;
            await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetColumnHeaderLabels: nextHeader } });
        }
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.log(projectId, getActor(user), "update", {
            actionDetail: "rename_sheet_column",
            fieldKey,
            newLabel: displayLabel,
            sheetName: sheetNameOnly,
            importId: body.importId,
        });
        return {
            success: true,
            column: {
                key: fieldKey,
                label: displayLabel,
                type: "text",
                isCustom: Boolean(manualEntry),
            },
        };
    }
    async createBlankImportRow(body, user, activeCompanyId) {
        const projectId = toObjectId(body.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const importOid = toObjectId(body.importId, "معرف الاستيراد");
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const importExists = await db
            .collection(collections_1.ASSET_IMPORTS_COLLECTION)
            .findOne({ _id: importOid, projectId });
        if (!importExists) {
            throw new common_1.NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
        }
        const explicitSheet = body.sheetName?.trim()
            ? (0, asset_import_utils_1.sanitizeTextInput)(body.sheetName)
            : undefined;
        const rowFilter = (0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            importId: importOid,
            ...(explicitSheet ? { sheetName: explicitSheet } : {}),
        });
        const maxAgg = await db
            .collection(collections_1.ASSETS_COLLECTION)
            .aggregate([
            { $match: rowFilter },
            { $group: { _id: null, m: { $max: "$rowIndex" } } },
        ])
            .toArray();
        const maxRi = maxAgg[0]?.m;
        const nextRowIndex = (typeof maxRi === "number" && Number.isFinite(maxRi) ? maxRi : 0) + 1;
        let resolvedSheetName = explicitSheet;
        if (!resolvedSheetName) {
            const anyInScope = await db
                .collection(collections_1.ASSETS_COLLECTION)
                .findOne(rowFilter, { projection: { sheetName: 1 } });
            resolvedSheetName = anyInScope?.sheetName ?? undefined;
        }
        const importedAt = new Date();
        const assetObjectId = new mongodb_1.ObjectId();
        const normalizedData = {};
        const rawData = {};
        const manualCols = resolvedSheetName && importExists.sheetManualColumnSheets
            ? importExists.sheetManualColumnSheets.find((s) => s.sheetName === resolvedSheetName)?.columns ??
                []
            : [];
        for (const mc of manualCols) {
            rawData[mc.fieldKey] = null;
            normalizedData[mc.fieldKey] = null;
        }
        const newDoc = {
            _id: assetObjectId,
            assetId: assetObjectId.toString(),
            importId: importOid,
            projectId,
            assetType: "other",
            rawData,
            normalizedData,
            name: `صف ${nextRowIndex}`,
            ...(resolvedSheetName ? { sheetName: resolvedSheetName } : {}),
            rowIndex: nextRowIndex,
            importedAt,
            updatedAt: importedAt,
            status: "pending_review",
            hasNotes: false,
            notes: "",
            ...(0, asset_import_utils_1.emptyMvPhotoFieldsForImportedAssetRow)({
                createdBy: user._id,
                createdAt: importedAt,
            }),
        };
        await db.collection(collections_1.ASSETS_COLLECTION).insertOne(newDoc);
        await db.collection(collections_1.ASSETS_COLLECTION).updateOne({ _id: assetObjectId, projectId }, {
            $set: (0, asset_import_utils_1.emptyMvPhotoFieldsForImportedAssetRow)({
                createdBy: user._id,
                createdAt: importedAt,
            }),
        });
        await this.listCache.invalidateProject(body.projectId);
        await this.auditService.log(projectId, getActor(user), "import", {
            createdBlankRow: true,
            importId: body.importId,
            assetId: newDoc.assetId,
            rowIndex: nextRowIndex,
        });
        const inserted = await db.collection(collections_1.ASSETS_COLLECTION).findOne({ _id: assetObjectId });
        if (!inserted) {
            throw new common_1.NotFoundException("تعذر إنشاء الصف.");
        }
        return this.toAssetListItem(inserted);
    }
    async deleteColumn(columnNameOrKey, query, user, activeCompanyId) {
        const projectId = toObjectId(query.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const incomingName = (0, asset_import_utils_1.sanitizeTextInput)(columnNameOrKey);
        const columnConfig = await db
            .collection(collections_1.ASSET_COLUMN_CONFIGS_COLLECTION)
            .findOne({
            projectId,
            assetType: query.assetType,
            $or: [{ fieldKey: incomingName }, { columnName: incomingName }],
        });
        const fieldKey = columnConfig?.fieldKey ?? incomingName;
        if ((0, asset_field_definitions_1.isUnsafeMongoFieldKey)(fieldKey)) {
            throw new common_1.BadRequestException("اسم العمود المطلوب حذفه غير صالح.");
        }
        if (columnConfig && !query.sheetName?.trim()) {
            await db.collection(collections_1.ASSET_COLUMN_CONFIGS_COLLECTION).deleteOne({
                _id: columnConfig._id,
            });
        }
        const unsetPayload = {
            [`normalizedData.${fieldKey}`]: "",
            [`rawData.${fieldKey}`]: "",
        };
        if (columnConfig?.columnName && columnConfig.columnName !== fieldKey) {
            unsetPayload[`rawData.${columnConfig.columnName}`] = "";
        }
        const importFilter = query.importId && query.sheetName?.trim()
            ? {
                importId: toObjectId(query.importId, "معرف الاستيراد"),
                sheetName: (0, asset_import_utils_1.sanitizeTextInput)(query.sheetName),
            }
            : query.importId
                ? { importId: toObjectId(query.importId, "معرف الاستيراد") }
                : {};
        const updateResult = await db.collection(collections_1.ASSETS_COLLECTION).updateMany((0, collections_1.spreadsheetAssetsFilter)({
            projectId,
            assetType: query.assetType,
            ...importFilter,
        }), {
            $unset: unsetPayload,
            $set: { updatedAt: new Date() },
        });
        if (query.importId &&
            query.sheetName?.trim() &&
            (0, asset_field_definitions_1.isSheetManualColumnStorageKey)(fieldKey)) {
            await removeSheetManualColumnFromImportDoc(db, projectId, toObjectId(query.importId, "معرف الاستيراد"), (0, asset_import_utils_1.sanitizeTextInput)(query.sheetName), fieldKey);
        }
        await this.listCache.invalidateProject(query.projectId);
        await this.auditService.log(projectId, getActor(user), "delete_column", {
            assetType: query.assetType,
            importId: query.importId ?? null,
            columnName: columnConfig?.columnName ?? incomingName,
            fieldKey,
            updatedAssets: updateResult.matchedCount,
        });
        return {
            success: true,
            deletedColumn: fieldKey,
            updatedAssets: updateResult.matchedCount,
        };
    }
    async exportAssets(query, user, activeCompanyId) {
        const projectId = toObjectId(query.projectId, "معرف المشروع");
        await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const assetTypes = query.assetType ? [query.assetType] : EXPORTABLE_TYPES;
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Spark Vision";
        workbook.created = new Date();
        workbook.modified = new Date();
        for (const assetType of assetTypes) {
            const scopeFilter = (0, collections_1.spreadsheetAssetsFilter)({ projectId, assetType });
            const [assets, customColumns] = await Promise.all([
                db
                    .collection(collections_1.ASSETS_COLLECTION)
                    .find(scopeFilter, {
                    projection: { rawData: 1, normalizedData: 1, assetId: 1 },
                })
                    .sort({ importedAt: -1 })
                    .toArray(),
                this.getCustomColumns(projectId, assetType),
            ]);
            if (assets.length === 0) {
                continue;
            }
            const customColumnDescriptors = customColumns.map((column) => ({
                key: column.fieldKey,
                label: column.columnName,
                type: column.columnType,
                isCustom: true,
            }));
            const dynamics = await collectOrderedSheetDataColumns(db, scopeFilter, new Set(), assets);
            const dynamicKeys = new Set(dynamics.map((c) => c.key));
            const trailingCustom = customColumnDescriptors.filter((c) => !dynamicKeys.has(c.key));
            const columns = [...dynamics, ...trailingCustom];
            const worksheet = workbook.addWorksheet(assetType, {
                views: [{ rightToLeft: true }],
            });
            worksheet.columns = columns.map((column) => ({
                header: column.label,
                key: column.key,
                width: Math.max(18, Math.min(28, column.label.length + 6)),
            }));
            assets.forEach((asset) => {
                const row = {};
                columns.forEach((column) => {
                    row[column.key] = formatForExport(resolveAssetFieldValue(asset, column.key));
                });
                worksheet.addRow(row);
            });
        }
        if (workbook.worksheets.length === 0) {
            const emptySheet = workbook.addWorksheet("assets", {
                views: [{ rightToLeft: true }],
            });
            emptySheet.addRow(["لا توجد بيانات للتصدير"]);
        }
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer;
    }
    async resolveSortField(_projectId, _assetType, requestedSortBy) {
        const sortBy = (0, asset_import_utils_1.sanitizeTextInput)(requestedSortBy ?? "");
        if (!sortBy)
            return null;
        if (sortBy === "rowIndex") {
            return {
                primaryPath: "$rowIndex",
                fallbackPath: "$rowIndex",
            };
        }
        if ((0, asset_field_definitions_1.isUnsafeMongoFieldKey)(sortBy)) {
            return null;
        }
        return {
            primaryPath: `$rawData.${sortBy}`,
            fallbackPath: `$normalizedData.${sortBy}`,
        };
    }
    async getCustomColumns(projectId, assetType) {
        const db = await (0, mongodb_2.getMongoDb)();
        return db
            .collection(collections_1.ASSET_COLUMN_CONFIGS_COLLECTION)
            .find({
            projectId,
            assetType,
        }, {
            projection: {
                fieldKey: 1,
                columnName: 1,
                columnType: 1,
                assetType: 1,
                projectId: 1,
                createdAt: 1,
                createdBy: 1,
            },
        })
            .sort({ createdAt: 1 })
            .toArray();
    }
    async normalizeChanges(projectId, assetType, rawChanges) {
        const customColumns = await this.getCustomColumns(projectId, assetType);
        const customTypeMap = new Map(customColumns.map((column) => [column.fieldKey, column.columnType]));
        const normalizedChanges = {};
        Object.entries(rawChanges).forEach(([rawFieldKey, rawValue]) => {
            const fieldKey = (0, asset_import_utils_1.sanitizeTextInput)(rawFieldKey);
            if (fieldKey === "projectId" || fieldKey === "assetType" || fieldKey === "_id") {
                throw new common_1.BadRequestException(`الحقل "${fieldKey}" غير قابل للتعديل.`);
            }
            if ((0, asset_field_definitions_1.isUnsafeMongoFieldKey)(fieldKey)) {
                throw new common_1.BadRequestException(`اسم الحقل "${rawFieldKey}" غير صالح.`);
            }
            const expectedType = customTypeMap.get(fieldKey) ?? inferColumnTypeFromValue(sanitizePrimitiveValue(rawValue));
            normalizedChanges[fieldKey] = parseColumnValue(fieldKey, rawValue, expectedType);
        });
        if (Object.keys(normalizedChanges).length === 0) {
            throw new common_1.BadRequestException("لا توجد حقول صالحة للتعديل.");
        }
        return normalizedChanges;
    }
    buildUpdateDocument(changes) {
        const now = new Date();
        const $set = {
            updatedAt: now,
        };
        Object.entries(changes).forEach(([fieldKey, value]) => {
            $set[`rawData.${fieldKey}`] = value;
            $set[`normalizedData.${fieldKey}`] = value;
        });
        return {
            $set,
        };
    }
    buildAuditChanges(asset, changes) {
        return Object.fromEntries(Object.entries(changes).map(([fieldKey, nextValue]) => [
            fieldKey,
            {
                before: resolveAssetFieldValue(asset, fieldKey),
                after: nextValue,
            },
        ]));
    }
    toAssetListItem(doc) {
        const basePayload = {
            id: doc._id.toString(),
            importId: doc.importId?.toString() ?? null,
            projectId: doc.projectId.toString(),
            assetType: doc.assetType,
            rawData: doc.rawData ?? {},
            normalizedData: doc.normalizedData ?? {},
            name: doc.name ?? null,
            sheetName: doc.sheetName ?? null,
            rowIndex: doc.rowIndex ?? null,
            importedAt: doc.importedAt.toISOString(),
            updatedAt: (doc.updatedAt ?? doc.importedAt).toISOString(),
            status: doc.status,
            hasNotes: doc.hasNotes === true,
            notes: typeof doc.notes === "string" ? doc.notes : "",
        };
        return basePayload;
    }
};
exports.AssetsService = AssetsService;
exports.AssetsService = AssetsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [asset_project_access_service_1.AssetProjectAccessService,
        asset_list_cache_service_1.AssetListCacheService,
        asset_audit_service_1.AssetAuditService])
], AssetsService);
