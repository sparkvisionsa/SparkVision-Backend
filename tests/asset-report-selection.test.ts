import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";

test("report selection accepts unchanged selections without rewriting categorized images", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const previous = [process.env.MONGO_URL_SCRAPPING, process.env.MONGO_DBNAME_SCRAPPING];
  process.env.MONGO_URL_SCRAPPING = mongo.getUri(); process.env.MONGO_DBNAME_SCRAPPING = "report_selection_test";
  try {
    const db = await getMongoDb(), projectId = new ObjectId(), assetId = new ObjectId(), fileId = new ObjectId();
    const service = new MachineValuationService({ isReady: () => false } as any);
    (service as any).loadProjectForAccess = async () => ({ _id: projectId });
    const ctx = { userId: "owner", companyId: "company", isSuperAdmin: false, userRole: "valuer" as const };
    const initialTime = new Date("2026-01-01");
    const images = {
      main: { url: "https://example.test/main.jpg", includeInReport: true },
      brand: { url: "https://example.test/brand.jpg", includeInReport: false },
      details: null,
      other: [{ fileId, includeInReport: true }],
    };
    await db.collection("assets").insertOne({ _id: assetId, projectId, isAssetFolder: true, name: "Asset", images, updatedAt: initialTime });
    await db.collection("mv_files.files").insertOne({ _id: fileId, metadata: { projectId, scope: "asset-images", picAssetId: assetId, includeInReport: false } });
    const patch = (body: any) => service.patchSubProject(projectId.toString(), assetId.toString(), ctx, body);
    const selections = [images.main, images.brand, { fileId: fileId.toString(), includeInReport: true }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await patch({ imageReportSelections: selections });
      assert.equal(response.picAsset.images.length, 3);
      const saved = await db.collection("assets").findOne({ _id: assetId });
      assert.deepEqual(saved!.images, images);
      assert.deepEqual(saved!.updatedAt, initialTime, "unchanged selection does not generate a new asset revision");
    }
    assert.equal((await db.collection("mv_files.files").findOne({ _id: fileId }))!.metadata.includeInReport, true, "unchanged asset selections still reconcile report file metadata");
    await patch({ imageReportSelections: [{ ...images.brand, includeInReport: true }] });
    const changed = await db.collection("assets").findOne({ _id: assetId });
    assert.equal(changed!.images.brand.includeInReport, true);
    assert.equal(changed!.images.main.includeInReport, true);
    assert.deepEqual(changed!.images.other, images.other);
    assert.equal(changed!.images.details, null);
    await patch({ imageReportSelections: [{ ...images.brand, includeInReport: true }] });
    assert.deepEqual((await db.collection("assets").findOne({ _id: assetId }))!.updatedAt, changed!.updatedAt);
    // Legacy clients may submit the flattened display list; repeating it is also valid.
    await patch({ images: [images.main, { ...images.brand, includeInReport: true }, { fileId: fileId.toString(), includeInReport: true }] });
    assert.deepEqual((await db.collection("assets").findOne({ _id: assetId }))!.images, changed!.images);
    await assert.rejects(patch({}), /No valid fields/);
    await assert.rejects(patch({ imageReportSelections: [] }), /cannot be empty/);
    await assert.rejects(patch({ imageReportSelections: [{ url: "https://example.test/missing.jpg", includeInReport: true }] }), /no longer exist/);
    // Arrays use the same idempotent selection contract.
    await db.collection("assets").updateOne({ _id: assetId }, { $set: { images: [images.main, images.brand] } });
    await patch({ imageReportSelections: [images.main, images.brand] });
    assert.deepEqual((await db.collection("assets").findOne({ _id: assetId }))!.images, [images.main, images.brand]);
  } finally {
    await mongoose.disconnect(); await mongo.stop();
    for (const [index, key] of ["MONGO_URL_SCRAPPING", "MONGO_DBNAME_SCRAPPING"].entries()) {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }
  }
});
