import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { GridFSBucket, ObjectId, type Db, type Filter } from "mongodb";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import { PDFParse } from "pdf-parse";
import { getMongoDb } from "../server/mongodb";
import type { MvAccessContext } from "./types";
import type { DataExtractionDocument, DataExtractionField } from "./data-extraction.service";

const COLLECTION = "mv_data_extractions";
const BUCKET = "mv_extraction_sources";
type SavedExtraction = {
  _id: ObjectId; ownerId: string; companyId: string | null;
  result: DataExtractionDocument; originalId: ObjectId; coverId?: ObjectId;
  previewId?: ObjectId; byteLength: number; createdAt: Date; updatedAt: Date;
};

export function extractionOwnerFilter(context: MvAccessContext) {
  if (!context.userId) throw new UnauthorizedException("يجب تسجيل الدخول لاستخدام استخراج البيانات.");
  return { ownerId: context.userId, companyId: context.companyId ?? null };
}

@Injectable()
export class DataExtractionHistoryService {
  private ready?: Promise<void>;

  private async db() {
    const db = await getMongoDb();
    if (!this.ready) {
      this.ready = db.collection(COLLECTION).createIndex({ ownerId: 1, companyId: 1, _id: -1 }).then(() => undefined).catch(error => { this.ready = undefined; throw error; });
    }
    await this.ready;
    return db;
  }

  private dto(doc: SavedExtraction): DataExtractionDocument {
    const id = doc._id.toHexString();
    return {
      ...doc.result, id, createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
      sourceUrl: `/api/mv/data-extraction/history/${id}/file`,
      ...(doc.coverId ? { thumbnailUrl: `/api/mv/data-extraction/history/${id}/thumbnail` } : {}),
    };
  }

  private async upload(db: Db, bytes: Buffer, filename: string, contentType: string, owner: ReturnType<typeof extractionOwnerFilter>) {
    const bucket = new GridFSBucket(db, { bucketName: BUCKET });
    const upload = bucket.openUploadStream(filename, { metadata: { ...owner, contentType } });
    try { await pipeline(Readable.from(bytes), upload); }
    catch (error) { await upload.abort().catch(() => undefined); throw error; }
    return upload.id;
  }

