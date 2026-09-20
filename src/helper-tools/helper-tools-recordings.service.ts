import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { GridFSBucket, ObjectId } from "mongodb";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { getMongoDb } from "@/server/mongodb";
import {
  GUEST_OWNER_LABEL,
  HELPER_RECORDING_CHUNK_BYTES,
  HELPER_RECORDING_MAX_BYTES,
  HELPER_RECORDINGS_BUCKET,
  HELPER_RECORDINGS_COLLECTION,
  HELPER_UPLOADS_COLLECTION,
  helperActorKey,
  helperCanAccess,
  helperVisibilityFilter,
  type HelperActor,
  type HelperRecordingDoc,
  type HelperRecordingUpload,
} from "./helper-tools.types";

const TEMP_DIR = join(tmpdir(), "spark-helper-recordings");

function sizeLimitMessage() {
  return `حجم التسجيل يجب ألا يتجاوز ${Math.round(HELPER_RECORDING_MAX_BYTES / 1024 / 1024)} ميجابايت`;
}

function detectRecordingMime(header: Buffer) {
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (header.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  return null;
}

function parseObjectId(id: string) {
  if (!/^[a-f\d]{24}$/i.test(id)) throw new NotFoundException("التسجيل غير موجود");
  return new ObjectId(id);
}

function recordingRange(range: string | undefined, size: number): { start: number; end: number } | null | false {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < size
    ? { start, end }
    : false;
}

function publicRecording(doc: HelperRecordingDoc) {
  return {
    id: String(doc._id),
    createdAt: doc.createdAt.getTime(),
    source: doc.source,
    seconds: doc.seconds,
    description: doc.description,
    mime: doc.mime,
    size: doc.size,
    ownerKind: doc.ownerKind,
    ownerLabel: doc.ownerKind === "guest" ? GUEST_OWNER_LABEL : doc.ownerLabel,
  };
}

@Injectable()
export class HelperToolsRecordingsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  private readonly logger = new Logger(HelperToolsRecordingsService.name);

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), 3600_000);
    this.timer.unref();
    void this.ensureIndexes();
    void this.cleanup();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async db() {
    return getMongoDb();
  }

  private async ensureIndexes() {
    const db = await this.db();
    await db.collection(HELPER_RECORDINGS_COLLECTION).createIndexes([
      { key: { ownerKind: 1, userId: 1, companyId: 1, createdAt: -1 } },
      { key: { ownerKind: 1, sessionId: 1, createdAt: -1 } },
    ]).catch(() => undefined);
  }

  async list(actor: HelperActor, source?: string) {
    const db = await this.db();
    const filter: Record<string, unknown> = { ...helperVisibilityFilter(actor) };
    if (source === "system" || source === "any") filter.source = source;
    const rows = await db
      .collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return { recordings: rows.map(publicRecording) };
  }

  async beginUpload(actor: HelperActor, body: unknown) {
    const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > HELPER_RECORDING_MAX_BYTES) {
      throw new BadRequestException(sizeLimitMessage());
    }
    const source = input.source === "system" ? "system" : input.source === "any" ? "any" : null;
    if (!source) throw new BadRequestException("مصدر التسجيل غير صالح");
    const seconds = Math.max(0, Math.floor(Number(input.seconds) || 0));
    const description = String(input.description ?? "").trim().slice(0, 200);
    const mime = String(input.mime ?? "video/webm").includes("mp4") ? "video/mp4" : "video/webm";
    const name = String(input.name ?? "screen-recording.webm").replace(/[\\/\r\n\u0000-\u001f]/g, "_").slice(0, 160)
      || "screen-recording.webm";
    const id = randomUUID();
    await mkdir(TEMP_DIR, { recursive: true });
    const path = join(TEMP_DIR, `upload-${id}.tmp`);
    const handle = await open(path, "wx");
    await handle.close();
    const upload: HelperRecordingUpload = {
      _id: id,
      actorKey: helperActorKey(actor),
      source,
      seconds,
      description,
      mime,
      name,
      size,
      offset: 0,
      path,
      state: "active",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    };
    try {
      await (await this.db()).collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).insertOne(upload);
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
    return { uploadId: id, chunkSize: HELPER_RECORDING_CHUNK_BYTES };
  }

  async appendUpload(actor: HelperActor, uploadId: string, req: Request) {
    if (!/^[a-f\d-]{36}$/i.test(uploadId)) throw new NotFoundException("جلسة الرفع غير موجودة");
    const length = Number(req.headers["x-upload-length"]);
    const offset = Number(req.headers["x-upload-offset"]);
    if (!Number.isSafeInteger(length) || length < 1 || length > HELPER_RECORDING_CHUNK_BYTES || !Number.isSafeInteger(offset) || offset < 0) {
      throw new BadRequestException("جزء الرفع غير صالح");
    }
    const db = await this.db();
    const upload = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).findOneAndUpdate(
      { _id: uploadId, actorKey: helperActorKey(actor), offset, state: "active", expiresAt: { $gt: new Date() } },
      { $set: { state: "writing" } },
      { returnDocument: "before" },
    );
    if (!upload) throw new BadRequestException("تعذر متابعة الرفع؛ أعد المحاولة من البداية");
    if (offset + length > upload.size) {
      await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).updateOne({ _id: uploadId }, { $set: { state: "active" } });
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
      await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).updateOne(
        { _id: uploadId, state: "writing" },
        { $set: { state: "active", offset: offset + written } },
      );
      return { offset: offset + written };
    } catch (error) {
      await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).deleteOne({ _id: uploadId });
      await rm(upload.path, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  async completeUpload(actor: HelperActor, uploadId: string) {
    const db = await this.db();
    const upload = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).findOne({
      _id: uploadId,
      actorKey: helperActorKey(actor),
      state: "active",
    });
    if (!upload || upload.offset !== upload.size) throw new BadRequestException("لم يكتمل رفع الملف");
    await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).deleteOne({ _id: upload._id });
    try {
      const handle = await open(upload.path, "r");
      const header = Buffer.alloc(32);
      try {
        await handle.read(header, 0, 32, 0);
      } finally {
        await handle.close();
      }
      const mime = detectRecordingMime(header) ?? upload.mime;
      if (mime !== "video/webm" && mime !== "video/mp4") {
        throw new BadRequestException("أرفق تسجيلاً بصيغة WebM أو MP4");
      }
      const bucket = new GridFSBucket(db, { bucketName: HELPER_RECORDINGS_BUCKET });
      const stream = bucket.openUploadStream(upload.name, {
        metadata: {
          ownerKind: actor.kind,
          userId: actor.userId,
          companyId: actor.companyId,
          sessionId: actor.sessionId,
        },
      });
      try {
        await pipeline(createReadStream(upload.path), stream);
      } catch (error) {
        await stream.abort().catch(() => undefined);
        throw error;
      }
      const now = new Date();
      const record: HelperRecordingDoc = {
        _id: new ObjectId(),
        ownerKind: actor.kind,
        ownerLabel: actor.kind === "guest" ? GUEST_OWNER_LABEL : actor.displayName,
        userId: actor.userId,
        companyId: actor.companyId,
        sessionId: actor.sessionId,
        identityId: actor.identityId,
        source: upload.source,
        seconds: upload.seconds,
        description: upload.description,
        mime,
        size: upload.size,
        fileId: stream.id,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).insertOne(record);
      } catch (error) {
        await bucket.delete(stream.id).catch(() => undefined);
        throw error;
      }
      return { recording: publicRecording(record) };
    } finally {
      await rm(upload.path, { force: true }).catch(() => undefined);
    }
  }

  async cancelUpload(actor: HelperActor, uploadId: string) {
    const db = await this.db();
    const upload = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).findOneAndDelete({
      _id: uploadId,
      actorKey: helperActorKey(actor),
    });
    if (upload) await rm(upload.path, { force: true }).catch(() => undefined);
    return { ok: true };
  }

  async updateDescription(actor: HelperActor, id: string, description: string) {
    const db = await this.db();
    const current = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    const next = description.trim().slice(0, 200);
    await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).updateOne(
      { _id: current._id },
      { $set: { description: next, updatedAt: new Date() } },
    );
    return { recording: publicRecording({ ...current, description: next }) };
  }

  async remove(actor: HelperActor, id: string) {
    const db = await this.db();
    const current = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).deleteOne({ _id: current._id });
    await new GridFSBucket(db, { bucketName: HELPER_RECORDINGS_BUCKET }).delete(current.fileId).catch(() => undefined);
    return { ok: true };
  }

  async streamFile(actor: HelperActor, id: string, range: string | undefined, res: Response) {
    const db = await this.db();
    const current = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    const part = recordingRange(range, current.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", current.mime);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent("recording.webm")}`);
    if (part === false) {
      res.status(416).setHeader("Content-Range", `bytes */${current.size}`);
      res.end();
      return;
    }
    const start = part?.start ?? 0;
    const end = part?.end ?? current.size - 1;
    if (part) res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${current.size}`);
    res.setHeader("Content-Length", end - start + 1);
    const stream = new GridFSBucket(db, { bucketName: HELPER_RECORDINGS_BUCKET }).openDownloadStream(current.fileId, {
      start,
      end: end + 1,
    });
    try {
      await pipeline(stream, res);
    } catch (error) {
      if (!res.destroyed) throw error;
    }
  }

  private async cleanup() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const cutoff = new Date(Date.now() - 24 * 3600_000);
      await mkdir(TEMP_DIR, { recursive: true });
      for (const entry of await readdir(TEMP_DIR, { withFileTypes: true })) {
        if (!entry.isFile() || !/^upload-[a-f\d-]+\.tmp$/i.test(entry.name)) continue;
        const path = join(TEMP_DIR, entry.name);
        if ((await stat(path)).mtime < cutoff) await rm(path, { force: true });
      }
      const db = await this.db();
      const expired = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).find({ expiresAt: { $lt: new Date() } }).limit(100).toArray();
      for (const upload of expired) {
        await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).deleteOne({ _id: upload._id });
        await rm(upload.path, { force: true }).catch(() => undefined);
      }
    } catch {
      this.logger.warn("Helper recording upload cleanup will retry later");
    } finally {
      this.cleaning = false;
    }
  }
}
