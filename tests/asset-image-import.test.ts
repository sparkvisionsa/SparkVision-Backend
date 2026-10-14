import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GridFSBucket, Long, ObjectId } from "mongodb";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";
import { MV_FILES_BUCKET, MV_FILES_FILES_COLLECTION, MV_ITEMS_COLLECTION, MV_PROJECTS_COLLECTION } from "../src/machine-valuation/collections";

test("asset images copy keeps the source, and move removes it only after the destination is saved", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING;
  const priorName = process.env.MONGO_DBNAME_SCRAPPING;
  const priorFetch = globalThis.fetch;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "asset_image_import_test";
  const fetchedUrls: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    fetchedUrls.push(String(input));
    return new Response(Buffer.from("external image"), { headers: { "content-type": "image/jpeg" } });
  };
  try {
    const db = await getMongoDb();
    const companyId = new ObjectId(), sourceId = new ObjectId(), targetId = new ObjectId();
    const sourceRootId = new ObjectId(), targetRootId = new ObjectId(), sourceAssetId = new ObjectId();
    const externalImageId = new ObjectId(), imageCreatedAt = new Date("2024-03-01T10:00:00.000Z");
    let nextValTechId = 200;
    await db.collection(MV_PROJECTS_COLLECTION).insertMany([
      { _id: sourceId, companyId, name: "Source" },
      { _id: targetId, companyId, name: "Target" },
    ]);
    await db.collection(MV_ITEMS_COLLECTION).insertMany([
      { _id: sourceRootId, projectId: sourceId, parent: null, name: "2.صور المعاينة", createdAt: new Date(), updatedAt: new Date() },
      { _id: targetRootId, projectId: targetId, parent: null, name: "2.صور المعاينة", createdAt: new Date(), updatedAt: new Date() },
    ]);
    await db.collection("assets").insertOne({ _id: sourceAssetId, projectId: sourceId,
      assetId: sourceAssetId.toString(), parent: sourceRootId, name: "Pump", isAssetFolder: true,
      updatedAt: new Date(), writtenDescription: "Original inspection", condition: "Good",
      val_tech_id: Long.fromNumber(100),
      brand: "Acme", model: "P-200", quantity: 3, client_code: "CLIENT-42",
      rawData: { serial: "SN-7" }, normalizedData: { category: "machinery" },
      isDone: true,
      images: { main: { _id: new ObjectId(), url: "https://images.example/source.jpg",
        publicId: "source.jpg", mimeType: "image/jpeg", includeInReport: false },
        other: [{ _id: externalImageId, url: "https://external.example/unrelated.jpg",
          mimeType: "image/jpeg", displayOrder: 4, description: "Side view", createdAt: imageCreatedAt,
          thumbnailUrl: "https://external.example/old-thumbnail.jpg" }] },
    });
    const sourceFileId = await new Promise<ObjectId>((resolve, reject) => {
      const upload = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET }).openUploadStream("loose.png", {
        metadata: { projectId: sourceId, scope: "asset-images", relativePath: "loose.png",
          folderPath: "", mimeType: "image/png", originalFileName: "loose.png" },
      });
      upload.on("error", reject);
      upload.on("finish", () => resolve(upload.id as ObjectId));
      upload.end(Buffer.from("loose image"));
    });
    const deletedKeys: string[] = [];
    const spaces = {
      isReady: () => true,
      publicUrlForKey: (key: string) => `https://images.example/${key}`,
      copyAssetImage: async ({ imageId }: { imageId: string }) => ({ key: imageId, url: `https://images.example/${imageId}` }),
      uploadAssetImage: async ({ imageId }: { imageId: string }) => ({ key: imageId, url: `https://images.example/${imageId}` }),
      deleteObject: async (key: string) => { deletedKeys.push(key); },
    };
    const service = new MachineValuationService(spaces as never);
    (service as any).ensurePhotosRootFolder = async (_db: unknown, id: ObjectId) =>
      ({ _id: id.equals(sourceId) ? sourceRootId : targetRootId });
    (service as any).createSubProject = async (projectId: string, name: string, _ctx: unknown,
      parentId: string, options: { kind: "folder" | "asset" }) => {
      const id = new ObjectId();
      if (options.kind === "folder") {
        await db.collection(MV_ITEMS_COLLECTION).insertOne({ _id: id, projectId: new ObjectId(projectId),
          parent: new ObjectId(parentId), name, createdAt: new Date(), updatedAt: new Date() });
      } else {
        await db.collection("assets").insertOne({ _id: id, projectId: new ObjectId(projectId),
          assetId: id.toString(), val_tech_id: Long.fromNumber(nextValTechId++),
          parent: new ObjectId(parentId), name, isAssetFolder: true, images: [], updatedAt: new Date() });
      }
      return { _id: id.toString() };
    };
    const ctx = { userId: "owner", companyId: companyId.toString(), isSuperAdmin: true,
      userRole: "valuer" as const };
    const sources = await service.listAssetImageImportSources(targetId.toString(), ctx);
    assert.equal(sources.length, 1);
    assert.equal(sources[0].folderCount, 1);
    assert.equal(sources[0].imageCount, 3);
    const waitFor = async (id: string) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const status = await service.getAssetImageImport(targetId.toString(), id, ctx);
        if (status.state !== "running") return status;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("import did not finish");
    };
    const copy = await service.startAssetImageImport(targetId.toString(), sourceId.toString(), "copy", ctx);
    const copied = await waitFor(copy.id);
    assert.equal(copied.state, "completed", copied.error);
    assert.equal(copied.foldersDone, 1);
    assert.equal(copied.imagesDone, 3);
    assert.ok(await db.collection("assets").findOne({ _id: sourceAssetId }), "copy retains source asset");
    const firstTarget = await db.collection("assets").findOne({ projectId: targetId, name: "Pump" });
    assert.ok(firstTarget);
    assert.notEqual(firstTarget.images.main.url, "https://images.example/source.jpg");
    assert.equal(firstTarget.images.main.includeInReport, false);
    assert.notEqual(firstTarget.images.other[0]._id.toString(), externalImageId.toString());
    assert.equal(firstTarget.images.other[0].description, "Side view");
    assert.equal(firstTarget.images.other[0].displayOrder, 4);
    assert.deepEqual(firstTarget.images.other[0].createdAt, imageCreatedAt);
    assert.equal(firstTarget.images.other[0].thumbnailUrl, null);
    assert.deepEqual(fetchedUrls, ["https://external.example/unrelated.jpg"]);
    assert.equal(firstTarget.assetId, firstTarget._id.toString());
    assert.equal(firstTarget.val_tech_id.toString(), "200");
    assert.equal(firstTarget.writtenDescription, "Original inspection");
    assert.equal(firstTarget.condition, "Good");
    assert.equal(firstTarget.brand, "Acme");
    assert.equal(firstTarget.model, "P-200");
    assert.equal(firstTarget.quantity, 3);
    assert.equal(firstTarget.client_code, "CLIENT-42");
    assert.deepEqual(firstTarget.rawData, { serial: "SN-7" });
    assert.deepEqual(firstTarget.normalizedData, { category: "machinery" });
    assert.equal(firstTarget.isDone, true);
    assert.ok(await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: sourceFileId }));
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments({ "metadata.projectId": targetId, "metadata.scope": "asset-images" }), 1);
    assert.deepEqual(deletedKeys, []);

    const originalOpenStream = (service as any).openStoredProjectFileStream;
    (service as any).openStoredProjectFileStream = async () => { throw new Error("simulated source read failure"); };
    const failedMove = await service.startAssetImageImport(targetId.toString(), sourceId.toString(), "move", ctx);
    const failed = await waitFor(failedMove.id);
    assert.equal(failed.state, "failed");
    assert.ok(await db.collection("assets").findOne({ _id: sourceAssetId }), "failed move keeps source asset");
    assert.ok(await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: sourceFileId }), "failed move keeps source file");
    assert.equal(await db.collection("assets").countDocuments({ projectId: targetId, name: "Pump" }), 1,
      "failed import rolls back destination asset");
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments({ "metadata.projectId": targetId, "metadata.scope": "asset-images" }), 1);
    assert.ok(deletedKeys.length === 2 && deletedKeys.every(key => key !== "source.jpg"),
      "failed import removes its new objects only");
    (service as any).openStoredProjectFileStream = originalOpenStream;

    const move = await service.startAssetImageImport(targetId.toString(), sourceId.toString(), "move", ctx);
    const moved = await waitFor(move.id);
    assert.equal(moved.state, "completed", moved.error);
    assert.equal(await db.collection("assets").findOne({ _id: sourceAssetId }), null);
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: sourceFileId }), null);
    assert.equal(await db.collection("assets").countDocuments({ projectId: targetId, name: "Pump" }), 2);
    const movedAsset = await db.collection("assets").findOne({ projectId: targetId, name: "Pump", _id: { $ne: firstTarget._id } });
    assert.ok(movedAsset);
    assert.equal(movedAsset.writtenDescription, "Original inspection");
    assert.equal(movedAsset.images.other[0].description, "Side view");
    assert.equal(movedAsset.assetId, movedAsset._id.toString());
    assert.notEqual(movedAsset.val_tech_id.toString(), "100");
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments({ "metadata.projectId": targetId, "metadata.scope": "asset-images" }), 2);
    assert.equal(deletedKeys.at(-1), "source.jpg");

    await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: sourceId }, { $set: { companyId: new ObjectId() } });
    await assert.rejects(
      service.startAssetImageImport(targetId.toString(), sourceId.toString(), "copy", ctx),
      /Project not found|الشركة نفسها/,
    );
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    globalThis.fetch = priorFetch;
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
