import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";
import { assetUploadImageId, mongoAssetMediaArray, mongoAssetPhotos } from "../src/machine-valuation/asset-upload-idempotency";

test("asset upload retries are atomic and return the saved image after a lost response", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING, priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "asset_upload_resume_test";
  try {
    const db = await getMongoDb();
    const projectId = new ObjectId(), assetId = new ObjectId();
    let writes = 0, accessChecks = 0;
    const service = new MachineValuationService({
      isReady: () => true,
      uploadAssetImage: async ({ imageId }: { imageId: string }) => {
        writes++;
        await new Promise(resolve => setTimeout(resolve, 15));
        return { key: imageId, url: `https://images.example/${imageId}` };
      },
    } as any);
    // Test upload persistence in a real database; access is checked before every retry.
    (service as any).assertSubProjectContext = async () => { accessChecks++; };
    (service as any).ensurePhotosRootFolder = async () => ({ _id: new ObjectId() });
    (service as any).assertPicAssetFolderCanReceiveImages = async () => undefined;
    const context = { userId: "owner", companyId: "company", isSuperAdmin: false, userRole: "valuer" as const };
    const file = { originalname: "one.png", mimetype: "image/png", buffer: Buffer.from("image"), size: 5 } as Express.Multer.File;
    for (const images of [[], { main: null, plate: null, other: null }]) {
      await db.collection("assets").replaceOne({ _id: assetId }, { _id: assetId, projectId, isAssetFolder: true, images, updatedAt: new Date() }, { upsert: true });
      const options = { scope: "asset-images", imageOnly: true, uploadKeys: ["a-repeatable-upload-key"], relativePaths: ["asset/one.png"] };
      const upload = () => service.uploadProjectFiles(projectId.toString(), [file], context, assetId.toString(), options);
      const rows = await Promise.all([upload(), upload(), upload()]);
      assert.equal(new Set(rows.map(row => row[0]._id)).size, 1);
      const saved = await db.collection("assets").aggregate([{ $match: { _id: assetId } }, { $project: { media: mongoAssetMediaArray() } }]).next();
      assert.equal(saved?.media.length, 1, "parallel retries append only once in both media schemas");
      const beforeRetry = writes;
      const retry = await upload();
      assert.equal(writes, beforeRetry, "acknowledged image is not sent to storage again");
      assert.equal(retry[0]._id, rows[0][0]._id);
    }
    assert.equal(accessChecks, 8);
    await db.collection("assets").updateOne({ _id: assetId }, { $set: { images: {
      main: { url: "https://images.example/movie.mp4" }, other: [{ url: "https://images.example/photo.png" }, { url: "https://images.example/clip", mimeType: "video/webm" }],
    } } });
    const summary = await db.collection("assets").aggregate([{ $match: { _id: assetId } }, { $project: { photos: mongoAssetPhotos() } }]).next();
    assert.deepEqual(summary?.photos, [{ url: "https://images.example/photo.png" }]);
    assert.notEqual(assetUploadImageId("p", "a", "user1", "same-key").toString(), assetUploadImageId("p", "a", "user2", "same-key").toString());
    (service as any).assertSubProjectContext = async () => { throw new Error("denied"); };
    await assert.rejects(service.uploadProjectFiles(projectId.toString(), [file], context, assetId.toString(), { scope: "asset-images", imageOnly: true, uploadKeys: ["a-repeatable-upload-key"] }), /denied/);
  } finally {
    await mongoose.disconnect(); await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
