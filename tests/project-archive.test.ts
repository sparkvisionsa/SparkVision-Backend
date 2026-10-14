import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GridFSBucket, ObjectId } from "mongodb";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { AssetProjectAccessService } from "../src/assets/asset-project-access.service";
import { getMongoDb } from "../src/server/mongodb";
import { MV_FILES_BUCKET, MV_FILES_FILES_COLLECTION, MV_ITEMS_COLLECTION, MV_PROJECTS_COLLECTION } from "../src/machine-valuation/collections";

test("company admins restore for 30 days, super admins for one year, then project data is purged", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING;
  const priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "project_archive_test";
  try {
    const db = await getMongoDb();
    const companyId = new ObjectId(), projectId = new ObjectId(), otherCompanyId = new ObjectId();
    const otherProjectId = new ObjectId();
    await db.collection("companies").insertOne({ _id: companyId, name: "Spark Valuation", valueTechProductIds: [] });
    await db.collection("companies").insertOne({ _id: otherCompanyId, name: "Other Valuation", valueTechProductIds: [] });
    await db.collection(MV_PROJECTS_COLLECTION).insertOne({ _id: projectId, companyId,
      name: "Excavators", createdAt: new Date(), updatedAt: new Date(), displayNumber: 17, referenceNumber: "SV000017" });
    await db.collection(MV_PROJECTS_COLLECTION).insertOne({ _id: otherProjectId, companyId: otherCompanyId,
      name: "Cranes", createdAt: new Date(), updatedAt: new Date(), displayNumber: 4, referenceNumber: "OV000004" });
    await db.collection("assets").insertOne({ _id: new ObjectId(), projectId, assetId: "A1", isAssetFolder: true,
      images: { main: { url: "https://spaces.example/source.jpg", publicId: "source.jpg" } } });
    await db.collection("assets").insertOne({ _id: new ObjectId(), projectId, assetId: "A2", rawData: { serial: "123" },
      images: [{ url: "https://spaces.example/second.jpg", publicId: "second.jpg" }] });
    await db.collection("asset_imports").insertOne({ _id: new ObjectId(), projectId });
    await db.collection(MV_ITEMS_COLLECTION).insertOne({ _id: new ObjectId(), projectId, name: "Photos" });
    const fileId = await new Promise<ObjectId>((resolve, reject) => {
      const upload = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET }).openUploadStream("photo.png", {
        metadata: { projectId, scope: "asset-images" },
      });
      upload.on("error", reject);
      upload.on("finish", () => resolve(upload.id as ObjectId));
      upload.end(Buffer.from("image"));
    });
    const deletedKeys: string[] = [];
    const service = new MachineValuationService({
      publicUrlForKey: (key: string) => `https://spaces.example/${key}`,
      deleteObject: async (key: string) => { deletedKeys.push(key); },
    } as never);
    const admin = { userId: new ObjectId().toString(), companyId: companyId.toString(),
      isSuperAdmin: false, userRole: "company_admin" };
    const member = { ...admin, userRole: "valuer" };
    const stranger = { ...admin, companyId: otherCompanyId.toString() };
    const superAdmin = { userId: new ObjectId().toString(), companyId: null,
      isSuperAdmin: true, userRole: "super_admin" };

    const initialArchive = await service.listProjectArchive(admin);
    assert.equal(initialArchive.totalCount, 1);
    assert.equal(initialArchive.activeCount, 1);
    assert.equal(initialArchive.canPermanentlyDelete, true);
    assert.equal((await service.listProjectArchive(superAdmin)).totalCount, 2,
      "the super admin sees projects from every company");
    await assert.rejects(service.permanentlyDeleteProject(projectId.toString(), admin),
      "active projects cannot be permanently deleted through the archive endpoint");

    await service.deleteProject(projectId.toString(), member);
    assert.equal(await db.collection("assets").countDocuments({ projectId }), 2, "soft delete keeps asset data");
    const deletedArchive = await service.listProjectArchive(admin);
    assert.equal(deletedArchive.totalCount, 1, "the total includes soft-deleted projects");
    assert.equal(deletedArchive.deletedCount, 1);
    assert.equal(deletedArchive.projects[0]?.companyName, "Spark Valuation");
    assert.equal(deletedArchive.projects[0]?.canRestore, true);
    await service.deleteProject(otherProjectId.toString(), superAdmin);
    const superArchive = await service.listProjectArchive(superAdmin);
    assert.equal(superArchive.deletedCount, 2);
    assert.equal(superArchive.projects.find(project => project._id === otherProjectId.toString())?.companyName,
      "Other Valuation");
    assert.equal((await service.listProjectArchive(admin)).deletedCount, 1,
      "a company admin sees only its own company archive");
    await assert.rejects(service.permanentlyDeleteProject(projectId.toString(), member),
      "regular company members cannot permanently delete archived projects");
    await assert.rejects(service.permanentlyDeleteProject(otherProjectId.toString(), admin), /Project not found/);
    await service.permanentlyDeleteProject(otherProjectId.toString(), stranger);
    assert.equal(await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: otherProjectId }), null);
    assert.equal((await service.listProjects(admin)).length, 0);
    await assert.rejects(service.getProject(projectId.toString(), admin), /Project not found/);
    await assert.rejects(new AssetProjectAccessService().assertProjectAccess(projectId,
      { _id: new ObjectId(), role: "super_admin" } as never));
    await assert.rejects(service.restoreProject(projectId.toString(), member));
    await assert.rejects(service.restoreProject(projectId.toString(), stranger), /Project not found/);

    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const oneYearAfterDeletion = new Date(thirtyOneDaysAgo);
    oneYearAfterDeletion.setUTCFullYear(oneYearAfterDeletion.getUTCFullYear() + 1);
    await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: projectId },
      { $set: { deletedAt: thirtyOneDaysAgo, purgeAt: oneYearAfterDeletion } });
    await service.purgeExpiredProjects();
    assert.notEqual(await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: projectId }), null,
      "the project must not be hard-deleted after the company restore window");
    assert.equal((await service.listProjectArchive(admin)).projects[0]?.canRestore, false);
    assert.equal((await service.listProjectArchive(superAdmin)).projects
      .find(project => project._id === projectId.toString())?.canRestore, true);
    await assert.rejects(service.restoreProject(projectId.toString(), admin));
    await service.restoreProject(projectId.toString(), superAdmin);
    assert.equal((await service.listProjectArchive(admin)).activeCount, 1);
    assert.equal((await service.listProjects(admin)).length, 1);

    await service.deleteProject(projectId.toString(), admin);
    const moreThanOneYearAgo = new Date();
    moreThanOneYearAgo.setUTCFullYear(moreThanOneYearAgo.getUTCFullYear() - 1);
    moreThanOneYearAgo.setUTCDate(moreThanOneYearAgo.getUTCDate() - 1);
    await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: projectId },
      { $set: { deletedAt: moreThanOneYearAgo, purgeAt: new Date(Date.now() - 1000) } });
    await assert.rejects(service.restoreProject(projectId.toString(), superAdmin));
    await service.purgeExpiredProjects();
    assert.equal(await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: projectId }), null);
    assert.equal(await db.collection("assets").countDocuments({ projectId }), 0);
    assert.equal(await db.collection("asset_imports").countDocuments({ projectId }), 0);
    assert.equal(await db.collection(MV_ITEMS_COLLECTION).countDocuments({ projectId }), 0);
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: fileId }), null);
    assert.deepEqual(deletedKeys, ["source.jpg", "second.jpg"]);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