  async save(files: Express.Multer.File[], results: DataExtractionDocument[], context: MvAccessContext) {
    const owner = extractionOwnerFilter(context);
    const db = await this.db();
    const saved: DataExtractionDocument[] = [];
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!, file = files[index]!;
      if (!/^(application\/pdf|image\/(png|jpeg|webp|heic|heif|avif|gif|tiff|bmp))$/.test(result.mimeType)) { saved.push(result); continue; }
      const uploaded: ObjectId[] = [];
      try {
        const originalId = await this.upload(db, file.buffer, result.fileName, result.mimeType, owner);
        uploaded.push(originalId);
        let coverId: ObjectId | undefined, previewId: ObjectId | undefined;
        // A corrupt document can still be kept in history with its extraction
        // error. Thumbnail failure must not discard the uploaded source.
        let preview: Buffer | undefined;
        try {
          if (result.mimeType === "application/pdf") {
            const pdf = new PDFParse({ data: file.buffer });
            try {
              const rendered = await pdf.getScreenshot({ partial: [1], desiredWidth: 1100, imageBuffer: true, imageDataUrl: false });
              if (rendered.pages[0]) preview = Buffer.from(rendered.pages[0].data);
            } finally { await pdf.destroy().catch(() => undefined); }
          } else preview = file.buffer;
          if (preview) {
            const cover = await sharp(preview).rotate().resize({ width: 200, height: 260, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
            coverId = await this.upload(db, cover, "cover.webp", "image/webp", owner);
            uploaded.push(coverId);
            if (result.mimeType !== "application/pdf") {
              const image = await sharp(preview).rotate().resize({ width: 2400, height: 3400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
              previewId = await this.upload(db, image, "preview.png", "image/png", owner);
              uploaded.push(previewId);
            }
          }
        } catch { /* Preserve the source; show the file icon if it cannot render. */ }
        const now = new Date();
        const document = { ...owner, result, originalId, coverId, previewId, byteLength: file.buffer.length, createdAt: now, updatedAt: now };
        const inserted = await db.collection<Omit<SavedExtraction, "_id">>(COLLECTION).insertOne(document);
        saved.push(this.dto({ ...document, _id: inserted.insertedId }));
      } catch (error) {
        const bucket = new GridFSBucket(db, { bucketName: BUCKET });
        await Promise.all(uploaded.map(id => bucket.delete(id).catch(() => undefined)));
        throw error;
      }
    }
    return saved;
  }

  async list(context: MvAccessContext, cursor?: string) {
    const filter: Filter<SavedExtraction> = extractionOwnerFilter(context);
    if (cursor) {
      if (!ObjectId.isValid(cursor)) throw new BadRequestException("مؤشر السجل غير صالح.");
      filter._id = { $lt: new ObjectId(cursor) };
    }
    const db = await this.db();
    const records = await db.collection<SavedExtraction>(COLLECTION).find(filter, {
      projection: { "result.pages": 0, "result.fields.value": 0, "result.fields.source": 0 },
    }).sort({ _id: -1 }).limit(31).toArray();
    return {
      items: records.slice(0, 30).map(record => {
        const dto = this.dto(record);
        const { fields, pages: _pages, ...metadata } = dto;
        return { ...metadata, fieldCount: fields.length };
      }),
      nextCursor: records.length > 30 ? records[29]!._id.toHexString() : null,
    };
  }

  private async find(id: string, context: MvAccessContext) {
    const owner = extractionOwnerFilter(context);
    if (!ObjectId.isValid(id)) throw new NotFoundException("الملف غير موجود.");
    const db = await this.db();
    const record = await db.collection<SavedExtraction>(COLLECTION).findOne({ _id: new ObjectId(id), ...owner });
    if (!record) throw new NotFoundException("الملف غير موجود.");
    return { db, record, filter: { _id: record._id, ...owner } };
  }

  async get(id: string, context: MvAccessContext) {
    return this.dto((await this.find(id, context)).record);
  }

  async update(id: string, value: unknown, context: MvAccessContext) {
    if (!value || typeof value !== "object" || !Array.isArray((value as { fields?: unknown }).fields)) throw new BadRequestException("الحقول غير صالحة.");
    const { db, record, filter } = await this.find(id, context);
    const incoming = (value as { fields: unknown[] }).fields;
    if (incoming.length > 10_000) throw new BadRequestException("عدد الحقول يتجاوز الحد المسموح.");
    const seen = new Set<string>();
    const fields: DataExtractionField[] = incoming.map((item, index) => {
      if (!item || typeof item !== "object") throw new BadRequestException("بيانات الحقل غير صالحة.");
      const field = item as Record<string, unknown>;
      if (typeof field.label !== "string" || !field.label.trim() || field.label.length > 200 || typeof field.value !== "string" || field.value.length > 100_000) throw new BadRequestException("أدخل اسم حقل صحيحاً وقيمة صالحة.");
      const old = record.result.fields.find(f => f.id === field.id);
      const fieldId = old?.id ?? `manual-${index}-${new ObjectId().toHexString()}`;
      if (seen.has(fieldId)) throw new BadRequestException("معرف الحقل مكرر.");
      seen.add(fieldId);
      const changed = !old || field.label !== old.label || field.value !== old.value;
      return { ...old, id: fieldId, label: field.label.trim(), value: field.value.trim(), category: old?.category ?? "other", confidence: old?.confidence ?? "high", section: typeof field.section === "string" ? field.section.slice(0, 160) : old?.section, reviewed: changed || field.reviewed === true || old?.reviewed === true };
    });
    const result = { ...record.result, fields, needsReview: fields.some(f => !f.reviewed && f.confidence !== "high"), status: fields.length ? "completed" as const : "empty" as const };
    const updatedAt = new Date();
    await db.collection<SavedExtraction>(COLLECTION).updateOne(filter, { $set: { result, updatedAt } });
    return this.dto({ ...record, result, updatedAt });
  }

  async file(id: string, variant: "original" | "thumbnail" | "preview", context: MvAccessContext) {
    const { db, record } = await this.find(id, context);
    const fileId = variant === "thumbnail" ? record.coverId : variant === "preview" ? record.previewId ?? record.originalId : record.originalId;
    if (!fileId) throw new NotFoundException("الصورة غير متاحة.");
    return {
      stream: new GridFSBucket(db, { bucketName: BUCKET }).openDownloadStream(fileId),
      mimeType: variant === "thumbnail" ? "image/webp" : variant === "preview" && record.previewId ? "image/png" : record.result.mimeType,
      fileName: record.result.fileName,
    };
  }

  async remove(id: string, context: MvAccessContext) {
    const { db, record, filter } = await this.find(id, context);
    const bucket = new GridFSBucket(db, { bucketName: BUCKET });
    for (const fileId of [record.originalId, record.coverId, record.previewId]) if (fileId) await bucket.delete(fileId);
    await db.collection<SavedExtraction>(COLLECTION).deleteOne(filter);
    return { deleted: true };
  }
}
