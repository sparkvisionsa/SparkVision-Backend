"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSET_AUDIT_LOGS_COLLECTION = exports.ASSET_COLUMN_CONFIGS_COLLECTION = exports.ASSET_IMPORTS_COLLECTION = exports.ASSETS_COLLECTION = void 0;
exports.spreadsheetAssetsFilter = spreadsheetAssetsFilter;
exports.ensureAssetsCollectionsInitialized = ensureAssetsCollectionsInitialized;
exports.ASSETS_COLLECTION = "assets";
exports.ASSET_IMPORTS_COLLECTION = "asset_imports";
exports.ASSET_COLUMN_CONFIGS_COLLECTION = "asset_column_configs";
exports.ASSET_AUDIT_LOGS_COLLECTION = "asset_audit_logs";
function spreadsheetAssetsFilter(base) {
    return {
        ...base,
        $or: [{ isAssetFolder: { $ne: true } }, { importId: { $exists: true, $ne: null } }],
    };
}
let assetCollectionsInitPromise = null;
async function createIndexSafely(collection, indexSpec, options) {
    try {
        await collection.createIndex(indexSpec, options);
    }
    catch {
    }
}
async function ensureAssetsCollectionsInitialized(db) {
    if (assetCollectionsInitPromise) {
        await assetCollectionsInitPromise;
        return;
    }
    assetCollectionsInitPromise = (async () => {
        const assets = db.collection(exports.ASSETS_COLLECTION);
        const imports = db.collection(exports.ASSET_IMPORTS_COLLECTION);
        const columnConfigs = db.collection(exports.ASSET_COLUMN_CONFIGS_COLLECTION);
        const auditLogs = db.collection(exports.ASSET_AUDIT_LOGS_COLLECTION);
        await Promise.all([
            createIndexSafely(assets, { projectId: 1, assetType: 1, importedAt: -1 }),
            createIndexSafely(assets, { projectId: 1, importId: 1 }),
            createIndexSafely(assets, { importId: 1, sheetName: 1, rowIndex: 1 }),
            createIndexSafely(assets, { projectId: 1, status: 1 }),
            createIndexSafely(assets, { projectId: 1, updatedAt: -1 }),
            createIndexSafely(assets, { projectId: 1, assetId: 1 }, { unique: true }),
            createIndexSafely(assets, { projectId: 1, parent: 1, name: 1 }),
            createIndexSafely(assets, { projectId: 1, isAssetFolder: 1, parent: 1, name: 1 }),
            createIndexSafely(imports, { projectId: 1, importedAt: -1 }),
            createIndexSafely(columnConfigs, { projectId: 1, assetType: 1, fieldKey: 1 }, { unique: true }),
            createIndexSafely(columnConfigs, { projectId: 1, assetType: 1, createdAt: -1 }),
            createIndexSafely(auditLogs, { projectId: 1, createdAt: -1 }),
            createIndexSafely(auditLogs, { assetId: 1, createdAt: -1 }),
        ]);
    })().catch((error) => {
        assetCollectionsInitPromise = null;
        throw error;
    });
    await assetCollectionsInitPromise;
}
