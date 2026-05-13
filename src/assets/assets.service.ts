import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { ObjectId, type Filter, type UpdateFilter } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import type { UserMongoDoc } from "@/server/auth-tracking/types";
import { AssetAuditService, type AssetAuditActor } from "./asset-audit.service";
import { AssetListCacheService } from "./asset-list-cache.service";
import {
  ASSET_COLUMN_CONFIGS_COLLECTION,
  ASSET_IMPORTS_COLLECTION,
  ASSETS_COLLECTION,
  ensureAssetsCollectionsInitialized,
  spreadsheetAssetsFilter,
} from "./collections";
import {
  generateSheetManualColumnFieldKey,
  isSheetManualColumnStorageKey,
  isUnsafeMongoFieldKey,
  sanitizeCustomColumnKey,
} from "./asset-field-definitions";
import { AssetProjectAccessService } from "./asset-project-access.service";
import {
  emptyMvPhotoFieldsForImportedAssetRow,
  isProbablyNumericText,
  parseBooleanValue,
  parseDateValue,
  parseNumberValue,
  parseStringValue,
  sanitizeTextInput,
} from "./asset-import.utils";
import type {
  AssetColumnConfigDoc,
  AssetColumnDescriptor,
  AssetColumnType,
  AssetDoc,
  AssetImportDoc,
  AssetImportManualColumnEntry,
  AssetImportResult,
  AssetImportSheetStat,
  AssetNormalizedData,
  AssetPrimitive,
  AssetRawData,
  AssetType,
} from "./types";
import type {
  AddAssetColumnDto,
  BulkDeleteAssetsDto,
  BulkReassignAssetTypeDto,
  BulkUpdateAssetsDto,
  CreateBlankImportRowDto,
  DeleteAssetColumnQueryDto,
  DeleteImportSheetQueryDto,
  RenameImportSheetDto,
  RenameSheetColumnDto,
  ExportAssetsQueryDto,
  ListAssetImportsQueryDto,
  ListAssetsQueryDto,
  UpdateAssetDto,
} from "./dto/assets.dto";

const EXPORTABLE_TYPES: AssetType[] = [
  "vehicles",
  "machinery",
  "electronics",
  "furniture",
  "other",
];

type AssetImportSheetAggregateRow = {
  _id: {
    importId: ObjectId;
    sheetName: string;
  };
  rowCount: number;
  rawKeyLists: string[][];
};

type AssetListProjectionDoc = Pick<
  AssetDoc,
  | "_id"
  | "importId"
  | "projectId"
  | "assetType"
  | "rawData"
  | "normalizedData"
  | "sheetName"
  | "rowIndex"
  | "importedAt"
  | "updatedAt"
  | "status"
> &
  Partial<AssetDoc>;

function toObjectId(id: string, label = "المعرف") {
  const sanitized = sanitizeTextInput(id);
  if (!ObjectId.isValid(sanitized)) {
    throw new BadRequestException(`${label} غير صالح.`);
  }
  return new ObjectId(sanitized);
}

function buildCacheKey(value: Record<string, unknown>) {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}

function getActor(user: UserMongoDoc): AssetAuditActor {
  return {
    userId: user._id.toString(),
    username: user.username,
  };
}

function normalizeOrder(sortOrder?: string) {
  return sortOrder === "asc" ? 1 : -1;
}

function resolveAssetFieldValue(asset: Partial<AssetDoc>, fieldKey: string): AssetPrimitive {
  const directValue = asset[fieldKey as keyof AssetDoc];
  if (
    typeof directValue === "string" ||
    typeof directValue === "number" ||
    typeof directValue === "boolean" ||
    directValue === null
  ) {
    return directValue;
  }

  const normalizedValue = asset.normalizedData?.[fieldKey];
  if (normalizedValue !== undefined) return normalizedValue;

  const rawValue = asset.rawData?.[fieldKey];
  return rawValue ?? null;
}

function sanitizePrimitiveValue(value: unknown): AssetPrimitive {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const sanitized = sanitizeTextInput(value);
    return sanitized.length > 0 ? sanitized : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new BadRequestException("القيم الرقمية غير الصالحة غير مسموحة.");
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  throw new BadRequestException("القيمة المرسلة غير مدعومة.");
}

function inferColumnTypeFromValue(value: AssetPrimitive): AssetColumnType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") {
    const trimmed = sanitizeTextInput(value);
    if (trimmed && isProbablyNumericText(trimmed)) return "number";
    if (parseDateValue(value) !== undefined) return "date";
  }
  return "text";
}

function parseColumnValue(fieldKey: string, value: unknown, columnType?: AssetColumnType) {
  const sanitized = sanitizePrimitiveValue(value);
  const expectedType = columnType ?? inferColumnTypeFromValue(sanitized);

  if (sanitized === null) {
    return null;
  }

  switch (expectedType) {
    case "number": {
      const parsed = parseNumberValue(sanitized);
      if (parsed === undefined) {
        throw new BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون رقمية.`);
      }
      return parsed;
    }
    case "date": {
      const parsed = parseDateValue(sanitized);
      if (!parsed) {
        throw new BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون تاريخاً صالحاً.`);
      }
      return parsed;
    }
    case "boolean": {
      const parsed = parseBooleanValue(sanitized);
      if (parsed === undefined) {
        throw new BadRequestException(`القيمة المرسلة للحقل "${fieldKey}" يجب أن تكون منطقية.`);
      }
      return parsed;
    }
    case "text":
    default: {
      const parsed = parseStringValue(sanitized);
      return parsed ?? null;
    }
  }
}

