import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { GridFSBucket, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { getMongoDb } from "../server/mongodb";
import { MachineValuationService } from "./machine-valuation.service";
import { DigitalOceanSpacesService } from "./digitalocean-spaces.service";
import { assetUploadImageId } from "./asset-upload-idempotency";
import { ATTACHMENT_FIELDS, attachmentWorkspaceUpdate, type AttachmentField } from "./attachment-workspace";
import { MV_FILES_BUCKET, MV_FILES_FILES_COLLECTION, MV_PROJECTS_COLLECTION } from "./collections";
import type { MvAccessContext } from "./types";

type Job = { _id: string; projectId: ObjectId; userId: string; companyId: string | null; field: AttachmentField;
  sourceIds: string[]; plans: Record<string, number>; status: "pending" | "done" | "cancelled"; label: string; updatedAt: Date };
const JOBS = "mv_attachment_uploads";
const validKey = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9-]{16,100}$/.test(value);

@Injectable()
export class AttachmentUploadService {
  constructor(private readonly mv: MachineValuationService, private readonly spaces: DigitalOceanSpacesService) {}

  private async context(projectId: string, ctx: MvAccessContext) {
    await this.mv.assertAttachmentAccess(projectId, ctx);
    return { db: await getMongoDb(), pid: new ObjectId(projectId) };
  }
  private async job(projectId: string, id: string, ctx: MvAccessContext) {
    const { db, pid } = await this.context(projectId, ctx);
    if (!validKey(id)) throw new BadRequestException("Invalid attachment upload");
    const job = await db.collection<Job>(JOBS).findOne({ _id: id, projectId: pid, userId: ctx.userId!, companyId: ctx.companyId });
    if (!job) throw new NotFoundException("Attachment upload not found");
    if (job.status === "cancelled") throw new BadRequestException("Attachment upload was cancelled");
    return { db, pid, job };
  }
  async begin(projectId: string, id: string, body: { field?: unknown; sourceIds?: unknown; label?: unknown }, ctx: MvAccessContext) {
    const { db, pid } = await this.context(projectId, ctx);
    if (!validKey(id) || !ATTACHMENT_FIELDS.includes(body.field as AttachmentField) || !Array.isArray(body.sourceIds) ||
        !body.sourceIds.length || body.sourceIds.length > 5000 || body.sourceIds.some(key => !validKey(key))) throw new BadRequestException("Invalid attachment upload plan");
    const existing = await db.collection<Job>(JOBS).findOne({ _id: id });
    if (existing && (existing.userId !== ctx.userId || existing.companyId !== ctx.companyId || !existing.projectId.equals(pid) ||
        existing.field !== body.field || JSON.stringify(existing.sourceIds) !== JSON.stringify(body.sourceIds))) throw new ConflictException("Upload identity does not match");
    await db.collection<Job>(JOBS).updateOne({ _id: id }, { $setOnInsert: {
      projectId: pid, userId: ctx.userId!, companyId: ctx.companyId, field: body.field as AttachmentField,
      sourceIds: body.sourceIds as string[], plans: {}, status: "pending", label: String(body.label ?? "").slice(0, 250), updatedAt: new Date(),
    } }, { upsert: true });
    return { ok: true };
  }
  async plan(projectId: string, id: string, body: { sourceId?: unknown; total?: unknown }, ctx: MvAccessContext) {
    const { db, job } = await this.job(projectId, id, ctx);
    if (!validKey(body.sourceId) || !job.sourceIds.includes(body.sourceId) || !Number.isInteger(body.total) || Number(body.total) < 1 || Number(body.total) > 10000) throw new BadRequestException("Invalid page plan");
    if (job.plans[body.sourceId] && job.plans[body.sourceId] !== body.total) throw new ConflictException("Page plan changed");
    await db.collection<Job>(JOBS).updateOne({ _id: id }, { $set: { [`plans.${body.sourceId}`]: Number(body.total), updatedAt: new Date() } });
    return { ok: true };
  }
  private async storeFile(projectId: string, id: string, fileId: ObjectId, file: Express.Multer.File) {
    const db = await getMongoDb(), pid = new ObjectId(projectId);
    const collection = db.collection(MV_FILES_FILES_COLLECTION);
    if (!await collection.findOne({ _id: fileId, "metadata.projectId": pid })) {
      // A database lease spans storage upload and its receipt, including multiple API instances.
      const leases = db.collection<{ _id: ObjectId; until: Date; owner: string }>("mv_attachment_file_leases");
      const owner = randomUUID();
      try { await leases.insertOne({ _id: fileId, owner, until: new Date(Date.now() + 300_000) }); }
      catch (error: any) {
        if (error?.code !== 11000) throw error;
        const takeover = await leases.updateOne({ _id: fileId, until: { $lt: new Date() } }, { $set: { owner, until: new Date(Date.now() + 300_000) } });
        if (!takeover.modifiedCount) throw new ConflictException("Page is still being saved; retry shortly");
      }
      const heartbeat = setInterval(() => {
        void leases.updateOne({ _id: fileId, owner }, { $set: { until: new Date(Date.now() + 300_000) } }).catch(() => undefined);
      }, 60_000);
      heartbeat.unref();
      try {
        if (!await collection.findOne({ _id: fileId })) {
          const name = file.originalname.replace(/[\\/:*?"<>|]/g, "-");
          const meta = { projectId: pid, mimeType: file.mimetype, originalFileName: file.originalname, updatedAt: new Date(), attachmentJobId: id };
          if (this.spaces.isReady()) {
            const stored = await this.spaces.uploadInspectorFile({ projectId, entryId: fileId.toString(), fileName: name, buffer: file.buffer, contentType: file.mimetype });
            await collection.insertOne({ _id: fileId, filename: name, length: file.buffer.length, uploadDate: new Date(), metadata: { ...meta, storage: "digitalocean", spacesKey: stored.key } });
          } else {
            const bucket = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET });
            await db.collection(`${MV_FILES_BUCKET}.chunks`).deleteMany({ files_id: fileId });
            await new Promise<void>((resolve, reject) => {
              const stream = bucket.openUploadStreamWithId(fileId, name, { metadata: meta });
              stream.on("error", reject).on("finish", () => resolve()); stream.end(file.buffer);
            });
          }
        }
      } catch (error) { throw new ServiceUnavailableException("تعذّر حفظ صورة المرفق. ستتم إعادة المحاولة."); }
      finally { clearInterval(heartbeat); await leases.deleteOne({ _id: fileId, owner }); }
    }
  }
  async original(projectId: string, id: string, sourceId: string, file: Express.Multer.File | undefined, ctx: MvAccessContext) {
    const { job } = await this.job(projectId, id, ctx);
    if (!job.sourceIds.includes(sourceId) || !file?.buffer?.length) throw new BadRequestException("Invalid original file");
    const fileId = assetUploadImageId(projectId, job.field, ctx.userId!, `${id}:${sourceId}:original`);
    await this.storeFile(projectId, id, fileId, file);
    return { fileId: fileId.toString() };
  }
  async page(projectId: string, id: string, metadata: unknown, file: Express.Multer.File | undefined, ctx: MvAccessContext) {
    const { db, pid, job } = await this.job(projectId, id, ctx);
    let body: any;
    try { body = typeof metadata === "string" ? JSON.parse(metadata) : metadata; } catch { throw new BadRequestException("Invalid attachment metadata"); }
    const sourceId = body?.source?.id, page = body?.image?.autoPageIndex;
    if (!validKey(sourceId) || !job.sourceIds.includes(sourceId) || !Number.isInteger(page) || page < 1 || page > (job.plans[sourceId] ?? 0) ||
        !file?.buffer?.length || !/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.mimetype)) throw new BadRequestException("Invalid attachment page");
    const imageId = `${sourceId}-page-${page}`;
    const fileId = assetUploadImageId(projectId, job.field, ctx.userId!, `${id}:${imageId}`);
    const kind = body.source.kind;
    if (!["pdf", "image", "excel"].includes(kind) || (job.field !== "valuationAccountingWorkspace" && kind === "excel")) throw new BadRequestException("Invalid source kind");
    const approachId = body.source.approachId;
    if (job.field === "valuationAccountingWorkspace" && !["market", "cost", "comparisons"].includes(approachId)) throw new BadRequestException("Invalid valuation approach");
    const source = { id: sourceId, kind, name: String(body.source.name ?? "").slice(0, 250), originalName: String(body.source.originalName ?? "").slice(0, 500),
      fileId: typeof body.source.fileId === "string" ? body.source.fileId : undefined,
      mimeType: String(body.source.mimeType ?? ""), sizeBytes: Number(body.source.sizeBytes) || 0, createdAt: body.source.createdAt,
      ...(job.field === "valuationAccountingWorkspace" ? { approachId, excelRowsPerImage: body.source.excelRowsPerImage } : {}) };
    if (source.fileId && (!ObjectId.isValid(source.fileId) || !await db.collection(MV_FILES_FILES_COLLECTION).findOne({ _id: new ObjectId(source.fileId), "metadata.projectId": pid, "metadata.attachmentJobId": id }))) throw new BadRequestException("Invalid original file reference");
    await this.storeFile(projectId, id, fileId, file);
    const image = { id: imageId, sourceId, sourceKind: kind, sourceFileName: source.name, name: String(body.image.name ?? source.name).slice(0, 500),
      fileId: fileId.toString(), createdAt: source.createdAt, includeInReport: true, autoGenerated: true, autoPageIndex: page, autoPageCount: job.plans[sourceId],
      ...(job.field === "valuationAccountingWorkspace" ? { approachId, displayWidthPercent: 98, displayMaxHeightPx: 2400, qualityScale: 4, autoRowsPerImage: source.excelRowsPerImage, crop: body.image.crop } : {}) };
    // Existing rows win on retry: do not undo a user's report selection or rename.
    const append = attachmentWorkspaceUpdate(job.field, { sources: [source], images: [image], updatedAt: new Date().toISOString() });
    const workspace = `$${job.field}`;
    const pipeline = [{ $set: { [job.field]: { $cond: [
      { $anyElementTrue: [{ $map: { input: { $ifNull: [`${workspace}.images`, []] }, as: "image",
        in: { $and: [{ $eq: ["$$image.id", imageId] }, { $eq: ["$$image.fileId", fileId.toString()] }] } } }] }, workspace, append,
    ] }, updatedAt: new Date() } }];
    const saved = await db.collection(MV_PROJECTS_COLLECTION).updateOne({ _id: pid }, pipeline);
    if (!saved.matchedCount) throw new NotFoundException("Project not found");
    return { imageId, fileId: fileId.toString() };
  }
  async complete(projectId: string, id: string, ctx: MvAccessContext) {
    const { db, pid, job } = await this.job(projectId, id, ctx);
    if (job.status === "done") return { ok: true };
    const project = await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: pid }, { projection: { [job.field]: 1 } });
    const images = project?.[job.field]?.images ?? [];
    const found = new Map<string, string>(images.map((image: any) => [image.id, image.fileId]));
    const ids: ObjectId[] = [];
    const missingPages: string[] = [];
    for (const sourceId of job.sourceIds) {
      const total = job.plans[sourceId];
      if (!total) throw new ConflictException("التحويل لم يكتمل بعد.");
      for (let page = 1; page <= total; page++) {
        const imageId = `${sourceId}-page-${page}`;
        const fileId = found.get(imageId);
        const expected = assetUploadImageId(projectId, job.field, ctx.userId!, `${id}:${imageId}`).toString();
        if (fileId !== expected) missingPages.push(imageId);
        else ids.push(new ObjectId(fileId));
      }
    }
    const stored = await db.collection(MV_FILES_FILES_COLLECTION).find({ _id: { $in: ids }, "metadata.projectId": pid }).project({ _id: 1 }).toArray();
    const storedIds = new Set(stored.map(row => row._id.toString()));
    for (const sourceId of job.sourceIds) for (let page = 1; page <= job.plans[sourceId]; page++) {
      const imageId = `${sourceId}-page-${page}`;
      if (!storedIds.has(found.get(imageId) ?? "") && !missingPages.includes(imageId)) missingPages.push(imageId);
    }
    if (missingPages.length) return { ok: false, missingPages };
    await db.collection<Job>(JOBS).updateOne({ _id: id }, { $set: { status: "done", updatedAt: new Date() } });
    return { ok: true, imageCount: stored.length };
  }
  async pending(projectId: string, ctx: MvAccessContext) {
    await this.mv.assertAttachmentAccess(projectId, ctx, true);
    const db = await getMongoDb(), pid = new ObjectId(projectId);
    return db.collection<Job>(JOBS).find({ projectId: pid, status: "pending" }).project({ _id: 1, label: 1 }).toArray();
  }
  async assertReady(projectId: string, ctx: MvAccessContext) {
    if ((await this.pending(projectId, ctx)).length) throw new ConflictException("انتظر اكتمال تحويل المرفقات وحفظها قبل تصدير التقرير.");
  }
  async cancel(projectId: string, id: string, ctx: MvAccessContext) {
    const { db } = await this.job(projectId, id, ctx);
    await db.collection<Job>(JOBS).updateOne({ _id: id }, { $set: { status: "cancelled", updatedAt: new Date() } });
    return { ok: true };
  }
}
