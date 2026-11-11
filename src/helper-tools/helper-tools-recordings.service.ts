import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { GridFSBucket, ObjectId } from "mongodb";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { getMongoDb } from "@/server/mongodb";
import { DigitalOceanSpacesService } from "@/machine-valuation/digitalocean-spaces.service";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import {
  GUEST_OWNER_LABEL,
  HELPER_RECORDING_CHUNK_BYTES,
  HELPER_RECORDING_MAX_BYTES,
  HELPER_RECORDINGS_BUCKET,
  HELPER_RECORDINGS_COLLECTION,
  HELPER_UPLOADS_COLLECTION,
  HELPER_MULTIPART_UPLOADS_COLLECTION,
  type HelperMultipartUpload,
  helperActorKey,
  helperCanAccess,
  helperVisibilityFilter,
  type HelperActor,
  type HelperRecordingDoc,
  type HelperRecordingUpload,
} from "./helper-tools.types";

const TEMP_DIR = join(tmpdir(), "spark-helper-recordings");
const execFileAsync = promisify(execFile);

function sizeLimitMessage() {
  return `حجم التسجيل يجب ألا يتجاوز ${Math.round(HELPER_RECORDING_MAX_BYTES / 1024 / 1024)} ميجابايت`;
}

function detectRecordingMime(header: Buffer) {
  if (header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (header.subarray(4, 8).toString() === "ftyp") return "video/mp4";
  return null;
}

function executablePath(configured: string | undefined, fallback: string) {
  const value = configured?.trim();
  if (!value) return fallback;
  if ((value.includes("/") || value.includes("\\")) && !existsSync(value)) return fallback;
  return value;
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
    status: doc.status ?? "ready",
    failureReason: doc.failureReason ?? null,
    thumbnailUrl: doc.thumbnailKey ? `/api/helper-tools/recordings/${String(doc._id)}/thumbnail` : null,
    hlsUrl: doc.hlsKey ? `/api/helper-tools/recordings/${String(doc._id)}/manifest.m3u8` : null,
  };
}

