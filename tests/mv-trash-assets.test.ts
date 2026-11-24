import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { AssetsService } from "../src/assets/assets.service";
import { AssetProjectAccessService } from "../src/assets/asset-project-access.service";
import { ensureAssetsCollectionsInitialized } from "../src/assets/collections";
import { getMongoDb } from "../src/server/mongodb";
import { MV_TRASH_COLLECTION, restoreMvTrashEntry } from "../src/machine-valuation/mv-trash";
import { permissionRequirementForRequest } from "../src/permissions/permissions.guard";

test("the trash is reachable by every role without a page grant", () => {
  for (const [method, path] of [
    ["GET", "/api/mv/trash"],
    ["POST", "/api/mv/trash/64f000000000000000000001/restore"],
    ["DELETE", "/api/mv/trash/64f000000000000000000001"],
  ] as const) {
    assert.equal(permissionRequirementForRequest({ method, path, query: {}, body: {} } as never), null);
  }
});

test("asset rows, sheets and columns move to the trash and come back unchanged", { timeout: 180_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING;
  const priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "mv_trash_assets_test";
  try {
    const db = await getMongoDb();
    const companyId = new ObjectId(), projectId = new ObjectId(), importId = new ObjectId(), userId = new ObjectId();
    await db.collection("mv_projects").insertOne({ _id: projectId, companyId, userId, name: "Fleet", createdAt: new Date(), updatedAt: new Date() });
    await db.collection("asset_imports").insertOne({
      _id: importId, projectId, status: "completed", sourceFileName: "fleet.xlsx",
      sheetManualColumnSheets: [{ sheetName: "Trucks", columns: [{ fieldKey: "manual_note", label: "Notes" }] }],
      sheetColumnHeaderLabels: { Trucks: { serial: "Serial" }, Cranes: { serial: "Serial" } },
    });
    const row = (assetId: string, sheetName: string, rowIndex: number, serial: string) => ({
      _id: new ObjectId(), projectId, importId, sheetName, rowIndex, assetId, assetName: `Asset ${assetId}`,
      assetType: "other", rawData: { serial, plate: `P-${assetId}` }, normalizedData: { serial },
      importedAt: new Date(), updatedAt: new Date(),
    });
    const rows = [row("T1", "Trucks", 0, "100"), row("T2", "Trucks", 1, "200"), row("T3", "Trucks", 2, "300"), row("C1", "Cranes", 0, "900")];
    await db.collection("assets").insertMany(rows);

    const invalidated: string[] = [];
    const service = new AssetsService(
      new AssetProjectAccessService(),
      { invalidateProject: async (id: string) => { invalidated.push(id); } } as never,
      { log: async () => undefined, logMany: async () => undefined } as never,
    );
    const user = { _id: userId, role: "valuer", username: "valuer" } as never;
    const actor = { userId: userId.toString(), companyId: companyId.toString(), isSuperAdmin: false, userRole: "valuer" };
    const assets = () => db.collection("assets").find({ projectId }).sort({ assetId: 1 }).toArray();
    const restoreLatest = async (kind: string) => {
      const entry = await db.collection(MV_TRASH_COLLECTION).findOne({ kind }, { sort: { deletedAt: -1 } });
      assert.ok(entry, `expected a trashed ${kind}`);
      await restoreMvTrashEntry(db, entry._id, actor);
      return entry;
    };

    // تهيئة المجموعة تضيف حقولاً مشتقة للصفوف؛ نقارن بما هو مخزّن فعلاً قبل أي حذف.
    await ensureAssetsCollectionsInitialized(db);
    const baseline = await assets();

    // صف واحد
    await service.deleteAsset(rows[0]!._id.toString(), user, companyId);
    assert.deepEqual((await assets()).map((asset) => asset.assetId), ["C1", "T2", "T3"]);
    const single = await restoreLatest("asset");
    assert.equal(single.label, "Asset T1");
    assert.equal(String(single.companyId), companyId.toString(), "the entry belongs to the project's company");
    assert.deepEqual(await assets(), baseline, "the row returns exactly as stored, with its _id");
    assert.ok(invalidated.includes(projectId.toString()), "restoring refreshes the cached asset list");

    // حذف جماعي في سجل واحد
    await service.bulkDeleteAssets({ projectId: projectId.toString(), assetIds: [rows[0]!._id.toString(), rows[1]!._id.toString()] }, user, companyId);
    const bulk = await restoreLatest("asset");
    assert.equal(bulk.count, 2);
    assert.equal((await assets()).length, 4);

    // عمود من ورقة واحدة: قيمه تعود إلى صفوفها فقط
    await service.deleteColumn("serial", { projectId: projectId.toString(), assetType: "other", importId: importId.toString(), sheetName: "Trucks" }, user, companyId);
    const withoutColumn = await assets();
    assert.equal(withoutColumn.find((asset) => asset.assetId === "T2")!.rawData.serial, undefined);
    assert.equal(withoutColumn.find((asset) => asset.assetId === "C1")!.rawData.serial, "900", "other sheets keep the column");
    await restoreLatest("assetColumn");
    const withColumn = await assets();
    assert.deepEqual(withColumn.map((asset) => [asset.assetId, asset.rawData.serial, asset.normalizedData.serial]),
      [["C1", "900", "900"], ["T1", "100", "100"], ["T2", "200", "200"], ["T3", "300", "300"]]);

    // ورقة كاملة مع إعدادات أعمدتها
    await service.deleteImportSheet({ projectId: projectId.toString(), importId: importId.toString(), sheetName: "Trucks" }, user, companyId);
    assert.deepEqual((await assets()).map((asset) => asset.assetId), ["C1"]);
    const strippedImport = (await db.collection("asset_imports").findOne({ _id: importId }))!;
    assert.deepEqual(strippedImport.sheetManualColumnSheets, []);
    assert.deepEqual(Object.keys(strippedImport.sheetColumnHeaderLabels), ["Cranes"]);
    const sheet = await restoreLatest("assetSheet");
    assert.equal(sheet.count, 3);
    assert.deepEqual((await assets()).map((asset) => asset.assetId), ["C1", "T1", "T2", "T3"]);
    const restoredImport = (await db.collection("asset_imports").findOne({ _id: importId }))!;
    assert.deepEqual(restoredImport.sheetManualColumnSheets, [{ sheetName: "Trucks", columns: [{ fieldKey: "manual_note", label: "Notes" }] }]);
    assert.deepEqual(restoredImport.sheetColumnHeaderLabels.Trucks, { serial: "Serial" });

    // معرّف الأصل فريد: لا تُستعاد نسخة فوق أصل حي يحمل المعرّف نفسه
    await service.deleteAsset(rows[3]!._id.toString(), user, companyId);
    await db.collection("assets").insertOne({ ...row("C1", "Cranes", 0, "901"), _id: new ObjectId() });
    const conflicting = await db.collection(MV_TRASH_COLLECTION).findOne({ kind: "asset" });
    await assert.rejects(restoreMvTrashEntry(db, conflicting!._id, actor), /عناصر حالية بالمعرّف نفسه/);
    assert.equal(await db.collection(MV_TRASH_COLLECTION).countDocuments({ _id: conflicting!._id }), 1,
      "a failed restore keeps the item in the trash");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
