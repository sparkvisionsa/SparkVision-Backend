import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { GridFSBucket, ObjectId } from "mongodb";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getMongoDb } from "@/server/mongodb";
import type { HelperActor } from "./helper-tools.types";

const COLLECTION = "helper_saved_pdfs";
const COUNTERS = "helper_saved_pdf_counters";
const BUCKET = "helper_saved_pdf_files";
export const HELPER_PDF_MAX_BYTES = 100 * 1024 * 1024;

type SavedPdf = {
  _id: ObjectId;
  scopeKey: string;
  sequence: number;
  fileId: ObjectId;
  name: string;
  kind: "standard" | "compressed";
  imageCount: number;
  pdfCount: number;
  size: number;
  createdAt: Date;
};

export function helperPdfScope(actor: HelperActor) {
  if (actor.companyId) return `company:${actor.companyId}`;
  if (actor.userId) return `user:${actor.userId}`;
  return `guest:${actor.sessionId}`;
}

function dto(row: SavedPdf) {
  return {
    id: row._id.toHexString(),
    sequence: row.sequence,
    name: row.name,
    kind: row.kind,
    imageCount: row.imageCount,
    pdfCount: row.pdfCount,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class HelperPdfsService {
  private ready?: Promise<void>;

  private async db() {
    const db = await getMongoDb();
    if (!this.ready) {
      this.ready = db.collection<SavedPdf>(COLLECTION)
        .createIndex({ scopeKey: 1, sequence: -1 }, { unique: true })
        .then(() => undefined)
        .catch(error => { this.ready = undefined; throw error; });
    }
    await this.ready;
    return db;
  }

  async list(actor: HelperActor) {
    const db = await this.db();
    const rows = await db.collection<SavedPdf>(COLLECTION)
      .find({ scopeKey: helperPdfScope(actor) })
      .sort({ sequence: -1 })
      .toArray();
    return { files: rows.map(dto) };
  }

  async save(actor: HelperActor, file: Express.Multer.File | undefined, body: Record<string, unknown>) {
    if (!file?.buffer?.length || file.size > HELPER_PDF_MAX_BYTES || file.buffer.subarray(0, 5).toString() !== "%PDF-") {
      throw new BadRequestException("ملف PDF غير صالح أو يتجاوز 100 ميجابايت.");
    }
    const imageCount = Number(body.imageCount);
    const pdfCount = Number(body.pdfCount);
    const kind = body.kind;
    if (!Number.isSafeInteger(imageCount) || imageCount < 0 || imageCount > 10000 ||
        !Number.isSafeInteger(pdfCount) || pdfCount < 0 || pdfCount > 10000 ||
        (kind !== "standard" && kind !== "compressed")) {
      throw new BadRequestException("بيانات ملف PDF غير صالحة.");
    }
    const name = (kind === "compressed" ? "images-compressed.pdf" : "images.pdf");
    const scopeKey = helperPdfScope(actor);
    const db = await this.db();
    const bucket = new GridFSBucket(db, { bucketName: BUCKET });
    const upload = bucket.openUploadStream(name, { metadata: { scopeKey, contentType: "application/pdf" } });
    try {
      await pipeline(Readable.from(file.buffer), upload);
    } catch (error) {
      await upload.abort().catch(() => undefined);
      throw error;
    }
    try {
      const counter = await db.collection<{ _id: string; value: number }>(COUNTERS).findOneAndUpdate(
        { _id: scopeKey },
        { $inc: { value: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      if (!counter) throw new Error("Could not allocate PDF sequence");
      const row: SavedPdf = {
        _id: new ObjectId(), scopeKey, sequence: counter.value, fileId: upload.id,
        name, kind, imageCount, pdfCount, size: file.size, createdAt: new Date(),
      };
      await db.collection<SavedPdf>(COLLECTION).insertOne(row);
      return { file: dto(row) };
    } catch (error) {
      await bucket.delete(upload.id).catch(() => undefined);
      throw error;
    }
  }

  async file(actor: HelperActor, id: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) throw new NotFoundException("ملف PDF غير موجود.");
    const db = await this.db();
    const row = await db.collection<SavedPdf>(COLLECTION).findOne({ _id: new ObjectId(id), scopeKey: helperPdfScope(actor) });
    if (!row) throw new NotFoundException("ملف PDF غير موجود.");
    return {
      stream: new GridFSBucket(db, { bucketName: BUCKET }).openDownloadStream(row.fileId),
      name: row.name,
      size: row.size,
    };
  }
}
