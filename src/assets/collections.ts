import type { Collection, Db, Document, Filter } from "mongodb";
import type {
  AssetAuditLogDoc,
  AssetColumnConfigDoc,
  AssetDoc,
  AssetImportDoc,
} from "./types";

export const ASSETS_COLLECTION = "assets";
export const ASSET_IMPORTS_COLLECTION = "asset_imports";
export const ASSET_COLUMN_CONFIGS_COLLECTION = "asset_column_configs";
export const ASSET_AUDIT_LOGS_COLLECTION = "asset_audit_logs";

/**
 * صفوف استيراد الجداول — بما فيها الصفوف التي أصبحت مجلدات صور (`isAssetFolder: true`)
 * بعد ربطها بعمود المجلدات، طالما لها `importId` (لا تُخلط مع مجلدات صور منفصلة بلا استيراد).
 */
export function spreadsheetAssetsFilter<T extends Record<string, unknown>>(base: T): Filter<AssetDoc> {
  return {
    ...base,
    $or: [{ isAssetFolder: { $ne: true } }, { importId: { $exists: true, $ne: null } }],
  } as Filter<AssetDoc>;
}

let assetCollectionsInitPromise: Promise<void> | null = null;

async function createIndexSafely<TSchema extends Document>(
  collection: Collection<TSchema>,
  indexSpec: Record<string, 1 | -1>,
  options?: { unique?: boolean; sparse?: boolean; name?: string },
) {
  try {
    await collection.createIndex(indexSpec, options);
  } catch {
    // Ignore index race/existing-index errors.
  }
}

export async function ensureAssetsCollectionsInitialized(db: Db) {
  if (assetCollectionsInitPromise) {
    await assetCollectionsInitPromise;
    return;
  }

  assetCollectionsInitPromise = (async () => {
    const assets = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const imports = db.collection<AssetImportDoc>(ASSET_IMPORTS_COLLECTION);
    const columnConfigs = db.collection<AssetColumnConfigDoc>(ASSET_COLUMN_CONFIGS_COLLECTION);
    const auditLogs = db.collection<AssetAuditLogDoc>(ASSET_AUDIT_LOGS_COLLECTION);

    await Promise.all([
      createIndexSafely(assets, { projectId: 1, assetType: 1, importedAt: -1 }),
      createIndexSafely(assets, { projectId: 1, importId: 1 }),
      createIndexSafely(assets, { importId: 1, sheetName: 1, rowIndex: 1 }),
      createIndexSafely(assets, { projectId: 1, status: 1 }),
      createIndexSafely(assets, { projectId: 1, updatedAt: -1 }),
      createIndexSafely(assets, { projectId: 1, assetId: 1 }, { unique: true }),
      createIndexSafely(assets, { projectId: 1, parent: 1, name: 1 }),
      createIndexSafely(assets, { projectId: 1, isAssetFolder: 1, parent: 1, name: 1 }),
      createIndexSafely(assets, { projectId: 1, parent: 1, lable: 1 }),
      createIndexSafely(assets, { projectId: 1, isAssetFolder: 1, parent: 1, lable: 1 }),
      createIndexSafely(assets, { val_tech_id: 1 }, { unique: true, sparse: true }),
      assets.updateMany(
        {
          $and: [
            { $or: [{ client_code: { $exists: false } }, { client_code: null }] },
            { code: { $type: "string" } },
          ],
        } as Filter<AssetDoc>,
        [{ $set: { client_code: "$code", code: null } }],
      ),
      assets.updateMany(
        { system_code: { $exists: true } } as Filter<AssetDoc>,
        { $unset: { system_code: "" }, $set: { code: null } },
      ),
      /**
       * يملأ ‎name‎ من ‎lable‎ فقط عندما يكون ‎name‎ فارغاً.
       * بعد التوليد يبقى ‎lable‎ ثابتاً، وتحديثات اسم الأصل تذهب إلى ‎name‎.
       */
      assets.updateMany(
        {
          $and: [
            { lable: { $type: "string" } },
            { $or: [{ name: null }, { name: { $exists: false } }, { name: "" }] },
          ],
        } as Filter<AssetDoc>,
        [{ $set: { name: "$lable" } }],
      ),
      assets.updateMany(
        {},
        [
          {
            $set: {
              category: {
                $ifNull: [
                  { $cond: [{ $eq: ["$category", ""] }, null, "$category"] },
                  { $ifNull: ["$asset_description.category", "$assetDescription.category"] },
                ],
              },
              type: {
                $ifNull: [
                  { $cond: [{ $eq: ["$type", ""] }, null, "$type"] },
                  { $ifNull: ["$asset_description.type", "$assetDescription.type"] },
                ],
              },
            },
          },
        ],
      ),
      /**
       * أصول ‎تطبيق‎ اكتملت عند الإنشاء — لا تُمس ولا يُفحص هيكلها.
       * الباقي: ‎sheetName‎ ⇒ عميل، وإلا نظام.
       */
      assets.updateMany(
        {
          asset_source: { $nin: ["تطبيق", "app"] },
        } as Filter<AssetDoc>,
        [
          {
            $set: {
              asset_source: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $type: "$sheetName" }, "string"] },
                      { $gt: [{ $strLenCP: { $trim: { input: "$sheetName" } } }, 0] },
                    ],
                  },
                  "عميل",
                  "نظام",
                ],
              },
            },
          },
        ],
      ),
      createIndexSafely(imports, { projectId: 1, importedAt: -1 }),
      createIndexSafely(
        columnConfigs,
        { projectId: 1, assetType: 1, fieldKey: 1 },
        { unique: true },
      ),
      createIndexSafely(columnConfigs, { projectId: 1, assetType: 1, createdAt: -1 }),
      createIndexSafely(auditLogs, { projectId: 1, createdAt: -1 }),
      createIndexSafely(auditLogs, { assetId: 1, createdAt: -1 }),
    ]);
  })().catch((error: unknown) => {
    assetCollectionsInitPromise = null;
    throw error;
  });

  await assetCollectionsInitPromise;
}