@Injectable()
export class HelperToolsRecordingsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  private readonly logger = new Logger(HelperToolsRecordingsService.name);
  private queue?: Queue;

  constructor(@Inject(DigitalOceanSpacesService) private readonly spaces: DigitalOceanSpacesService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup(), 3600_000);
    this.timer.unref();
    void this.ensureIndexes();
    void this.cleanup();
    if (process.env.REDIS_URL) {
      const connection = new IORedis(process.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        // Keep retrying so the queue recovers if Redis starts later, without
        // hammering localhost or flooding the terminal while it is unavailable.
        retryStrategy: (attempt) => Math.min(attempt * 1000, 30_000),
      });
      let redisWarningShown = false;
      const reportUnavailable = () => {
        if (redisWarningShown) return;
        redisWarningShown = true;
        this.logger.warn("Redis is unavailable; recording jobs will resume when Redis reconnects.");
      };
      connection.on("error", reportUnavailable);
      connection.on("ready", () => {
        if (redisWarningShown) this.logger.log("Redis reconnected; recording jobs can be processed again.");
        redisWarningShown = false;
      });
      this.queue = new Queue("helper-recording-processing", { connection });
      this.queue.on("error", reportUnavailable);
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    void this.queue?.close();
  }

  private async db() {
    return getMongoDb();
  }

  private async ensureIndexes() {
    const db = await this.db();
    await db.collection(HELPER_RECORDINGS_COLLECTION).createIndexes([
      { key: { ownerKind: 1, userId: 1, companyId: 1, createdAt: -1 } },
      { key: { ownerKind: 1, sessionId: 1, createdAt: -1 } },
      { key: { status: 1, updatedAt: 1 } },
    ]).catch(() => undefined);
    await db.collection(HELPER_MULTIPART_UPLOADS_COLLECTION).createIndex({ actorKey: 1, clientRequestId: 1 }, { unique: true, sparse: true }).catch(() => undefined);
  }

  private async enqueueProcessingJob(recordingId: string) {
    if (!this.queue) return false;
    const existing = await this.queue.getJob(recordingId);
    if (existing) {
      const state = await existing.getState();
      if (state !== "completed" && state !== "failed" && state !== "unknown") return false;
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add("process", { recordingId }, {
      jobId: recordingId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return true;
  }

  async requeueProcessingRecordings() {
    if (!this.queue) return;
    const rows = await (await this.db()).collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION)
      .find({ status: "processing", rawKey: { $type: "string" } })
      .sort({ updatedAt: 1 })
      .limit(100)
      .toArray();
    let queued = 0;
    for (const row of rows) {
      if (await this.enqueueProcessingJob(String(row._id))) queued += 1;
    }
    if (queued) this.logger.log(`Requeued ${queued} recording(s) that were left processing.`);
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

  async beginMultipartUpload(actor: HelperActor, body: unknown) {
    if (!this.spaces.isReady()) throw new BadRequestException("تخزين الفيديو غير مهيأ على الخادم.");
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const size = Number(input.maxSize ?? HELPER_RECORDING_MAX_BYTES);
    const seconds = Number(input.seconds);
    if (!Number.isSafeInteger(size) || size < 1 || size > HELPER_RECORDING_MAX_BYTES) throw new BadRequestException(sizeLimitMessage());
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) throw new BadRequestException("مدة التسجيل يجب ألا تتجاوز ساعة واحدة.");
    const mime = String(input.mime ?? "").toLowerCase();
    if (!/^video\/(webm|mp4)(;|$)/.test(mime)) throw new BadRequestException("صيغة التسجيل غير مدعومة.");
    const source = input.source === "system" ? "system" : "any";
    const rawRequestId = String(input.clientRequestId ?? "");
    const clientRequestId = /^[a-f\d-]{36}$/i.test(rawRequestId) ? rawRequestId : randomUUID();
    const sessions = (await this.db()).collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION);
    const existing = await sessions.findOne({ actorKey: helperActorKey(actor), clientRequestId, state: "active", expiresAt: { $gt: new Date() } });
    if (existing) return { uploadId: existing._id, recordingId: existing.recordingId, partSize: 8 * 1024 * 1024 };
    const description = String(input.description ?? "").trim().slice(0, 200);
    const name = String(input.name ?? "screen-recording.webm").replace(/[\\/\r\n\u0000-\u001f]/g, "_").slice(0, 160) || "screen-recording.webm";
    const recordingId = new ObjectId();
    const multipartId = randomUUID();
    const key = this.spaces.buildRecordingKey(String(recordingId), name, "raw");
    const uploadId = await this.spaces.createMultipartUpload(key, mime.split(";")[0]);
    const now = new Date();
    const doc: HelperRecordingDoc = {
      _id: recordingId, ownerKind: actor.kind, ownerLabel: actor.kind === "guest" ? GUEST_OWNER_LABEL : actor.displayName,
      userId: actor.userId, companyId: actor.companyId, sessionId: actor.sessionId, identityId: actor.identityId,
      source, seconds: Math.floor(seconds), description, mime: mime.split(";")[0], size: 0, rawKey: key,
      status: "uploading", createdAt: now, updatedAt: now,
    };
    const session: HelperMultipartUpload = {
      _id: multipartId, actorKey: helperActorKey(actor), recordingId: String(recordingId), key, uploadId,
      clientRequestId,
      name, mime: doc.mime, size: 0, maxSize: size, seconds: doc.seconds, description, source, state: "active", createdAt: now,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    };
    const db = await this.db();
    try {
      await db.collection(HELPER_RECORDINGS_COLLECTION).insertOne(doc);
      await db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION).insertOne(session);
    } catch (error) {
      await this.spaces.abortMultipartUpload(key, uploadId).catch(() => undefined);
      await db.collection(HELPER_RECORDINGS_COLLECTION).deleteOne({ _id: recordingId }).catch(() => undefined);
      const concurrent = await sessions.findOne({ actorKey: helperActorKey(actor), clientRequestId, state: "active" });
      if (concurrent) return { uploadId: concurrent._id, recordingId: concurrent.recordingId, partSize: 8 * 1024 * 1024 };
      throw error;
    }
    return { uploadId: multipartId, recordingId: String(recordingId), partSize: 8 * 1024 * 1024 };
  }

  private async multipartSession(actor: HelperActor, id: string) {
    const session = await (await this.db()).collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION).findOne({
      _id: id, actorKey: helperActorKey(actor), state: "active", expiresAt: { $gt: new Date() },
    });
    if (!session) throw new NotFoundException("جلسة الرفع غير موجودة أو انتهت صلاحيتها.");
    return session;
  }

  async presignMultipartPart(actor: HelperActor, id: string, rawPartNumber: string) {
    const session = await this.multipartSession(actor, id);
    const partNumber = Number(rawPartNumber);
    const maximum = Math.ceil(session.maxSize / (8 * 1024 * 1024));
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > maximum || partNumber > 10000) throw new BadRequestException("رقم الجزء غير صالح.");
    return { url: await this.spaces.presignUploadPart(session.key, session.uploadId, partNumber), expiresIn: 900 };
  }

  async multipartParts(actor: HelperActor, id: string) {
    const session = await this.multipartSession(actor, id);
    return { parts: await this.spaces.listMultipartParts(session.key, session.uploadId) };
  }

  async completeMultipartUpload(actor: HelperActor, id: string, body: unknown) {
    const db = await this.db();
    const sessionCollection = db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION);
    const existingSession = await sessionCollection.findOne({ _id: id, actorKey: helperActorKey(actor) });
    if (!existingSession) throw new NotFoundException("جلسة الرفع غير موجودة.");
    if (existingSession.state === "completed") {
      const recording = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: new ObjectId(existingSession.recordingId) });
      if (!recording || !helperCanAccess(recording, actor)) throw new NotFoundException("التسجيل غير موجود.");
      if (recording.status === "processing") await this.enqueueProcessingJob(existingSession.recordingId);
      return { recording: publicRecording(recording) };
    }
    const session = await this.multipartSession(actor, id);
    const declaredTotal = Number(body && typeof body === "object" ? (body as Record<string, unknown>).size : 0);
    const declaredSeconds = Number(body && typeof body === "object" ? (body as Record<string, unknown>).seconds : 0);
    const seconds = Number.isSafeInteger(declaredSeconds) && declaredSeconds > 0 && declaredSeconds <= 3600 ? declaredSeconds : session.seconds;
    if (Number.isSafeInteger(declaredTotal) && declaredTotal > 0 && declaredTotal <= session.maxSize) {
      const alreadyCompleted = await this.spaces.headObject(session.key).catch(() => null);
      if (alreadyCompleted && alreadyCompleted.size === declaredTotal && alreadyCompleted.contentType.startsWith("video/")) {
        await sessionCollection.updateOne({ _id: id }, { $set: { state: "completed", size: declaredTotal } });
        await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).updateOne(
          { _id: new ObjectId(session.recordingId), status: "uploading" }, { $set: { status: "processing", size: declaredTotal, seconds, updatedAt: new Date() } },
        );
        if (!this.queue) {
          await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).updateOne({ _id: new ObjectId(session.recordingId) }, { $set: { status: "failed", failureReason: "Redis غير متصل؛ لم تبدأ المعالجة.", updatedAt: new Date() } });
          throw new BadRequestException("خدمة معالجة الفيديو غير متاحة حاليًا.");
        }
        await this.enqueueProcessingJob(session.recordingId);
        const completedRecord = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: new ObjectId(session.recordingId) });
        return { recording: completedRecord ? publicRecording(completedRecord) : null };
      }
    }
    const requested = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).parts)
      ? (body as { parts: Array<{ partNumber?: unknown; etag?: unknown }> }).parts : [];
    const uploaded = await this.spaces.listMultipartParts(session.key, session.uploadId);
    const parts = requested.map((part) => ({ PartNumber: Number(part.partNumber), ETag: String(part.etag ?? "").trim() }));
    const expectedCount = parts.length;
    const uploadedMap = new Map(uploaded.map((part) => [part.partNumber, part]));
    if (expectedCount < 1 || expectedCount > 128 || uploaded.length !== expectedCount || parts.some((part, index) => {
      const stored = uploadedMap.get(part.PartNumber);
      return part.PartNumber !== index + 1 || !part.ETag || stored?.etag.replace(/^"|"$/g, "") !== part.ETag || (index < expectedCount - 1 && stored.size !== 8 * 1024 * 1024);
    })) throw new BadRequestException("لم تكتمل جميع أجزاء التسجيل.");
    const total = uploaded.reduce((sum, part) => sum + part.size, 0);
    if (!total || total > session.maxSize) throw new BadRequestException(sizeLimitMessage());
    if (declaredTotal && total !== declaredTotal) throw new BadRequestException("حجم الأجزاء المرفوعة لا يطابق الحجم المعلن.");
    const trustedParts = parts.map((part) => ({ ...part, ETag: uploadedMap.get(part.PartNumber)!.etag }));
    await this.spaces.completeMultipartUpload(session.key, session.uploadId, trustedParts);
    const object = await this.spaces.headObject(session.key);
    if (object.size !== total || !object.contentType.startsWith("video/")) {
      throw new BadRequestException("تعذر التحقق من ملف التسجيل بعد الرفع.");
    }
    await sessionCollection.updateOne({ _id: id }, { $set: { state: "completed", size: total } });
    await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).updateOne(
      { _id: new ObjectId(session.recordingId), status: "uploading" }, { $set: { status: "processing", size: total, seconds, updatedAt: new Date() } },
    );
    if (!this.queue) {
      await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).updateOne(
        { _id: new ObjectId(session.recordingId) }, { $set: { status: "failed", failureReason: "Redis غير متصل؛ لم تبدأ المعالجة.", updatedAt: new Date() } },
      );
      throw new BadRequestException("خدمة معالجة الفيديو غير متاحة حاليًا.");
    }
    await this.enqueueProcessingJob(session.recordingId);
    const recording = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: new ObjectId(session.recordingId) });
    return { recording: recording ? publicRecording(recording) : null };
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
    const alreadyWritten = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).findOne({
      _id: uploadId,
      actorKey: helperActorKey(actor),
      state: "active",
      offset: offset + length,
    });
    if (alreadyWritten) return { offset: alreadyWritten.offset };
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
      await handle.truncate(offset).catch(() => undefined);
      await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).updateOne(
        { _id: uploadId, state: "writing", offset },
        { $set: { state: "active" } },
      ).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
    }
  }

  async completeUpload(actor: HelperActor, uploadId: string) {
    const db = await this.db();
    const uploads = db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION);
    const actorKey = helperActorKey(actor);
    const current = await uploads.findOne({ _id: uploadId, actorKey });
    if (!current || current.offset !== current.size) throw new BadRequestException("Upload is incomplete");
    if (current.recordingId) {
      const existing = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: new ObjectId(current.recordingId) });
      if (existing && helperCanAccess(existing, actor)) {
        await uploads.updateOne({ _id: current._id }, { $set: { state: "completed" } });
        return { recording: publicRecording(existing) };
      }
      if (current.state === "completing") throw new BadRequestException("Upload is still completing; retry shortly");
    }
    if (current.state !== "active") throw new BadRequestException("Upload cannot be completed in its current state");
    const recordingId = current.recordingId || new ObjectId().toHexString();
    const upload = await uploads.findOneAndUpdate(
      { _id: current._id, actorKey, offset: current.size, state: "active" },
      { $set: { state: "completing", recordingId } },
      { returnDocument: "after" },
    );
    if (!upload) throw new BadRequestException("Upload is already completing; retry shortly");
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
        throw new BadRequestException("Attach a recording in WebM or MP4 format");
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
        _id: new ObjectId(recordingId),
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
      await uploads.updateOne({ _id: upload._id, state: "completing" }, { $set: { state: "completed" } });
      await rm(upload.path, { force: true }).catch(() => undefined);
      return { recording: publicRecording(record) };
    } catch (error) {
      await uploads.updateOne({ _id: upload._id, state: "completing" }, { $set: { state: "active" } }).catch(() => undefined);
      throw error;
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

  async cancelMultipartUpload(actor: HelperActor, id: string) {
    const db = await this.db();
    const uploads = db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION);
    const session = await uploads.findOne({ _id: id, actorKey: helperActorKey(actor), state: "active" });
    if (!session) return { ok: true };
    await this.spaces.abortMultipartUpload(session.key, session.uploadId).catch((error) => this.logger.warn(`Could not abort multipart recording upload: ${String(error)}`));
    await uploads.updateOne({ _id: id }, { $set: { state: "aborted" } });
    await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).deleteOne({ _id: new ObjectId(session.recordingId), status: "uploading" });
    return { ok: true };
  }

  async playbackManifest(actor: HelperActor, id: string, variant: string | undefined, res: Response) {
    const db = await this.db();
    const current = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    if (current.status && current.status !== "ready") throw new BadRequestException(current.failureReason || "التسجيل قيد المعالجة.");
    if (!current.hlsKey) throw new NotFoundException("قائمة البث غير متاحة لهذا التسجيل.");
    const masterKey = current.hlsKey;
    const allowedVariants = new Set(["720p", "480p", "360p"]);
    if (variant && !allowedVariants.has(variant)) throw new BadRequestException("دقة البث غير صالحة.");
    const manifestKey = variant ? `${masterKey.substring(0, masterKey.lastIndexOf("/"))}/${variant}/index.m3u8` : masterKey;
    const object = await this.spaces.getObjectStream(manifestKey);
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream as AsyncIterable<Buffer>) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    let playlist = Buffer.concat(chunks).toString("utf8");
    const lines = playlist.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith("#")) {
        if (!variant) {
          const variantName = line.split("/")[0];
          if (!allowedVariants.has(variantName)) throw new BadRequestException("ملف جودة البث غير صالح.");
          lines[i] = `/api/helper-tools/recordings/${String(current._id)}/manifest.m3u8?variant=${encodeURIComponent(variantName)}`;
        } else {
          if (!/^segment_\d+\.ts$/.test(line)) throw new BadRequestException("مقطع البث غير صالح.");
          // Resolve only the requested segments. Signing every segment here delays long videos.
          lines[i] = `/api/helper-tools/recordings/${String(current._id)}/hls/${variant}/${line}`;
        }
      }
    }
    playlist = lines.join("\n");
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(playlist);
  }

  async playbackSegment(actor: HelperActor, id: string, variant: string, segment: string, res: Response) {
    if (!["720p", "480p", "360p"].includes(variant) || !/^segment_\d+\.ts$/.test(segment)) {
      throw new BadRequestException("مقطع البث غير صالح.");
    }
    const current = await (await this.db()).collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor) || current.status !== "ready" || !current.hlsKey) {
      throw new NotFoundException("مقطع البث غير متاح.");
    }
    const prefix = current.hlsKey.substring(0, current.hlsKey.lastIndexOf("/"));
    const playbackTtl = Math.max(300, Math.min(7200, Number(process.env.RECORDING_PLAYBACK_URL_TTL_SECONDS) || 7200));
    res.setHeader("Cache-Control", "private, no-store");
    res.redirect(302, await this.spaces.presignGet(`${prefix}/${variant}/${segment}`, playbackTtl));
  }

  async thumbnail(actor: HelperActor, id: string, res: Response) {
    const current = await (await this.db()).collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor) || !current.thumbnailKey) throw new NotFoundException("الصورة غير متاحة.");
    res.redirect(302, await this.spaces.presignGet(current.thumbnailKey, 300));
  }

  async processRecording(recordingId: string, finalAttempt = true) {
    const db = await this.db();
    const records = db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION);
    const record = await records.findOne({ _id: parseObjectId(recordingId) });
    if (!record?.rawKey || record.status !== "processing") return;
    const workDir = join(tmpdir(), `spark-recording-${recordingId}`);
    const source = join(workDir, `source.${record.mime === "video/mp4" ? "mp4" : "webm"}`);
    const mp4Path = join(workDir, "output.mp4");
    const thumbPath = join(workDir, "thumbnail.jpg");
    const hlsDir = join(workDir, "hls");
    try {
      await rm(workDir, { recursive: true, force: true });
      const hlsBase = this.spaces.buildRecordingKey(recordingId, "marker", "hls").replace(/marker$/, "");
      const processedBase = this.spaces.buildRecordingKey(recordingId, "marker", "processed").replace(/marker$/, "");
      await Promise.all([this.spaces.deletePrefix(hlsBase), this.spaces.deletePrefix(processedBase)]);
      await mkdir(hlsDir, { recursive: true });
      const raw = await this.spaces.getObjectStream(record.rawKey);
      await pipeline(raw.stream as NodeJS.ReadableStream, createWriteStream(source));
      const ffprobe = executablePath(process.env.FFPROBE_PATH, "ffprobe");
      const ffmpeg = executablePath(process.env.FFMPEG_PATH, "ffmpeg");
      const ffmpegThreads = String(Math.max(1, Math.min(8, Math.floor(Number(process.env.RECORDING_FFMPEG_THREADS) || 2))));
      const probe = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type", "-of", "json", source], { maxBuffer: 2 * 1024 * 1024 });
      const metadata = JSON.parse(probe.stdout) as { format?: { duration?: string; size?: string } };
      const sourceDuration = Number(metadata.format?.duration);
      // MediaRecorder WebM often omits Duration, so measure the fast-start MP4 instead.
      if (Number.isFinite(sourceDuration) && sourceDuration > 3600) throw new Error("المدة الفعلية للتسجيل تتجاوز ساعة واحدة.");
      await execFileAsync(ffmpeg, ["-y", "-i", source, "-filter_threads", ffmpegThreads, "-vf", "scale=w=min(1280\\,iw):h=-2", "-c:v", "libx264", "-threads", ffmpegThreads, "-preset", "veryfast", "-crf", "28", "-r", "24", "-g", "144", "-keyint_min", "144", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mp4Path], { maxBuffer: 8 * 1024 * 1024 });
      const outputProbe = await execFileAsync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "json", mp4Path], { maxBuffer: 2 * 1024 * 1024 });
      const duration = Number((JSON.parse(outputProbe.stdout) as { format?: { duration?: string } }).format?.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) throw new Error("المدة الفعلية للتسجيل تتجاوز ساعة أو تعذر قراءتها.");
      const thumbnailSecond = Math.max(0, Math.min(2, duration - 0.1)).toFixed(2);
      await execFileAsync(ffmpeg, ["-y", "-ss", thumbnailSecond, "-i", mp4Path, "-frames:v", "1", "-q:v", "3", thumbPath], { maxBuffer: 2 * 1024 * 1024 });
      const playlistPath = join(hlsDir, "master.m3u8");
      const variantLabels = ["720p"];
      for (const label of variantLabels) await mkdir(join(hlsDir, label), { recursive: true });
      // The MP4 already has H.264/AAC and six-second keyframes. Segment it without another encode.
      const hlsArgs = ["-y", "-i", mp4Path, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments", "-hls_segment_filename", join(hlsDir, "720p", "segment_%05d.ts"), join(hlsDir, "720p", "index.m3u8")];
      await execFileAsync(ffmpeg, hlsArgs, { maxBuffer: 8 * 1024 * 1024 });
      const mp4Size = (await stat(mp4Path)).size;
      const bandwidth = Math.max(300_000, Math.ceil(mp4Size * 8 / duration * 1.2));
      await writeFile(playlistPath, `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}\n720p/index.m3u8\n`);
      const mp4Key = this.spaces.buildRecordingKey(recordingId, "video.mp4", "processed");
      const playlistKey = this.spaces.buildRecordingKey(recordingId, "master.m3u8", "hls");
      const hlsPrefix = playlistKey.substring(0, playlistKey.lastIndexOf("/"));
      const thumbnailKey = this.spaces.buildRecordingKey(recordingId, "thumbnail.jpg", "processed");
      await this.spaces.uploadPrivateFile(mp4Key, mp4Path, mp4Size, "video/mp4");
      const hlsFiles: string[] = ["master.m3u8"];
      for (const label of variantLabels) {
        hlsFiles.push(`${label}/index.m3u8`, ...(await readdir(join(hlsDir, label))).filter((name) => name.endsWith(".ts")).map((name) => `${label}/${name}`));
      }
      for (let offset = 0; offset < hlsFiles.length; offset += 8) {
        await Promise.all(hlsFiles.slice(offset, offset + 8).map(async (name) => {
          const path = join(hlsDir, name);
          const isPlaylist = name.endsWith(".m3u8");
          const key = name === "master.m3u8" ? playlistKey : `${hlsPrefix}/${name}`;
          await this.spaces.uploadPrivateFile(key, path, (await stat(path)).size, isPlaylist ? "application/vnd.apple.mpegurl" : "video/mp2t", isPlaylist ? "private, max-age=0, no-store" : undefined);
        }));
      }
      await this.spaces.uploadPrivateFile(thumbnailKey, thumbPath, (await stat(thumbPath)).size, "image/jpeg");
      await records.updateOne({ _id: record._id, status: "processing" }, { $set: {
        status: "ready", seconds: Math.ceil(duration), mp4Key, hlsKey: playlistKey, thumbnailKey,
        processedSize: mp4Size, updatedAt: new Date(),
      }, $unset: { failureReason: "" } });
      await this.spaces.deleteObject(record.rawKey).catch((error) => this.logger.warn(`Processed recording ${recordingId}, but could not remove raw object: ${String(error)}`));
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : "تعذرت معالجة التسجيل.";
      await records.updateOne({ _id: record._id }, { $set: { status: finalAttempt ? "failed" : "processing", failureReason: reason, updatedAt: new Date() } });
      this.logger.error(`Recording ${recordingId} processing failed: ${reason}`);
      throw error;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
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
    const activeUpload = await db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION).findOne({ recordingId: String(current._id), state: "active" });
    if (activeUpload) {
      await this.spaces.abortMultipartUpload(activeUpload.key, activeUpload.uploadId).catch(() => undefined);
      await db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION).updateOne({ _id: activeUpload._id }, { $set: { state: "aborted" } });
    }
    if (current.fileId) await new GridFSBucket(db, { bucketName: HELPER_RECORDINGS_BUCKET }).delete(current.fileId).catch(() => undefined);
    for (const key of [current.rawKey, current.mp4Key, current.hlsKey, current.thumbnailKey]) if (key) await this.spaces.deleteObject(key).catch(() => undefined);
    if (current.hlsKey) await this.spaces.deletePrefix(current.hlsKey.substring(0, current.hlsKey.lastIndexOf("/")) + "/").catch(() => undefined);
    return { ok: true };
  }

  async streamFile(actor: HelperActor, id: string, range: string | undefined, res: Response, downloadName?: string) {
    const db = await this.db();
    const current = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    if (current.status === "uploading" || (current.status && current.status !== "ready" && !current.rawKey)) {
      throw new BadRequestException(current.failureReason || "التسجيل قيد المعالجة.");
    }
    if (!current.fileId) {
      const key = current.status === "ready" ? current.mp4Key || current.rawKey : current.rawKey;
      if (!key) throw new NotFoundException("ملف التسجيل غير موجود");
      const safeName = String(downloadName ?? "recording.mp4").replace(/[\\/\r\n\u0000-\u001f]/g, "_").trim().slice(0, 120) || "recording.mp4";
      const playbackTtl = downloadName ? 300 : Math.max(300, Math.min(7200, Number(process.env.RECORDING_PLAYBACK_URL_TTL_SECONDS) || 7200));
      res.redirect(302, await this.spaces.presignGet(key, playbackTtl, downloadName ? safeName : undefined));
      return;
    }
    const part = recordingRange(range, current.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", current.mime);
    const safeName = String(downloadName ?? "").replace(/[\\/\r\n\u0000-\u001f]/g, "_").trim().slice(0, 120);
    const filename = safeName || "recording.webm";
    res.setHeader("Content-Disposition", `${downloadName ? "attachment" : "inline"}; filename="recording.webm"; filename*=UTF-8''${encodeURIComponent(filename)}`);
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

  async downloadLink(actor: HelperActor, id: string, name: string) {
    const current = await (await this.db()).collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).findOne({ _id: parseObjectId(id) });
    if (!current || !helperCanAccess(current, actor)) throw new NotFoundException("التسجيل غير موجود");
    if (current.status === "uploading") throw new BadRequestException("التسجيل لا يزال قيد الرفع.");
    const safeName = String(name).replace(/[\\/\r\n\u0000-\u001f]/g, "_").trim().slice(0, 120) || "recording.webm";
    if (current.fileId) {
      return { url: `/api/helper-tools/recordings/${id}/file?download=${encodeURIComponent(safeName)}` };
    }
    const key = current.status === "ready" ? current.mp4Key || current.rawKey : current.rawKey;
    if (!key) throw new NotFoundException("ملف التسجيل غير موجود");
    return { url: await this.spaces.presignGet(key, 300, safeName) };
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
      const expiredMultipart = await db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION)
        .find({ state: "active", expiresAt: { $lt: new Date() } }).limit(100).toArray();
      for (const upload of expiredMultipart) {
        await this.spaces.abortMultipartUpload(upload.key, upload.uploadId).catch(() => undefined);
        await db.collection<HelperMultipartUpload>(HELPER_MULTIPART_UPLOADS_COLLECTION).updateOne({ _id: upload._id, state: "active" }, { $set: { state: "aborted" } });
        await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).deleteOne({ _id: new ObjectId(upload.recordingId), status: "uploading" });
      }
      const expired = await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).find({ expiresAt: { $lt: new Date() } }).limit(100).toArray();
      for (const upload of expired) {
        await db.collection<HelperRecordingUpload>(HELPER_UPLOADS_COLLECTION).deleteOne({ _id: upload._id });
        await rm(upload.path, { force: true }).catch(() => undefined);
      }
      const retentionDays = Math.floor(Number(process.env.RECORDING_RETENTION_DAYS) || 0);
      if (retentionDays > 0) {
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 3600_000);
        const oldRecords = await db.collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION).find({
          createdAt: { $lt: cutoffDate },
          $or: [{ status: { $in: ["ready", "failed"] } }, { status: { $exists: false } }],
        }).limit(100).toArray();
        for (const old of oldRecords) {
          if (old.fileId) await new GridFSBucket(db, { bucketName: HELPER_RECORDINGS_BUCKET }).delete(old.fileId).catch(() => undefined);
          for (const key of [old.rawKey, old.mp4Key, old.hlsKey, old.thumbnailKey]) if (key) await this.spaces.deleteObject(key).catch(() => undefined);
          if (old.hlsKey) await this.spaces.deletePrefix(old.hlsKey.substring(0, old.hlsKey.lastIndexOf("/")) + "/").catch(() => undefined);
          await db.collection(HELPER_RECORDINGS_COLLECTION).deleteOne({ _id: old._id });
        }
      }
    } catch {
      this.logger.warn("Helper recording upload cleanup will retry later");
    } finally {
      this.cleaning = false;
    }
  }
}
