import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";
import {
  MV_FILES_BUCKET,
  MV_FILES_FILES_COLLECTION,
  MV_PROJECTS_COLLECTION,
  MV_SHEETS_COLLECTION,
} from "../src/machine-valuation/collections";
import {
  MV_TRASH_COLLECTION,
  MV_TRASH_DOCS_COLLECTION,
  diffRemovedEmbeddedItems,
  groupEmbeddedRemovals,
  insertEmbeddedItem,
} from "../src/machine-valuation/mv-trash";

test("embedded diff records only the removed item and restores it to the same nested position", () => {
  const before = {
    models: [
      { id: "m1", name: "Model 1", sections: [
        { id: "s1", title: "Section 1", fields: [{ id: "f1", label: "A" }, { id: "f2", label: "B" }, { id: "f3", label: "C" }] },
        { id: "s2", title: "Section 2", fields: [{ id: "f4", label: "D" }] },
      ] },
      { id: "m2", name: "Model 2", sections: [] },
    ],
  };
  const after = {
    models: [
      { id: "m1", name: "Model 1", sections: [
        { id: "s1", title: "Section 1", fields: [{ id: "f1", label: "A" }, { id: "f3", label: "C" }] },
      ] },
    ],
  };
  const specs = [{
    field: "models", kind: "model", labelKeys: ["name"],
    children: [{ field: "sections", kind: "section", labelKeys: ["title"],
      children: [{ field: "fields", kind: "field", labelKeys: ["label"] }] }],
  }];
  const removals = diffRemovedEmbeddedItems(before, after, specs);
  assert.deepEqual(removals.map((row) => `${row.kind}:${row.label}`).sort(),
    ["field:B", "model:Model 2", "section:Section 2"],
    "children of a removed parent are not recorded separately");

  const field = removals.find((row) => row.kind === "field")!;
  assert.deepEqual(field.parents, ["Model 1", "Section 1"]);
  const live = structuredClone(after);
  assert.equal(insertEmbeddedItem(live, field, field.item), "inserted");
  assert.deepEqual(live.models[0]!.sections[0]!.fields.map((row) => row.id), ["f1", "f2", "f3"],
    "the field returns to its original index");
  assert.equal(insertEmbeddedItem(live, field, field.item), "exists", "restoring twice never duplicates");

  const orphan = structuredClone(after);
  orphan.models[0]!.sections = [];
  assert.equal(insertEmbeddedItem(orphan, field, field.item), "missing-parent",
    "an item cannot be restored while its parent is still deleted");

  const grouped = groupEmbeddedRemovals(
    diffRemovedEmbeddedItems(
      { sections: [{ id: "s1", title: "S" }], fields: [{ id: "a", sectionId: "s1" }, { id: "b", sectionId: "x" }] },
      { sections: [], fields: [] },
      [{ field: "sections", kind: "section", labelKeys: ["title"] }, { field: "fields", kind: "field" }],
    ),
    (child, parent) => parent.kind === "section" && (child.item as { sectionId?: string }).sectionId === "s1",
  );
  assert.deepEqual(grouped.map((row) => row.kind), ["section", "field"]);
  assert.equal(grouped[0]!.extras?.length, 1, "a section carries its own fields with it");
});

async function uploadFile(db: Db, name: string, metadata: Record<string, unknown>) {
  return new Promise<ObjectId>((resolve, reject) => {
    const upload = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET }).openUploadStream(name, { metadata });
    upload.on("error", reject);
    upload.on("finish", () => resolve(upload.id as ObjectId));
    upload.end(Buffer.from(name));
  });
}

