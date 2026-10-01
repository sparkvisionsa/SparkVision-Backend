import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { ObjectId, GridFSBucket } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AttachmentUploadService } from "../src/machine-valuation/attachment-upload.service";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { ATTACHMENT_FIELDS, attachmentWorkspaceUpdate } from "../src/machine-valuation/attachment-workspace";
import { getMongoDb } from "../src/server/mongodb";
import { MV_PROJECTS_COLLECTION, MV_FILES_BUCKET, MV_FILES_FILES_COLLECTION } from "../src/machine-valuation/collections";

test("attachment receipts survive retries and restarts in all three report workspaces", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const previous = [process.env.MONGO_URL_SCRAPPING, process.env.MONGO_DBNAME_SCRAPPING];
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "attachment_resume_test";
  try {
    const db = await getMongoDb(), pid = new ObjectId();
    await db.collection(MV_PROJECTS_COLLECTION).insertOne({ _id: pid });
    const access = { assertAttachmentAccess: async () => undefined };
    const makeService = () => new AttachmentUploadService(access as any, { isReady: () => false } as any);
    let service = makeService();
    const ctx = { userId: "owner", companyId: "company", isSuperAdmin: false, userRole: "valuer" as const };
    const file = { originalname: "$image.png", mimetype: "image/png", buffer: Buffer.from("test-image-bytes"), size: 16 } as Express.Multer.File;
    for (const field of ATTACHMENT_FIELDS) {
      const id = randomUUID(), sourceId = randomUUID();
      await service.begin(pid.toString(), id, { field, sourceIds: [sourceId], label: field }, ctx);
      await service.plan(pid.toString(), id, { sourceId, total: 2 }, ctx);
      await assert.rejects(service.assertReady(pid.toString(), ctx), /اكتمال/);
      const original = await service.original(pid.toString(), id, sourceId, file, ctx);
      const metadata = (index: number) => ({ source: { id: sourceId, kind: field === "valuationAccountingWorkspace" ? "excel" : "pdf", approachId: "market", name: "$document", fileId: original.fileId, createdAt: new Date().toISOString() }, image: { autoPageIndex: index } });
      const first = await service.page(pid.toString(), id, metadata(1), file, ctx);
      assert.deepEqual((await service.complete(pid.toString(), id, ctx)).missingPages, [`${sourceId}-page-2`]);
      // A stale editor knows only page one. Its later PATCH must not remove page two.
      const old = (await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: pid }))![field];
      await service.page(pid.toString(), id, metadata(2), file, ctx);
      await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: pid }, [{ $set: { [field]: attachmentWorkspaceUpdate(field, {
        ...old, images: [{ ...old.images[0], name: "$renamed", includeInReport: false }],
      }, { sources: [sourceId], images: [first.imageId] }) } }]);
      service = makeService();
      assert.deepEqual(await service.page(pid.toString(), id, metadata(1), file, ctx), first);
      const workspace = (await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: pid }))![field];
      assert.equal(workspace.images.length, 2);
      assert.equal(workspace.images.find((row: any) => row.id === first.imageId).includeInReport, false);
      assert.equal(workspace.images.find((row: any) => row.id === first.imageId).name, "$renamed");
      assert.equal(workspace.sources[0].name, "$document");
      assert.ok(workspace.updatedAt);
      await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: pid, [`${field}.images.id`]: `${sourceId}-page-2` }, { $set: { [`${field}.images.$.fileId`]: first.fileId } });
      assert.deepEqual((await service.complete(pid.toString(), id, ctx)).missingPages, [`${sourceId}-page-2`], "verification rejects an image pointing at the wrong page file");
      await service.page(pid.toString(), id, metadata(2), file, ctx);
      const bytes: Buffer[] = [];
      for await (const chunk of new GridFSBucket(db, { bucketName: MV_FILES_BUCKET }).openDownloadStream(new ObjectId(first.fileId))) bytes.push(chunk);
      assert.deepEqual(Buffer.concat(bytes), file.buffer);
      await assert.rejects(service.page(pid.toString(), id, metadata(1), file, { ...ctx, userId: "other" }), /not found/);
      assert.equal((await service.complete(pid.toString(), id, ctx)).ok, true);
      // Lost completion acknowledgement is safe even after the user edits the finished report.
      await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: pid }, { $set: { [`${field}.images`]: [] } });
      assert.equal((await service.complete(pid.toString(), id, ctx)).ok, true);
    }
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments(), 9, "one original and two image files per job, no duplicate files");
    await service.assertReady(pid.toString(), ctx);
    const failedId = randomUUID(), failedSource = randomUUID();
    const failing = new AttachmentUploadService(access as any, { isReady: () => true, uploadInspectorFile: async () => { throw new Error("storage offline"); } } as any);
    await failing.begin(pid.toString(), failedId, { field: ATTACHMENT_FIELDS[0], sourceIds: [failedSource] }, ctx);
    await failing.plan(pid.toString(), failedId, { sourceId: failedSource, total: 1 }, ctx);
    await assert.rejects(failing.page(pid.toString(), failedId, { source: { id: failedSource, kind: "image", approachId: "market" }, image: { autoPageIndex: 1 } }, file, ctx));
    assert.equal(await db.collection(MV_FILES_FILES_COLLECTION).countDocuments(), 9);
    assert.equal((await failing.pending(pid.toString(), ctx)).length, 1);
    await failing.cancel(pid.toString(), failedId, ctx);
    await service.assertReady(pid.toString(), ctx);
    const mv = new MachineValuationService({ isReady: () => false } as any);
    (mv as any).getProject = () => { throw new Error("Attachment reads must not build an asset tree"); };
    const snapshot = await mv.getAttachmentWorkspaces(pid.toString(), { ...ctx, isSuperAdmin: true });
    assert.equal(snapshot.project._id, pid.toString());
    for (const field of ATTACHMENT_FIELDS) assert.deepEqual((snapshot.project[field] as any).images, []);
    await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: pid }, { $set: {
      valuationAccountingWorkspace: JSON.stringify({ version: 1, sources: [], images: [{ id: "legacy", fileId: "saved" }] }),
      sceCertificateWorkspace: null,
    } });
    const fresh = await mv.getAttachmentWorkspaces(pid.toString(), { ...ctx, isSuperAdmin: true });
    assert.equal((fresh.project.valuationAccountingWorkspace as any).images.length, 1);
    assert.deepEqual((fresh.project.sceCertificateWorkspace as any).images, []);
    await assert.rejects(mv.getAttachmentWorkspaces(pid.toString(), ctx), /not found/);
  } finally {
    await mongoose.disconnect(); await mongo.stop();
    for (const [index, key] of ["MONGO_URL_SCRAPPING", "MONGO_DBNAME_SCRAPPING"].entries()) {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }
  }
});
