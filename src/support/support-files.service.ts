import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Logger } from "@nestjs/common";
import { GridFSBucket, ObjectId } from "mongodb";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Response } from "express";
import type { Request } from "express";
import { SupportService, type SupportFile } from "./support.service";
import { idSchema, type SupportActor } from "./support.types";

export const SUPPORT_MAX_FILE_BYTES = 100 * 1024 * 1024;
/** الرفع المُقطَّع يتسع لتسجيل شاشة كامل مدته ساعة قادم من "كن مطور". */
export const SUPPORT_MAX_CHUNKED_BYTES = 512 * 1024 * 1024;
export const SUPPORT_UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
function sizeLimitMessage(maxBytes: number) {
  return `حجم الملف يجب أن يكون بين 1 بايت و${Math.round(maxBytes / 1024 / 1024)} ميجابايت`;
}
export const SUPPORT_TEMP_DIR = join(tmpdir(), "spark-support-uploads");
type SupportUpload = {
  _id: string; ticketId: string; uploaderId: string; name: string; size: number;
  offset: number; path: string; state: "active" | "writing"; createdAt: Date; expiresAt: Date;
};
export function detectSupportMime(header: Buffer): string | null {
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (header.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if (header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (header.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
export function supportRange(range: string | undefined, size: number): { start: number; end: number } | null | false {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size ? { start, end } : false;
}

@Injectable()
export class SupportFilesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  private readonly logger = new Logger(SupportFilesService.name);
  constructor(private readonly support: SupportService) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), 3600_000);
    this.timer.unref();
    void this.cleanup();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async beginUpload(actor: SupportActor, ticketId: string, body: unknown) {
    await this.support.ticket(actor, ticketId);
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > SUPPORT_MAX_CHUNKED_BYTES) {
      throw new BadRequestException(sizeLimitMessage(SUPPORT_MAX_CHUNKED_BYTES));
    }
    const name = String(input.name ?? "recording.webm").replace(/[\\/\r\n\u0000-\u001f]/g, "_").slice(0, 160) || "recording.webm";
    const id = randomUUID();
    await mkdir(SUPPORT_TEMP_DIR, { recursive: true });
    const path = join(SUPPORT_TEMP_DIR, `upload-${id}.tmp`);
    const handle = await open(path, "wx");
    await handle.close();
    const upload: SupportUpload = { _id: id, ticketId, uploaderId: actor.userId, name, size, offset: 0, path, state: "active", createdAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600_000) };
    try { await (await this.support.db()).collection<SupportUpload>("support_uploads").insertOne(upload); }
    catch (error) { await rm(path, { force: true }); throw error; }
    return { uploadId: id, chunkSize: SUPPORT_UPLOAD_CHUNK_BYTES };
  }
  async appendUpload(actor: SupportActor, ticketId: string, uploadId: string, req: Request) {
    if (!/^[a-f\d-]{36}$/i.test(uploadId)) throw new NotFoundException("جلسة الرفع غير موجودة");
    const length = Number(req.headers["x-upload-length"]);
    const offset = Number(req.headers["x-upload-offset"]);
    if (!Number.isSafeInteger(length) || length < 1 || length > SUPPORT_UPLOAD_CHUNK_BYTES || !Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException("جزء الرفع غير صالح");
    }
    const db = await this.support.db();
    const upload = await db.collection<SupportUpload>("support_uploads").findOneAndUpdate(
      { _id: uploadId, ticketId, uploaderId: actor.userId, offset, state: "active", expiresAt: { $gt: new Date() } },
      { $set: { state: "writing" } }, { returnDocument: "before" },
    );
    if (!upload) throw new BadRequestException("تعذر متابعة الرفع؛ أعد المحاولة من البداية");
    if (offset + length > upload.size) {
      await db.collection<SupportUpload>("support_uploads").updateOne({ _id: uploadId }, { $set: { state: "active" } });
      throw new BadRequestException("حجم أجزاء الملف أكبر من الحجم المعلن");
    }
    const handle = await open(upload.path, "r+");
    let written = 0;
    try {
      for await (const value of req) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        written += chunk.length;
        if (written > length) throw new BadRequestException("حجم جزء الرفع غير صالح");
        await handle.write(chunk, 0, chunk.length, offset + written - chunk.length);
      }
      if (written !== length) throw new BadRequestException("لم يصل جزء الرفع كاملاً");
      await db.collection<SupportUpload>("support_uploads").updateOne(
        { _id: uploadId, state: "writing" }, { $set: { state: "active", offset: offset + written } },
      );
      return { offset: offset + written };
    } catch (error) {
      await db.collection<SupportUpload>("support_uploads").deleteOne({ _id: uploadId });
      await rm(upload.path, { force: true }).catch(() => undefined);
      throw error;
    } finally { await handle.close(); }
  }
  async completeUpload(actor: SupportActor, ticketId: string, uploadId: string) {
    const db = await this.support.db();
    const upload = await db.collection<SupportUpload>("support_uploads").findOne({ _id: uploadId, ticketId, uploaderId: actor.userId, state: "active" });
    if (!upload || upload.offset !== upload.size) throw new BadRequestException("لم يكتمل رفع الملف");
    await db.collection<SupportUpload>("support_uploads").deleteOne({ _id: uploadId });
    return this.upload(actor, ticketId, { path: upload.path, size: upload.size, originalname: upload.name } as Express.Multer.File, SUPPORT_MAX_CHUNKED_BYTES);
  }
  async cancelUpload(actor: SupportActor, ticketId: string, uploadId: string) {
    const db = await this.support.db();
    const upload = await db.collection<SupportUpload>("support_uploads").findOneAndDelete({ _id: uploadId, ticketId, uploaderId: actor.userId });
    if (upload) await rm(upload.path, { force: true }).catch(() => undefined);
    return { ok: true };
  }
  async upload(actor: SupportActor, ticketId: string, file: Express.Multer.File, maxBytes = SUPPORT_MAX_FILE_BYTES) {
    try {
      await this.support.ticket(actor, ticketId);
      if (!file?.size || file.size > maxBytes) throw new BadRequestException(sizeLimitMessage(maxBytes));
      const handle = await open(file.path, "r");
      const header = Buffer.alloc(32);
      try { await handle.read(header, 0, 32, 0); } finally { await handle.close(); }
      const mime = detectSupportMime(header);
      if (!mime) throw new BadRequestException("أرفق تسجيلاً WebM أو MP4، صورة PNG/JPG/WebP، أو ملف PDF");
      const db = await this.support.db();
      const bucket = new GridFSBucket(db, { bucketName: "support_media" });
      const name = file.originalname.replace(/[\\/\r\n\u0000-\u001f]/g, "_").slice(0, 160);
      const stream = bucket.openUploadStream(name, { metadata: { ticketId, uploaderId: actor.userId } });
      try { await pipeline(createReadStream(file.path), stream); }
      catch (error) { await stream.abort().catch(() => undefined); throw error; }
      const record: SupportFile = { _id: new ObjectId(), fileId: stream.id, ticketId, uploaderId: actor.userId, name, mime, size: file.size, createdAt: new Date(), attached: false };
      try { await db.collection<SupportFile>("support_files").insertOne(record); }
      catch (error) { await bucket.delete(stream.id).catch(() => undefined); throw error; }
      return { file: { id: String(record._id), name, mime, size: file.size } };
    } finally { if (file?.path) await rm(file.path, { force: true }).catch(() => undefined); }
  }
  async download(actor: SupportActor, id: string, range: string | undefined, res: Response) {
    const db = await this.support.db();
    const file = await db.collection<SupportFile>("support_files").findOne({ _id: new ObjectId(idSchema.parse(id)) });
    if (!file) throw new NotFoundException("المرفق غير موجود");
    await this.support.ticket(actor, file.ticketId);
    if (!file.attached && file.uploaderId !== actor.userId) throw new NotFoundException("المرفق غير موجود");
    const part = supportRange(range, file.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", file.mime);
    res.setHeader("Content-Disposition", `${file.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    if (part === false) { res.status(416).setHeader("Content-Range", `bytes */${file.size}`); res.end(); return; }
    const start = part?.start ?? 0;
    const end = part?.end ?? file.size - 1;
    if (part) res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${file.size}`);
    res.setHeader("Content-Length", end - start + 1);
    const stream = new GridFSBucket(db, { bucketName: "support_media" }).openDownloadStream(file.fileId, { start, end: end + 1 });
    try { await pipeline(stream, res); } catch (error) { if (!res.destroyed) throw error; }
  }
  async discard(actor: SupportActor, id: string) {
    const db = await this.support.db();
    const file = await db.collection<SupportFile>("support_files").findOneAndDelete({ _id: new ObjectId(idSchema.parse(id)), uploaderId: actor.userId, attached: false });
    if (file) await new GridFSBucket(db, { bucketName: "support_media" }).delete(file.fileId);
    return { ok: true };
  }
  private async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const cutoff = new Date(Date.now() - 24 * 3600_000);
      await mkdir(SUPPORT_TEMP_DIR, { recursive: true });
      for (const entry of await readdir(SUPPORT_TEMP_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !/^(?:upload-)?[a-f\d-]+\.tmp$/i.test(entry.name)) continue;
        const path = join(SUPPORT_TEMP_DIR, entry.name);
        if ((await stat(path)).mtime < cutoff) await rm(path, { force: true });
      }
      const db = await this.support.db();
      const expiredUploads = await db.collection<SupportUpload>("support_uploads").find({ expiresAt: { $lt: new Date() } }).limit(100).toArray();
      for (const upload of expiredUploads) {
        await db.collection<SupportUpload>("support_uploads").deleteOne({ _id: upload._id });
        await rm(upload.path, { force: true }).catch(() => undefined);
      }
      const bucket = new GridFSBucket(db, { bucketName: "support_media" });
      const abandoned = await db.collection<SupportFile>("support_files").find({ attached: false, createdAt: { $lt: cutoff } }).limit(100).toArray();
      for (const file of abandoned) {
        // A message may have committed immediately before a failed metadata update.
        if (await db.collection("support_messages").findOne({ "attachments.id": String(file._id) })) {
          await db.collection<SupportFile>("support_files").updateOne({ _id: file._id }, { $set: { attached: true } });
          continue;
        }
        await bucket.delete(file.fileId).catch(() => undefined);
        await db.collection<SupportFile>("support_files").deleteOne({ _id: file._id, attached: false });
      }
    } catch { this.logger.warn("Support attachment cleanup will retry later"); }
    finally { this.cleaning = false; }
  }
}
