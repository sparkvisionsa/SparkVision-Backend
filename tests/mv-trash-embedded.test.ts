import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";
import { MV_PROJECTS_COLLECTION } from "../src/machine-valuation/collections";
import { MV_TRASH_COLLECTION } from "../src/machine-valuation/mv-trash";

test("images inside an asset and report-data items return to the same slot after restore", { timeout: 180_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING;
  const priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "mv_trash_embedded_test";
  try {
    const db = await getMongoDb();
    const companyId = new ObjectId(), projectId = new ObjectId(), userId = new ObjectId();
    const rootId = new ObjectId(), categorizedId = new ObjectId(), listId = new ObjectId();
    await db.collection("companies").insertOne({ _id: companyId, name: "Spark Valuation", valueTechProductIds: [] });
    await db.collection("users").insertOne({ _id: userId, username: "valuer", role: "valuer" });
    await db.collection(MV_PROJECTS_COLLECTION).insertOne({
      _id: projectId, companyId, name: "Plant", createdAt: new Date(), updatedAt: new Date(),
    });
    await db.collection("items").insertOne({ _id: rootId, projectId, name: "Photos", parent: null });
    const image = (name: string) => ({ url: `https://cdn.example/${name}.jpg`, includeInReport: true });
    await db.collection("assets").insertMany([
      {
        _id: categorizedId, projectId, assetId: "A1", isAssetFolder: true, parent: rootId, name: "Truck",
        images: { plate: image("plate"), odometer: null, brand: null, details: null, other: [image("o1"), image("o2"), image("o3")] },
      },
      {
        _id: listId, projectId, assetId: "A2", isAssetFolder: true, parent: rootId, name: "Crane",
        images: [image("c1"), image("c2"), image("c3")],
      },
    ]);
    const service = new MachineValuationService({
      publicUrlForKey: (key: string) => `https://spaces.example/${key}`,
      deleteObject: async () => undefined,
    } as never);
    const ctx = { userId: userId.toString(), companyId: companyId.toString(), isSuperAdmin: false, userRole: "valuer" };
    const asset = async (id: ObjectId) => (await db.collection("assets").findOne({ _id: id }))!;
    const urls = (list: Array<{ url: string }>) => list.map((row) => row.url.split("/").pop());
    const trash = async () => (await service.listTrash(ctx)).items;
    const restoreAll = async () => { for (const item of await trash()) await service.restoreTrashItem(item.id, ctx); };

    // ── أصل بصور مصنّفة: حذف صورة من «أخرى» وصورة اللوحة ──
    await service.patchSubProject(projectId.toString(), categorizedId.toString(), ctx,
      { images: [image("o1"), image("o3")] } as never);
    const afterDelete = (await asset(categorizedId)).images;
    assert.equal(afterDelete.plate, null);
    assert.deepEqual(urls(afterDelete.other), ["o1.jpg", "o3.jpg"]);
    const trashed = await trash();
    assert.deepEqual(trashed.map((item) => item.kind), ["assetImage", "assetImage"]);
    assert.deepEqual(trashed.map((item) => item.label).sort(), ["o2.jpg", "plate.jpg"]);
    assert.equal(trashed.every((item) => item.location === "Truck" && item.projectName === "Plant"), true,
      "each image remembers the asset and project it belongs to");
    await restoreAll();
    const restored = (await asset(categorizedId)).images;
    assert.equal(restored.plate.url, "https://cdn.example/plate.jpg", "the plate image returns to the plate slot");
    assert.deepEqual(urls(restored.other), ["o1.jpg", "o2.jpg", "o3.jpg"], "the image returns to its original position");

    // ── أصل بقائمة صور: حذف صورة ثم حذف الأصل نفسه ──
    await service.patchSubProject(projectId.toString(), listId.toString(), ctx,
      { images: [image("c1"), image("c3")] } as never);
    await service.deleteSubProject(projectId.toString(), listId.toString(), ctx);
    const imageEntry = (await trash()).find((item) => item.kind === "assetImage")!;
    await assert.rejects(service.restoreTrashItem(imageEntry.id, ctx), /استعد الأصل أولاً/,
      "an image cannot be restored into an asset that is itself in the trash");
    await service.restoreTrashItem((await trash()).find((item) => item.kind === "assetFolder")!.id, ctx);
    await service.restoreTrashItem(imageEntry.id, ctx);
    assert.deepEqual(urls((await asset(listId)).images), ["c1.jpg", "c2.jpg", "c3.jpg"]);

    // ── بيانات التقرير: قسم مخصص بحقوله، عضو فريق، قسم أساسي، نص ──
    await service.updateProject(projectId.toString(), ctx, {
      reportData: {
        customSections: [{ id: "sec-1", title: "Warranty" }],
        customFields: [
          { id: "f-1", sectionId: "sec-1", label: "Warranty years", type: "text", required: false, value: "3" },
          { id: "f-2", sectionId: "sec-1", label: "Warranty provider", type: "text", required: false, value: "ACME" },
        ],
        valuationTeam: [{ id: "m-1", name: "Sara" }, { id: "m-2", name: "Omar" }],
        reportTextOverrides: { "heading.mv-toc-3": "Compliance statement" },
      },
    });
    const stored = async () => (await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: projectId }))!.reportData;
    const seeded = await stored();
    assert.equal(seeded.customFields.length, 2);
    assert.equal((await trash()).length, 0, "adding data never creates trash entries");

    await service.updateProject(projectId.toString(), ctx, {
      reportData: {
        customSections: [], customFields: [],
        valuationTeam: [{ id: "m-2", name: "Omar" }],
        reportHiddenAnchorIds: ["mv-toc-4"],
        reportTextOverrides: { "heading.mv-toc-3": "" },
      },
      trashLabels: { "mv-toc-4": "4.0 Independence" },
    } as never);
    const reportTrash = await trash();
    assert.deepEqual(reportTrash.map((item) => item.kind).sort(),
      ["reportBuiltInSection", "reportCustomSection", "reportTeamMember", "reportText"]);
    const section = reportTrash.find((item) => item.kind === "reportCustomSection")!;
    assert.equal(section.label, "Warranty");
    assert.equal(section.count, 3, "the section carries its two fields in one entry");
    assert.equal(reportTrash.find((item) => item.kind === "reportBuiltInSection")!.label, "4.0 Independence");
    assert.equal(reportTrash.find((item) => item.kind === "reportText")!.label, "Compliance statement");
    await restoreAll();
    const back = await stored();
    assert.deepEqual(back.customSections, seeded.customSections);
    assert.deepEqual(back.customFields, seeded.customFields);
    assert.deepEqual(back.valuationTeam.map((row: { id: string }) => row.id), ["m-1", "m-2"]);
    assert.deepEqual(back.reportHiddenAnchorIds, []);
    assert.equal(back.reportTextOverrides["heading.mv-toc-3"], "Compliance statement");

    // ── إعادة ضبط بيانات التقرير: لقطة واحدة تعيد كل شيء ──
    await service.updateProject(projectId.toString(), ctx,
      { reportData: { customSections: [], customFields: [], valuationTeam: [] }, reportDataReset: true } as never);
    const resetTrash = await trash();
    assert.deepEqual(resetTrash.map((item) => item.kind), ["reportDataReset"]);
    await service.restoreTrashItem(resetTrash[0]!.id, ctx);
    assert.deepEqual((await stored()).customFields, seeded.customFields);
    assert.equal(await db.collection(MV_TRASH_COLLECTION).countDocuments({}), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