/** أعمدة الجدول: كل مفاتيح rawData كما خُزّنت — لا نستبعد عموداً لأنه يطابق مفتاح عمود مخصص في الإعدادات. */
function collectSheetStyleDynamicColumns(assets: Partial<AssetDoc>[]): AssetColumnDescriptor[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const recordKeys = (obj: AssetRawData | undefined) => {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
  };

  for (const asset of assets) {
    recordKeys(asset.rawData);
  }

  const inferTypeForKey = (key: string): AssetColumnType => {
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

/** لمقارنة أسماء الأعمدة (استيراد + يدوي) عند منع التكرار */
function normalizeSheetDuplicateLabel(value: string): string {
  return sanitizeTextInput(value).replace(/\s+/g, " ").trim();
}

/**
 * أعمدة بيانات الورقة بترتيب ثابت: ترتيب الصف الأول (كما في الاستيراد)، ثم أي مفاتيح ظهرت لاحقاً في صفوف أخرى.
 * لا يعتمد على صفحة الجلب — يصلح اختفاء أعمدة وخلط الترتيب عند وجود أكثر من صفحة.
 */
async function collectOrderedSheetDataColumns(
  db: import("mongodb").Db,
  filter: Filter<AssetDoc>,
  manualKeySet: Set<string>,
  typeHintDocs: Partial<AssetDoc>[],
): Promise<AssetColumnDescriptor[]> {
  const coll = db.collection<AssetDoc>(ASSETS_COLLECTION);

  const keyAgg = await coll
    .aggregate<{ _id: string }>([
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

  const dataKeysSet = new Set(
    [...allKeysFromDb].filter((k) => {
      if (manualKeySet.has(k)) return false;
      return true;
    }),
  );

  const firstDoc = await coll.findOne<Pick<AssetDoc, "rawData">>(filter, {
    sort: { rowIndex: 1, _id: 1 },
    projection: { rawData: 1 },
  });

  const fromFirst = collectSheetStyleDynamicColumns(firstDoc ? [firstDoc] : []);
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const d of fromFirst) {
    if (dataKeysSet.has(d.key) && !seen.has(d.key)) {
      ordered.push(d.key);
      seen.add(d.key);
    }
  }

  const remaining = new Set<string>();
  for (const k of dataKeysSet) {
    if (!seen.has(k)) remaining.add(k);
  }

  if (remaining.size > 0) {
    const cursor = coll.find(filter, {
      projection: { rawData: 1, rowIndex: 1 },
    }).sort({ rowIndex: 1, _id: 1 });

    for await (const doc of cursor) {
      const obj = doc.rawData;
      if (!obj) continue;
      for (const key of Object.keys(obj)) {
        if (!remaining.has(key)) continue;
        ordered.push(key);
        remaining.delete(key);
        if (remaining.size === 0) break;
      }
      if (remaining.size === 0) break;
    }

    if (remaining.size > 0) {
      ordered.push(...[...remaining].sort((a, b) => a.localeCompare(b, "ar")));
    }
  }

  const inferPoolRaw = [firstDoc, ...typeHintDocs].filter(
    (d): d is Partial<AssetDoc> => Boolean(d),
  );
  const inferPool: Partial<AssetDoc>[] = [];
  const idSeen = new Set<string>();
  for (const d of inferPoolRaw) {
    const id = d._id ? String(d._id) : "";
    if (id) {
      if (idSeen.has(id)) continue;
      idSeen.add(id);
    }
    inferPool.push(d);
  }

  const inferTypeForKey = (key: string): AssetColumnType => {
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

async function collectExistingDuplicateLabelsForSheet(
  db: import("mongodb").Db,
  scopeFilter: Filter<AssetDoc>,
  sheetManualColumns: Array<{ fieldKey: string; label: string }>,
  headerLabelOverrides: Record<string, string> | undefined,
): Promise<Set<string>> {
  const labels = new Set<string>();
  const manualKeySet = new Set(sheetManualColumns.map((c) => c.fieldKey));
  const overrides = headerLabelOverrides ?? {};
  for (const c of sheetManualColumns) {
    labels.add(normalizeSheetDuplicateLabel(c.label));
  }
  const coll = db.collection<AssetDoc>(ASSETS_COLLECTION);
  const keyAgg = await coll
    .aggregate<{ _id: string }>([
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
    if (manualKeySet.has(k)) continue;
    const display = overrides[k] ?? k;
    labels.add(normalizeSheetDuplicateLabel(display));
  }
  return labels;
}

function formatForExport(value: AssetPrimitive) {
  if (typeof value === "boolean") {
    return value ? "نعم" : "لا";
  }
  return value;
}

async function appendSheetManualColumnToImportDoc(
  db: import("mongodb").Db,
  projectId: ObjectId,
  importOid: ObjectId,
  sheetName: string,
  entry: AssetImportManualColumnEntry,
) {
  const coll = db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION);
  const doc = await coll.findOne({ _id: importOid, projectId });
  if (!doc) return;
  const sheets = [...(doc.sheetManualColumnSheets ?? [])];
  const idx = sheets.findIndex((s) => s.sheetName === sheetName);
  if (idx === -1) {
    sheets.push({ sheetName, columns: [entry] });
  } else {
    const prev = sheets[idx];
    sheets[idx] = { ...prev, columns: [...prev.columns, entry] };
  }
  await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
}

async function removeSheetManualColumnFromImportDoc(
  db: import("mongodb").Db,
  projectId: ObjectId,
  importOid: ObjectId,
  sheetName: string,
  fieldKey: string,
) {
  const coll = db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION);
  const doc = await coll.findOne({ _id: importOid, projectId });
  if (!doc?.sheetManualColumnSheets?.length) return;
  const sheets = doc.sheetManualColumnSheets
    .map((s) =>
      s.sheetName === sheetName
        ? { ...s, columns: s.columns.filter((c) => c.fieldKey !== fieldKey) }
        : s,
    )
    .filter((s) => s.columns.length > 0);
  await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly projectAccess: AssetProjectAccessService,
    private readonly listCache: AssetListCacheService,
    private readonly auditService: AssetAuditService,
  ) {}

  private projectAccessOpts(
    activeCompanyId: ObjectId | null | undefined,
    extra?: { claimOwnershipIfMissing?: boolean },
  ) {
    return {
      activeCompanyId: activeCompanyId ?? null,
      ...extra,
    };
  }

  async listAssetImports(
    query: ListAssetImportsQueryDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ): Promise<AssetImportResult> {
    const projectId = toObjectId(query.projectId, "Ù…Ø¹Ø±Ù Ø§Ù„Ù…Ø´Ø±ÙˆØ¹");
    await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const imports = await db
      .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
      .find({ projectId, status: "completed" })
      .project<Pick<AssetImportDoc, "_id" | "warnings" | "importedAt">>({
        _id: 1,
        warnings: 1,
        importedAt: 1,
      })
      .sort({ importedAt: 1, _id: 1 })
      .toArray();

    const importSortIndex = new Map(imports.map((doc, index) => [doc._id.toString(), index]));
    const assetMatch: Filter<AssetDoc> = spreadsheetAssetsFilter({
      projectId,
      importId: { $exists: true, $ne: null },
      sheetName: { $type: "string", $ne: "" },
    });

    const [sheetRows, byTypeRows] = await Promise.all([
      db
        .collection<AssetDoc>(ASSETS_COLLECTION)
        .aggregate<AssetImportSheetAggregateRow>([
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
        .collection<AssetDoc>(ASSETS_COLLECTION)
        .aggregate<{ _id: AssetType; count: number }>([
          { $match: assetMatch },
          { $group: { _id: "$assetType", count: { $sum: 1 } } },
        ])
        .toArray(),
    ]);

    const sheets: AssetImportSheetStat[] = sheetRows.map((row) => {
      const columnKeys = new Set<string>();
      for (const list of row.rawKeyLists ?? []) {
        if (!Array.isArray(list)) continue;
        for (const key of list) {
          if (typeof key === "string" && key.length > 0) columnKeys.add(key);
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
      if (ai !== bi) return ai - bi;
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

    const latestImportId =
      (imports.length > 0 ? imports[imports.length - 1]?._id.toString() : undefined) ??
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

  async listAssets(query: ListAssetsQueryDto, user: UserMongoDoc, activeCompanyId?: ObjectId | null) {
    const projectId = toObjectId(query.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));

    const sheetNameFilter =
      query.sheetName && query.sheetName.trim().length > 0
        ? sanitizeTextInput(query.sheetName)
        : null;

    const useSheetColumns = Boolean(query.sheetColumns && query.importId);

    /** بدون sort صريح: داخل ورقة استيراد نرتب حسب rowIndex تصاعدياً حتى يظهر «صف جديد» في آخر الجدول وليس أعلى القائمة (كان الافتراضي importedAt تنازلياً). */
    const implicitListOrder =
      !query.sortBy?.trim() && query.importId && sheetNameFilter
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
    const cached = await this.listCache.get<{
      items: unknown[];
      columns: AssetColumnDescriptor[];
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    }>(query.projectId, cacheKey);
    if (cached) {
      return cached;
    }

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const filter: Filter<AssetDoc> = spreadsheetAssetsFilter({
      projectId,
      ...(query.importId ? { importId: toObjectId(query.importId, "معرف الاستيراد") } : {}),
      ...(sheetNameFilter ? { sheetName: sheetNameFilter } : {}),
      ...(query.assetType ? { assetType: query.assetType } : {}),
    });

    const schemaForCustom = (query.schemaAssetType ?? query.assetType) as AssetType | undefined;

    const [total, customColumnDocs] = await Promise.all([
      db.collection<AssetDoc>(ASSETS_COLLECTION).countDocuments(filter),
      schemaForCustom
        ? this.getCustomColumns(projectId, schemaForCustom)
        : Promise.resolve([] as AssetColumnConfigDoc[]),
    ]);

    const sortField = await this.resolveSortField(
      projectId,
      schemaForCustom ?? (useSheetColumns ? "other" : undefined),
      query.sortBy,
    );
    const sortOrder = normalizeOrder(query.sortOrder);
    const skip = (query.page - 1) * query.limit;

    const pipeline: Record<string, unknown>[] = [{ $match: filter }];

    const sortByKey = sanitizeTextInput(query.sortBy ?? "");

    if (sortField) {
      pipeline.push({
        $addFields: {
          __sortValue:
            sortByKey === "rowIndex"
              ? { $ifNull: ["$rowIndex", 2147483647] }
              : {
                  $ifNull: [sortField.primaryPath, sortField.fallbackPath],
                },
        },
      });
      pipeline.push({
        $sort:
          sortByKey === "rowIndex"
            ? {
                /** بدون importedAt تنازلياً — وإلا عند تساوي rowIndex يظهر الصف الجديد فوق القديم */
                __sortValue: sortOrder,
                _id: 1,
              }
            : {
                __sortValue: sortOrder,
                importedAt: -1,
                _id: 1,
              },
      });
    } else if (implicitListOrder === "rowIndexAsc") {
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
    } else {
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
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .aggregate<AssetListProjectionDoc>(pipeline)
      .toArray();

    const items = docs.map((doc) => this.toAssetListItem(doc));
    const customDescriptors = customColumnDocs.map<AssetColumnDescriptor>((column) => ({
      key: column.fieldKey,
      label: column.columnName,
      type: column.columnType,
      isCustom: true,
    }));

    let sheetManualDescriptors: AssetColumnDescriptor[] = [];
    let sheetHeaderLabelOverrides: Record<string, string> = {};
    if (useSheetColumns && query.importId && sheetNameFilter) {
      const importMeta = await db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION).findOne(
        { _id: toObjectId(query.importId, "معرف الاستيراد"), projectId },
        { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } },
      );
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
      const overrides =
        useSheetColumns && sheetNameFilter ? sheetHeaderLabelOverrides : ({} as Record<string, string>);
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

  async updateAsset(
    assetId: string,
    body: UpdateAssetDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetObjectId = toObjectId(assetId, "معرف الأصل");
    const asset = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .findOne(spreadsheetAssetsFilter({ _id: assetObjectId }));
    if (!asset) {
      throw new NotFoundException("الأصل غير موجود.");
    }

    if (body.projectId && body.projectId !== asset.projectId.toString()) {
      throw new BadRequestException("projectId لا يطابق الأصل المطلوب تعديله.");
    }

    await this.projectAccess.assertProjectAccess(
      asset.projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const normalizedChanges = await this.normalizeChanges(
      asset.projectId,
      asset.assetType,
      body.changes,
    );

    const updateDocument = this.buildUpdateDocument(normalizedChanges);
    await db.collection<AssetDoc>(ASSETS_COLLECTION).updateOne(
      { _id: assetObjectId },
      updateDocument,
    );

    const updated = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({ _id: assetObjectId });
    if (!updated) {
      throw new NotFoundException("تعذر إعادة قراءة الأصل بعد التعديل.");
    }

    await this.listCache.invalidateProject(asset.projectId.toString());
    await this.auditService.log(
      asset.projectId,
      getActor(user),
      "update",
      this.buildAuditChanges(asset, normalizedChanges),
      {
        assetId: asset._id,
        assetType: asset.assetType,
      },
    );

    return this.toAssetListItem(updated);
  }

  async bulkReassignAssetType(
    body: BulkReassignAssetTypeDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
    const count = await db.collection<AssetDoc>(ASSETS_COLLECTION).countDocuments(
      spreadsheetAssetsFilter({
        _id: { $in: assetIds },
        projectId,
      }),
    );

    if (count !== assetIds.length) {
      throw new NotFoundException("تعذر العثور على بعض الأصول المحددة في هذا المشروع.");
    }

    const now = new Date();
    const result = await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
      spreadsheetAssetsFilter({ _id: { $in: assetIds }, projectId }),
      { $set: { assetType: body.assetType, updatedAt: now } },
    );

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

  async bulkUpdateAssets(
    body: BulkUpdateAssetsDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
    const assets = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find(spreadsheetAssetsFilter({ _id: { $in: assetIds }, projectId }))
      .toArray();

    if (assets.length !== assetIds.length) {
      throw new NotFoundException("تعذر العثور على بعض الأصول المحددة.");
    }

    const operations = [];
    const auditEntries = [];
    for (const asset of assets) {
      const normalizedChanges = await this.normalizeChanges(
        asset.projectId,
        asset.assetType,
        body.changes,
      );
      operations.push({
        updateOne: {
          filter: { _id: asset._id, projectId },
          update: this.buildUpdateDocument(normalizedChanges),
        },
      });
      auditEntries.push({
        projectId,
        actor: getActor(user),
        action: "bulk_update" as const,
        changes: this.buildAuditChanges(asset, normalizedChanges),
        assetId: asset._id,
        assetType: asset.assetType,
      });
    }

    const result = await db.collection<AssetDoc>(ASSETS_COLLECTION).bulkWrite(operations, {
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

  async deleteAsset(assetId: string, user: UserMongoDoc, activeCompanyId?: ObjectId | null) {
    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetObjectId = toObjectId(assetId, "معرف الأصل");
    const asset = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .findOne(spreadsheetAssetsFilter({ _id: assetObjectId }));
    if (!asset) {
      throw new NotFoundException("الأصل غير موجود.");
    }

    await this.projectAccess.assertProjectAccess(
      asset.projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    await db.collection<AssetDoc>(ASSETS_COLLECTION).deleteOne({ _id: assetObjectId });
    await this.listCache.invalidateProject(asset.projectId.toString());
    await this.auditService.log(
      asset.projectId,
      getActor(user),
      "delete",
      {
        assetId: asset.assetId,
        assetType: asset.assetType,
        assetName: asset.assetName ?? null,
      },
      {
        assetId: asset._id,
        assetType: asset.assetType,
      },
    );

    return { success: true, assetId };
  }

  async deleteImportSheet(
    query: DeleteImportSheetQueryDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(query.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const importId = toObjectId(query.importId, "معرف الاستيراد");
    const sheetName = sanitizeTextInput(query.sheetName);
    if (!sheetName) {
      throw new BadRequestException("اسم الورقة غير صالح.");
    }

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const result = await db.collection<AssetDoc>(ASSETS_COLLECTION).deleteMany(
      spreadsheetAssetsFilter({
        projectId,
        importId,
        sheetName,
      }),
    );

    const importDoc = await db
      .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
      .findOne({ _id: importId, projectId }, { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } });
    const updates: Record<string, unknown> = {};
    if (importDoc?.sheetManualColumnSheets?.some((s) => s.sheetName === sheetName)) {
      updates.sheetManualColumnSheets = importDoc.sheetManualColumnSheets.filter(
        (s) => s.sheetName !== sheetName,
      );
    }
    if (importDoc?.sheetColumnHeaderLabels && sheetName in importDoc.sheetColumnHeaderLabels) {
      const nextLabels = { ...importDoc.sheetColumnHeaderLabels };
      delete nextLabels[sheetName];
      updates.sheetColumnHeaderLabels = nextLabels;
    }
    if (Object.keys(updates).length > 0) {
      await db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION).updateOne(
        { _id: importId, projectId },
        { $set: updates },
      );
    }

    await this.listCache.invalidateProject(query.projectId);
    await this.auditService.log(
      projectId,
      getActor(user),
      "bulk_delete",
      {
        mode: "import_sheet",
        importId: query.importId,
        sheetName,
        deletedCount: result.deletedCount,
      },
    );

    return { success: true as const, deletedCount: result.deletedCount };
  }

  async renameImportSheet(
    body: RenameImportSheetDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const importId = toObjectId(body.importId, "معرف الاستيراد");
    const oldName = sanitizeTextInput(body.oldSheetName);
    const newName = sanitizeTextInput(body.newSheetName);
    if (!oldName || !newName) throw new BadRequestException("اسم الورقة غير صالح.");
    if (oldName === newName) return { success: true as const, modifiedCount: 0 };

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const result = await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
      spreadsheetAssetsFilter({ projectId, importId, sheetName: oldName }),
      { $set: { sheetName: newName, updatedAt: new Date() } },
    );

    const importDoc = await db
      .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
      .findOne({ _id: importId, projectId }, { projection: { sheetManualColumnSheets: 1, sheetColumnHeaderLabels: 1 } });
    const sheetUpdates: Record<string, unknown> = {};
    if (importDoc?.sheetManualColumnSheets?.some((s) => s.sheetName === oldName)) {
      sheetUpdates.sheetManualColumnSheets = importDoc.sheetManualColumnSheets.map((s) =>
        s.sheetName === oldName ? { ...s, sheetName: newName } : s,
      );
    }
    if (importDoc?.sheetColumnHeaderLabels && oldName in importDoc.sheetColumnHeaderLabels) {
      const nextLabels = { ...importDoc.sheetColumnHeaderLabels };
      nextLabels[newName] = nextLabels[oldName]!;
      delete nextLabels[oldName];
      sheetUpdates.sheetColumnHeaderLabels = nextLabels;
    }
    if (Object.keys(sheetUpdates).length > 0) {
      await db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION).updateOne(
        { _id: importId, projectId },
        { $set: sheetUpdates },
      );
    }

    await this.listCache.invalidateProject(body.projectId);
    return { success: true as const, modifiedCount: result.modifiedCount };
  }

  async bulkDeleteAssets(
    body: BulkDeleteAssetsDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetIds = body.assetIds.map((assetId) => toObjectId(assetId, "معرف الأصل"));
    const assets = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find(spreadsheetAssetsFilter({ _id: { $in: assetIds }, projectId }))
      .toArray();

    if (assets.length !== assetIds.length) {
      throw new NotFoundException("تعذر العثور على بعض الأصول المحددة.");
    }

    const operations = assets.map((asset) => ({
      deleteOne: {
        filter: {
          _id: asset._id,
          projectId,
        },
      },
    }));

    const result = await db.collection<AssetDoc>(ASSETS_COLLECTION).bulkWrite(operations, {
      ordered: false,
    });

    await this.listCache.invalidateProject(body.projectId);
    await this.auditService.logMany(
      assets.map((asset) => ({
        projectId,
        actor: getActor(user),
        action: "bulk_delete" as const,
        changes: {
          assetId: asset.assetId,
          assetType: asset.assetType,
          assetName: asset.assetName ?? null,
        },
        assetId: asset._id,
        assetType: asset.assetType,
      })),
    );

    return {
      success: true,
      deletedCount: result.deletedCount,
      assetIds: body.assetIds,
    };
  }

  async addColumn(body: AddAssetColumnDto, user: UserMongoDoc, activeCompanyId?: ObjectId | null) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const sheetScoped = Boolean(body.importId?.trim() && body.sheetName?.trim());

    if (sheetScoped) {
      const importOid = toObjectId(body.importId!, "معرف الاستيراد");
      const sheetNameOnly = sanitizeTextInput(body.sheetName!);

      const importExists = await db
        .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
        .findOne({ _id: importOid, projectId });
      if (!importExists) {
        throw new NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
      }

      const rawLabel =
        typeof body.columnName === "string" ? body.columnName.replace(/\u0000/g, "") : "";
      const displayLabel = /\S/.test(rawLabel) ? rawLabel : "عمود";

      const scopeFilter: Filter<AssetDoc> = spreadsheetAssetsFilter({
        projectId,
        assetType: body.assetType,
        importId: importOid,
        sheetName: sheetNameOnly,
      });

      const manualCols =
        importExists.sheetManualColumnSheets?.find((s) => s.sheetName === sheetNameOnly)?.columns ??
        [];
      const headerOverrides = importExists.sheetColumnHeaderLabels?.[sheetNameOnly] ?? {};
      const existingLabels = await collectExistingDuplicateLabelsForSheet(
        db,
        scopeFilter,
        manualCols,
        headerOverrides,
      );
      if (existingLabels.has(normalizeSheetDuplicateLabel(displayLabel))) {
        throw new ConflictException(
          "لا يمكن إضافة عمود باسم موجود مسبقاً. من فضلك استبدل الاسم.",
        );
      }

      const fieldKey = generateSheetManualColumnFieldKey();

      const updateResult = await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(scopeFilter, {
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

    const columnName = sanitizeTextInput(body.columnName);
    if (!columnName) {
      throw new BadRequestException("اسم العمود مطلوب.");
    }
    const fieldKey = sanitizeCustomColumnKey(columnName);
    if (isUnsafeMongoFieldKey(fieldKey)) {
      throw new BadRequestException("اسم العمود يحتوي على محارف غير صالحة.");
    }

    const existingConfig = await db
      .collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION)
      .findOne({
        projectId,
        assetType: body.assetType,
        $or: [{ fieldKey }, { columnName }],
      });
    if (existingConfig) {
      throw new ConflictException("يوجد عمود بنفس الاسم أو المفتاح مسبقاً.");
    }

    const overlappingAsset = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne(
      spreadsheetAssetsFilter({
        projectId,
        assetType: body.assetType,
        $or: [
          { [`normalizedData.${fieldKey}`]: { $exists: true } },
          { [`rawData.${fieldKey}`]: { $exists: true } },
          { [`rawData.${columnName}`]: { $exists: true } },
        ],
      }),
    );
    if (overlappingAsset) {
      throw new ConflictException("يوجد حقل موجود فعلياً بنفس المفتاح داخل بيانات الأصول.");
    }

    const doc: AssetColumnConfigDoc = {
      _id: new ObjectId(),
      projectId,
      assetType: body.assetType,
      columnName,
      fieldKey,
      columnType: body.columnType,
      createdAt: new Date(),
      createdBy: user._id.toString(),
    };

    await db.collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION).insertOne(doc);
    const updateResult = await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
      spreadsheetAssetsFilter({
        projectId,
        assetType: body.assetType,
      }),
      {
        $set: {
          [`normalizedData.${fieldKey}`]: null,
          updatedAt: new Date(),
        },
      },
    );

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

  async renameSheetColumn(
    body: RenameSheetColumnDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const fieldKey = body.fieldKey.replace(/\u0000/g, "");
    if (!fieldKey.trim()) {
      throw new BadRequestException("مفتاح العمود غير صالح.");
    }
    const importOid = toObjectId(body.importId, "معرف الاستيراد");
    const sheetNameOnly = sanitizeTextInput(body.sheetName);

    const rawNew =
      typeof body.newLabel === "string" ? body.newLabel.replace(/\u0000/g, "") : "";
    const displayLabel = /\S/.test(rawNew) ? rawNew : "عمود";

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const importDoc = await db
      .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
      .findOne({ _id: importOid, projectId });
    if (!importDoc) {
      throw new NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
    }

    const scopeFilter: Filter<AssetDoc> = spreadsheetAssetsFilter({
      projectId,
      assetType: body.assetType,
      importId: importOid,
      sheetName: sheetNameOnly,
    });

    const manualCols =
      importDoc.sheetManualColumnSheets?.find((s) => s.sheetName === sheetNameOnly)?.columns ?? [];

    const manualEntry = manualCols.find((c) => c.fieldKey === fieldKey);
    const currentEffective = manualEntry
      ? manualEntry.label
      : importDoc.sheetColumnHeaderLabels?.[sheetNameOnly]?.[fieldKey] ?? fieldKey;

    const labelsExcluding = await collectExistingDuplicateLabelsForSheet(
      db,
      scopeFilter,
      manualCols,
      importDoc.sheetColumnHeaderLabels?.[sheetNameOnly],
    );
    labelsExcluding.delete(normalizeSheetDuplicateLabel(currentEffective));

    if (labelsExcluding.has(normalizeSheetDuplicateLabel(displayLabel))) {
      throw new ConflictException(
        "لا يمكن إضافة عمود باسم موجود مسبقاً. من فضلك استبدل الاسم.",
      );
    }

    const coll = db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION);

    if (manualEntry) {
      const sheets = [...(importDoc.sheetManualColumnSheets ?? [])];
      const si = sheets.findIndex((s) => s.sheetName === sheetNameOnly);
      if (si === -1) {
        throw new BadRequestException("تعذّر العثور على الورقة في سجل الاستيراد.");
      }
      sheets[si] = {
        ...sheets[si],
        columns: sheets[si].columns.map((c) =>
          c.fieldKey === fieldKey ? { ...c, label: displayLabel } : c,
        ),
      };
      await coll.updateOne({ _id: importOid, projectId }, { $set: { sheetManualColumnSheets: sheets } });
    } else {
      const nextHeader: Record<string, Record<string, string>> = {
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
      success: true as const,
      column: {
        key: fieldKey,
        label: displayLabel,
        type: "text" as AssetColumnType,
        isCustom: Boolean(manualEntry),
      },
    };
  }

  async createBlankImportRow(
    body: CreateBlankImportRowDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(body.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );
    const importOid = toObjectId(body.importId, "معرف الاستيراد");

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const importExists = await db
      .collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION)
      .findOne({ _id: importOid, projectId });
    if (!importExists) {
      throw new NotFoundException("الاستيراد غير موجود أو لا يخص هذا المشروع.");
    }

    const explicitSheet = body.sheetName?.trim()
      ? sanitizeTextInput(body.sheetName)
      : undefined;

    const rowFilter: Filter<AssetDoc> = spreadsheetAssetsFilter({
      projectId,
      importId: importOid,
      ...(explicitSheet ? { sheetName: explicitSheet } : {}),
    });

    const maxAgg = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .aggregate<{ m: number | null }>([
        { $match: rowFilter },
        { $group: { _id: null, m: { $max: "$rowIndex" } } },
      ])
      .toArray();
    const maxRi = maxAgg[0]?.m;
    const nextRowIndex =
      (typeof maxRi === "number" && Number.isFinite(maxRi) ? maxRi : 0) + 1;

    let resolvedSheetName: string | undefined = explicitSheet;
    if (!resolvedSheetName) {
      const anyInScope = await db
        .collection<AssetDoc>(ASSETS_COLLECTION)
        .findOne(rowFilter, { projection: { sheetName: 1 } });
      resolvedSheetName = anyInScope?.sheetName ?? undefined;
    }

    const importedAt = new Date();
    const assetObjectId = new ObjectId();
    const normalizedData: AssetNormalizedData = {};
    const rawData: AssetRawData = {};
    const manualCols =
      resolvedSheetName && importExists.sheetManualColumnSheets
        ? importExists.sheetManualColumnSheets.find((s) => s.sheetName === resolvedSheetName)?.columns ??
          []
        : [];
    for (const mc of manualCols) {
      rawData[mc.fieldKey] = null;
      normalizedData[mc.fieldKey] = null;
    }

    const newDoc: AssetDoc = {
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
      ...emptyMvPhotoFieldsForImportedAssetRow({
        createdBy: user._id,
        createdAt: importedAt,
      }),
    };

    await db.collection<AssetDoc>(ASSETS_COLLECTION).insertOne(newDoc);
    await db.collection<AssetDoc>(ASSETS_COLLECTION).updateOne(
      { _id: assetObjectId, projectId },
      {
        $set: emptyMvPhotoFieldsForImportedAssetRow({
          createdBy: user._id,
          createdAt: importedAt,
        }),
      },
    );

    await this.listCache.invalidateProject(body.projectId);
    await this.auditService.log(projectId, getActor(user), "import", {
      createdBlankRow: true,
      importId: body.importId,
      assetId: newDoc.assetId,
      rowIndex: nextRowIndex,
    });

    const inserted = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({ _id: assetObjectId });
    if (!inserted) {
      throw new NotFoundException("تعذر إنشاء الصف.");
    }
    return this.toAssetListItem(inserted as AssetListProjectionDoc);
  }

  async deleteColumn(
    columnNameOrKey: string,
    query: DeleteAssetColumnQueryDto,
    user: UserMongoDoc,
    activeCompanyId?: ObjectId | null,
  ) {
    const projectId = toObjectId(query.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(
      projectId,
      user,
      this.projectAccessOpts(activeCompanyId, { claimOwnershipIfMissing: true }),
    );

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const incomingName = sanitizeTextInput(columnNameOrKey);
    const columnConfig = await db
      .collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION)
      .findOne({
        projectId,
        assetType: query.assetType,
        $or: [{ fieldKey: incomingName }, { columnName: incomingName }],
      });

    const fieldKey = columnConfig?.fieldKey ?? incomingName;
    if (isUnsafeMongoFieldKey(fieldKey)) {
      throw new BadRequestException("اسم العمود المطلوب حذفه غير صالح.");
    }

    /** حذف من ورقة واحدة فقط: لا نحذف سجل الإعدادات العام للعمود لأن باقي الشيتات قد تستخدمه. */
    if (columnConfig && !query.sheetName?.trim()) {
      await db.collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION).deleteOne({
        _id: columnConfig._id,
      });
    }

    const unsetPayload: Record<string, "" | 1> = {
      [`normalizedData.${fieldKey}`]: "",
      [`rawData.${fieldKey}`]: "",
    };
    if (columnConfig?.columnName && columnConfig.columnName !== fieldKey) {
      unsetPayload[`rawData.${columnConfig.columnName}`] = "";
    }

    const importFilter: Record<string, unknown> =
      query.importId && query.sheetName?.trim()
        ? {
            importId: toObjectId(query.importId, "معرف الاستيراد"),
            sheetName: sanitizeTextInput(query.sheetName),
          }
        : query.importId
          ? { importId: toObjectId(query.importId, "معرف الاستيراد") }
          : {};

    const updateResult = await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
      spreadsheetAssetsFilter({
        projectId,
        assetType: query.assetType,
        ...importFilter,
      }),
      {
        $unset: unsetPayload,
        $set: { updatedAt: new Date() },
      },
    );

    if (
      query.importId &&
      query.sheetName?.trim() &&
      isSheetManualColumnStorageKey(fieldKey)
    ) {
      await removeSheetManualColumnFromImportDoc(
        db,
        projectId,
        toObjectId(query.importId, "معرف الاستيراد"),
        sanitizeTextInput(query.sheetName),
        fieldKey,
      );
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

  async exportAssets(query: ExportAssetsQueryDto, user: UserMongoDoc, activeCompanyId?: ObjectId | null) {
    const projectId = toObjectId(query.projectId, "معرف المشروع");
    await this.projectAccess.assertProjectAccess(projectId, user, this.projectAccessOpts(activeCompanyId));

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const assetTypes = query.assetType ? [query.assetType] : EXPORTABLE_TYPES;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Spark Vision";
    workbook.created = new Date();
    workbook.modified = new Date();

    for (const assetType of assetTypes) {
      const scopeFilter: Filter<AssetDoc> = spreadsheetAssetsFilter({ projectId, assetType });
      const [assets, customColumns] = await Promise.all([
        db
          .collection<AssetDoc>(ASSETS_COLLECTION)
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

      const customColumnDescriptors = customColumns.map<AssetColumnDescriptor>((column) => ({
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
        const row: Record<string, AssetPrimitive> = {};
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

  private async resolveSortField(
    _projectId: ObjectId,
    _assetType: AssetType | undefined,
    requestedSortBy: string | undefined,
  ) {
    const sortBy = sanitizeTextInput(requestedSortBy ?? "");
    if (!sortBy) return null;

    if (sortBy === "rowIndex") {
      return {
        primaryPath: "$rowIndex",
        fallbackPath: "$rowIndex",
      };
    }

    if (isUnsafeMongoFieldKey(sortBy)) {
      return null;
    }

    /** ترتيب حسب عمود الشيت في rawData (كما في Excel)، ثم normalizedData */
    return {
      primaryPath: `$rawData.${sortBy}`,
      fallbackPath: `$normalizedData.${sortBy}`,
    };
  }

  private async getCustomColumns(projectId: ObjectId, assetType: AssetType) {
    const db = await getMongoDb();
    return db
      .collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION)
      .find(
        {
          projectId,
          assetType,
        },
        {
          projection: {
            fieldKey: 1,
            columnName: 1,
            columnType: 1,
            assetType: 1,
            projectId: 1,
            createdAt: 1,
            createdBy: 1,
          },
        },
      )
      .sort({ createdAt: 1 })
      .toArray();
  }

  private async normalizeChanges(
    projectId: ObjectId,
    assetType: AssetType,
    rawChanges: Record<string, unknown>,
  ) {
    const customColumns = await this.getCustomColumns(projectId, assetType);
    const customTypeMap = new Map(
      customColumns.map((column) => [column.fieldKey, column.columnType]),
    );

    const normalizedChanges: Record<string, AssetPrimitive> = {};

    Object.entries(rawChanges).forEach(([rawFieldKey, rawValue]) => {
      const fieldKey = sanitizeTextInput(rawFieldKey);
      if (fieldKey === "projectId" || fieldKey === "assetType" || fieldKey === "_id") {
        throw new BadRequestException(`الحقل "${fieldKey}" غير قابل للتعديل.`);
      }
      if (isUnsafeMongoFieldKey(fieldKey)) {
        throw new BadRequestException(`اسم الحقل "${rawFieldKey}" غير صالح.`);
      }

      const expectedType =
        customTypeMap.get(fieldKey) ?? inferColumnTypeFromValue(sanitizePrimitiveValue(rawValue));

      normalizedChanges[fieldKey] = parseColumnValue(fieldKey, rawValue, expectedType);
    });

    if (Object.keys(normalizedChanges).length === 0) {
      throw new BadRequestException("لا توجد حقول صالحة للتعديل.");
    }

    return normalizedChanges;
  }

  private buildUpdateDocument(changes: Record<string, AssetPrimitive>) {
    const now = new Date();
    const $set: Record<string, unknown> = {
      updatedAt: now,
    };

    Object.entries(changes).forEach(([fieldKey, value]) => {
      $set[`rawData.${fieldKey}`] = value;
      $set[`normalizedData.${fieldKey}`] = value;
    });

    return {
      $set,
    } satisfies UpdateFilter<AssetDoc>;
  }

  private buildAuditChanges(asset: AssetDoc, changes: Record<string, AssetPrimitive>) {
    return Object.fromEntries(
      Object.entries(changes).map(([fieldKey, nextValue]) => [
        fieldKey,
        {
          before: resolveAssetFieldValue(asset, fieldKey),
          after: nextValue,
        },
      ]),
    );
  }

  private toAssetListItem(doc: AssetListProjectionDoc) {
    const basePayload: Record<string, unknown> = {
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
}