test("deleted items move to the trash, are scoped per user, and restore to their original place", { timeout: 180_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING;
  const priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "mv_trash_test";
  try {
    const db = await getMongoDb();
    const companyId = new ObjectId(), otherCompanyId = new ObjectId(), projectId = new ObjectId();
    const adminId = new ObjectId(), memberId = new ObjectId(), colleagueId = new ObjectId();
    await db.collection("companies").insertMany([
      { _id: companyId, name: "Spark Valuation", valueTechProductIds: [] },
      { _id: otherCompanyId, name: "Other Valuation", valueTechProductIds: [] },
    ]);
    await db.collection("users").insertMany([
      { _id: adminId, username: "admin", role: "company_admin" },
      { _id: memberId, username: "member", role: "valuer" },
      { _id: colleagueId, username: "colleague", role: "valuer" },
    ]);
    const inspectorFile = (id: string, name: string) => ({
      id, name, type: "pdf", url: `https://spaces.example/${id}`, uploadedBy: null,
      createdAt: new Date(), storage: "digitalocean", spacesKey: id, locationIds: ["site-a"],
    });
    await db.collection(MV_PROJECTS_COLLECTION).insertOne({
      _id: projectId, companyId, name: "Excavators", createdAt: new Date(), updatedAt: new Date(),
      locations: [
        { id: "site-a", name: "Riyadh yard", region: "Riyadh", city: "Riyadh", latitude: null, longitude: null },
        { id: "site-b", name: "Jeddah yard", region: "Makkah", city: "Jeddah", latitude: null, longitude: null },
      ],
      contacts: [],
      inspectorFiles: [inspectorFile("k1", "first.pdf"), inspectorFile("k2", "second.pdf"), inspectorFile("k3", "third.pdf")],
    });
    const picAssetId = new ObjectId(), rootId = new ObjectId();
    await db.collection("items").insertOne({ _id: rootId, projectId, name: "Photos", parent: null });
    const imageFileId = await uploadFile(db, "plate.jpg", { projectId, scope: "asset-images", picAssetId });
    await db.collection("assets").insertOne({
      _id: picAssetId, projectId, assetId: "A1", isAssetFolder: true, parent: rootId, name: "Loader 950",
      images: [
        { url: "https://cdn.example/one.jpg" },
        { fileId: imageFileId, includeInReport: true },
        { url: "https://cdn.example/three.jpg" },
      ],
    });
    const sheetId = new ObjectId();
    await db.collection(MV_SHEETS_COLLECTION).insertOne({
      _id: sheetId, projectId, name: "Valuation", headers: ["Asset", "Value"],
      rowValues: [["Loader", 10], ["Crane", 20]], createdAt: new Date(), updatedAt: new Date(),
    });

    const deletedKeys: string[] = [];
    const service = new MachineValuationService({
      publicUrlForKey: (key: string) => `https://spaces.example/${key}`,
      deleteObject: async (key: string) => { deletedKeys.push(key); },
    } as never);
    const admin = { userId: adminId.toString(), companyId: companyId.toString(), isSuperAdmin: false, userRole: "company_admin" };
    const member = { ...admin, userId: memberId.toString(), userRole: "valuer" };
    const colleague = { ...admin, userId: colleagueId.toString(), userRole: "valuer" };
    const stranger = { ...admin, userId: new ObjectId().toString(), companyId: otherCompanyId.toString() };
    const kinds = async (ctx: typeof admin) => (await service.listTrash(ctx)).items.map((item) => item.kind).sort();
    const project = () => db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: projectId });
    /** ملفات يراها المشروع (كل استعلامات النظام تعتمد metadata.projectId). */
    const visibleFiles = () => db.collection(MV_FILES_FILES_COLLECTION).countDocuments({ "metadata.projectId": projectId });

    // ── ملف معاين: يبقى في التخزين ويعود إلى ترتيبه ──
    await service.deleteInspectorFile(projectId.toString(), "k2", member);
    assert.deepEqual((await project())!.inspectorFiles.map((file: { id: string }) => file.id), ["k1", "k3"]);
    assert.deepEqual(deletedKeys, [], "a soft delete never destroys the stored file");

    // ── صورة داخل أصل: تعود إلى الأصل نفسه والترتيب نفسه ──
    await service.deleteProjectFile(projectId.toString(), imageFileId.toString(), member);
    assert.equal((await db.collection("assets").findOne({ _id: picAssetId }))!.images.length, 2);
    const detached = await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: imageFileId });
    assert.ok(detached, "the image bytes are kept");
    assert.equal(detached!.metadata.projectId, undefined, "the image is hidden from every project query");
    assert.equal(await visibleFiles(), 0);

    // ── جدول (شيت) وعمود منه — حذفهما زميل آخر ──
    await service.updateSheet(sheetId.toString(), { headers: ["Asset"], rows: [{ Asset: "Loader" }, { Asset: "Crane" }] }, colleague);
    await service.deleteSheet(sheetId.toString(), colleague);
    assert.equal(await db.collection(MV_SHEETS_COLLECTION).countDocuments({ _id: sheetId }), 0);

    // ── موقع معاينة ──
    await service.saveProjectLocations(projectId.toString(), member, {
      locations: [{ id: "site-b", name: "Jeddah yard", region: "Makkah", city: "Jeddah" }],
    });
    assert.deepEqual((await project())!.locations.map((site: { id: string }) => site.id), ["site-b"]);

    // ── الرؤية: كل مستخدم يرى ما حذفه، والمدير يرى الجميع ──
    assert.deepEqual(await kinds(member), ["assetImage", "inspectionSite", "inspectorFile"]);
    assert.deepEqual(await kinds(colleague), ["sheet", "sheetColumn"]);
    assert.deepEqual(await kinds(admin), ["assetImage", "inspectionSite", "inspectorFile", "sheet", "sheetColumn"]);
    assert.deepEqual(await kinds(stranger), [], "another company sees nothing");
    const adminView = await service.listTrash(admin);
    assert.equal(adminView.canSeeAll, true);
    assert.equal(adminView.items.find((item) => item.kind === "sheet")!.deletedByName, "colleague");
    assert.equal(adminView.items.find((item) => item.kind === "assetImage")!.location, "Loader 950");
    assert.equal(adminView.items.every((item) => item.projectName === "Excavators"), true);
    assert.equal((await service.listTrash(member)).canPermanentlyDelete, false);

    const idOf = async (kind: string) => (await service.listTrash(admin)).items.find((item) => item.kind === kind)!.id;
    await assert.rejects(service.restoreTrashItem(await idOf("sheet"), member), /سلة المحذوفات/,
      "a regular user cannot restore what someone else deleted");
    await assert.rejects(service.restoreTrashItem(await idOf("sheet"), stranger));
    await assert.rejects(service.purgeTrashItem(await idOf("inspectorFile"), member), /مدير الشركة/,
      "only an admin deletes permanently");

    // ── الاستعادة إلى الموضع الأصلي ──
    await service.restoreTrashItem(await idOf("inspectorFile"), member);
    assert.deepEqual((await project())!.inspectorFiles.map((file: { id: string }) => file.id), ["k1", "k2", "k3"]);

    await service.restoreTrashItem(await idOf("assetImage"), member);
    const restoredAsset = (await db.collection("assets").findOne({ _id: picAssetId }))!;
    assert.equal(restoredAsset.images.length, 3);
    assert.equal(String(restoredAsset.images[1].fileId), imageFileId.toString(), "the image returns to its slot in the same asset");
    assert.equal(String((await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: imageFileId }))!.metadata.projectId),
      projectId.toString());
    assert.equal(await visibleFiles(), 1);

    await service.restoreTrashItem(await idOf("inspectionSite"), admin);
    assert.deepEqual((await project())!.locations.map((site: { id: string }) => site.id), ["site-a", "site-b"]);
    assert.deepEqual((await project())!.inspectorFiles.map((file: { locationIds: string[] }) => file.locationIds), [["site-a"], [], ["site-a"]],
      "files that belonged to the site return to it; k2 was restored while the site was deleted, so it stays general");

    await assert.rejects(service.restoreTrashItem(await idOf("sheetColumn"), colleague), /استعد الجدول أولاً/,
      "a column cannot come back before its sheet");
    await service.restoreTrashItem(await idOf("sheet"), colleague);
    await service.restoreTrashItem(await idOf("sheetColumn"), colleague);
    const sheet = (await db.collection(MV_SHEETS_COLLECTION).findOne({ _id: sheetId }))!;
    assert.deepEqual(sheet.headers, ["Asset", "Value"]);
    assert.deepEqual(sheet.rowValues, [["Loader", 10], ["Crane", 20]]);
    assert.deepEqual(await kinds(admin), []);
    assert.equal(await db.collection(MV_TRASH_DOCS_COLLECTION).countDocuments({}), 0, "restored entries leave nothing behind");

    // ── أصل كامل بصوره، ثم مشروعه: الابن لا يُستعاد قبل أبيه ──
    await service.deleteSubProject(projectId.toString(), picAssetId.toString(), member);
    assert.equal(await db.collection("assets").countDocuments({ _id: picAssetId }), 0);
    assert.equal(await visibleFiles(), 0);
    await service.deleteProject(projectId.toString(), member);
    assert.deepEqual(await kinds(member), ["assetFolder", "project"]);
    const folderId = (await service.listTrash(member)).items.find((item) => item.kind === "assetFolder")!.id;
    assert.equal((await service.listTrash(member)).items.find((item) => item.kind === "assetFolder")!.projectDeleted, true);
    await assert.rejects(service.restoreTrashItem(folderId, member), /استعد المشروع أولاً/);
    await assert.rejects(service.restoreTrashItem(projectId.toString(), colleague), /حذفتها أنت/,
      "a regular user restores only the projects they deleted");
    await service.restoreTrashItem(projectId.toString(), member);
    await service.restoreTrashItem(folderId, member);
    assert.equal((await db.collection("assets").findOne({ _id: picAssetId }))!.images.length, 3);
    assert.equal(await visibleFiles(), 1,
      "the asset comes back with its image files");

    // ── الحذف النهائي يتلف الملف فعلاً ──
    await service.deleteInspectorFile(projectId.toString(), "k1", member);
    await service.purgeTrashItem(await idOf("inspectorFile"), admin);
    assert.deepEqual(deletedKeys, ["k1"]);
    assert.equal(await db.collection(MV_TRASH_COLLECTION).countDocuments({}), 0);

    // ── إتلاف المشروع نهائياً يتلف محذوفاته التي ما زالت في السلة ──
    await service.deleteProjectFile(projectId.toString(), imageFileId.toString(), member);
    await service.deleteProject(projectId.toString(), admin);
    await service.purgeTrashItem(projectId.toString(), admin);
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments({ _id: imageFileId }), 0);
    assert.equal(await db.collection(MV_TRASH_COLLECTION).countDocuments({}), 0);
    assert.equal(await db.collection(MV_TRASH_DOCS_COLLECTION).countDocuments({}), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
