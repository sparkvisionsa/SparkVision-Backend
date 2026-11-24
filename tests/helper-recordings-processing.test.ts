import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NotFoundException } from "@nestjs/common";
import { UnrecoverableError } from "bullmq";
import { getMongoDb } from "@/server/mongodb";
import { HelperToolsRecordingsService } from "@/helper-tools/helper-tools-recordings.service";
import { HELPER_RECORDINGS_COLLECTION, type HelperActor, type HelperRecordingDoc } from "@/helper-tools/helper-tools.types";

// The real pipeline runs here against an in-memory bucket, so FFmpeg is required.
// Point FFMPEG_PATH / FFPROBE_PATH at the binaries when they are not on PATH.
const configuredFfmpeg = process.env.FFMPEG_PATH?.trim();
const ffmpeg = configuredFfmpeg && existsSync(configuredFfmpeg) ? configuredFfmpeg : "ffmpeg";
const ffmpegReady = (() => {
  try { execFileSync(ffmpeg, ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

function missing(name = "NoSuchKey") {
  // Spaces answers with an empty <Message/>, which the SDK surfaces as "UnknownError".
  return Object.assign(new Error("UnknownError"), { name, $metadata: { httpStatusCode: 404 } });
}

class FakeSpaces {
  objects = new Map<string, Buffer>();
  uploads: string[] = [];
  beforeUpload?: (key: string) => Promise<void> | void;
  isReady() { return true; }
  recordingBasePrefix(id: string) { return `helper-recordings/${id}/`; }
  buildRecordingKey(id: string, name: string, variant = "raw") { return `helper-recordings/${id}/${variant}/${name}`; }
  async getObjectStream(key: string) {
    const body = this.objects.get(key);
    if (!body) throw missing();
    return { stream: Readable.from([body]) };
  }
  async uploadPrivateFile(key: string, path: string) {
    await this.beforeUpload?.(key);
    this.objects.set(key, await readFile(path));
    this.uploads.push(key);
  }
  async headObject(key: string) {
    const body = this.objects.get(key);
    if (!body) throw missing("NotFound");
    return { size: body.length, contentType: "application/octet-stream" };
  }
  async deleteObject(key: string) { this.objects.delete(key); }
  async deletePrefix(prefix: string, keepPrefix?: string) {
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix) && !(keepPrefix && key.startsWith(keepPrefix))) this.objects.delete(key);
    }
  }
  async presignGet(key: string, _ttl?: number, name?: string) {
    return `https://signed.test/${key}${name ? `?name=${encodeURIComponent(name)}` : ""}`;
  }
  keysUnder(prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort(); }
}

const actor: HelperActor = { kind: "user", userId: "user-a", companyId: "company-a", sessionId: "session-a", displayName: "User", identityId: "identity-a" };
let mongo: MongoMemoryServer;
let workDir = "";
let sample: Buffer = Buffer.from("source");
let spaces: FakeSpaces;
let service: HelperToolsRecordingsService;

async function records() {
  return (await getMongoDb()).collection<HelperRecordingDoc>(HELPER_RECORDINGS_COLLECTION);
}

async function seed(overrides: Partial<HelperRecordingDoc> = {}, withSource = true) {
  const _id = new ObjectId();
  const rawKey = spaces.buildRecordingKey(String(_id), "screen-recording.webm");
  if (withSource) spaces.objects.set(rawKey, sample);
  const now = new Date();
  await (await records()).insertOne({
    _id, ownerKind: "user", ownerLabel: "User", userId: actor.userId, companyId: actor.companyId, sessionId: actor.sessionId,
    identityId: actor.identityId, source: "any", seconds: 2, description: "demo", mime: "video/webm", size: sample.length,
    rawKey, status: "processing", createdAt: now, updatedAt: now, ...overrides,
  });
  return { id: String(_id), _id, rawKey, prefix: spaces.recordingBasePrefix(String(_id)) };
}

async function assertPublished(_id: ObjectId, prefix: string) {
  const doc = await (await records()).findOne({ _id });
  assert.equal(doc?.status, "ready");
  assert.equal(doc?.processingLease, undefined);
  for (const key of [doc?.mp4Key, doc?.hlsKey, doc?.thumbnailKey]) {
    assert.ok(key && key.startsWith(`${prefix}run-`) && spaces.objects.has(key), `published file is stored: ${key}`);
  }
  assert.ok(spaces.keysUnder(doc!.hlsKey!.replace(/master\.m3u8$/, "720p/")).some((key) => key.endsWith(".ts")), "HLS segments are stored");
  return doc!;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "helper-recordings-test";
  if (!ffmpegReady) return;
  workDir = await mkdtemp(join(tmpdir(), "spark-recording-test-"));
  const samplePath = join(workDir, "sample.webm");
  execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10", "-c:v", "libvpx", "-b:v", "200k", samplePath], { stdio: "ignore" });
  sample = await readFile(samplePath);
});

beforeEach(() => {
  spaces = new FakeSpaces();
  service = new HelperToolsRecordingsService(spaces as never);
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

test("a successful run publishes verified outputs and only then removes the source", { skip: !ffmpegReady }, async () => {
  const { id, _id, rawKey, prefix } = await seed();
  // Leftovers of an earlier, unfinished attempt must not survive a success either.
  spaces.objects.set(`${prefix}processed/video.mp4`, Buffer.from("stale"));
  await service.processRecording(id);
  const doc = await assertPublished(_id, prefix);
  assert.equal(spaces.objects.has(rawKey), false, "source is removed after the outputs are committed");
  assert.deepEqual(spaces.keysUnder(prefix).filter((key) => !key.startsWith(doc.mp4Key!.replace(/video\.mp4$/, ""))), []);
});

test("overlapping runs for one recording: one processes it, the other leaves it alone", { skip: !ffmpegReady }, async () => {
  const { id, _id, prefix } = await seed();
  await Promise.all([service.processRecording(id), service.processRecording(id)]);
  await assertPublished(_id, prefix);
  assert.equal(spaces.uploads.filter((key) => key.endsWith("video.mp4")).length, 1, "the video was produced once");
});

test("a failed attempt keeps the source and removes only its own partial outputs; the retry succeeds", { skip: !ffmpegReady }, async () => {
  const { id, _id, rawKey, prefix } = await seed();
  spaces.beforeUpload = (key) => {
    if (key.endsWith("thumbnail.jpg")) throw Object.assign(new Error("Forbidden"), { $metadata: { httpStatusCode: 403 } });
  };
  await assert.rejects(service.processRecording(id, false), /Forbidden/);
  const failed = await (await records()).findOne({ _id });
  assert.equal(failed?.status, "processing");
  assert.equal(failed?.failureReason, "Forbidden");
  assert.equal(failed?.processingLease, undefined, "the claim is released for the retry");
  assert.deepEqual(spaces.keysUnder(prefix), [rawKey], "only the source is left in storage");
  spaces.beforeUpload = undefined;
  await service.processRecording(id, true);
  await assertPublished(_id, prefix);
});

test("a run that lost its claim cannot overwrite or delete what the newer run published", { skip: !ffmpegReady }, async () => {
  const { id, _id, prefix } = await seed();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reachedUpload!: () => void;
  const stalled = new Promise<void>((resolve) => { reachedUpload = resolve; });
  let first = true;
  spaces.beforeUpload = async (key) => {
    if (first && key.endsWith("video.mp4")) { first = false; reachedUpload(); await gate; }
  };
  const stale = service.processRecording(id);
  await stalled;
  // The first run hangs past its lease (for example the machine slept); a second run takes over.
  await (await records()).updateOne({ _id }, { $set: { processingLeaseExpiresAt: new Date(0) } });
  await service.processRecording(id);
  const published = await assertPublished(_id, prefix);
  release();
  await stale;
  const afterStale = await assertPublished(_id, prefix);
  assert.equal(afterStale.mp4Key, published.mp4Key, "the record still points at the newer run");
  assert.deepEqual(spaces.keysUnder(prefix).filter((key) => !key.startsWith(published.mp4Key!.replace(/video\.mp4$/, ""))), [], "the stale run cleaned up after itself");
});

test("a duplicate job or a late failure never touches a ready recording", { skip: !ffmpegReady }, async () => {
  const { id, _id, prefix } = await seed();
  await service.processRecording(id);
  const ready = await assertPublished(_id, prefix);
  const stored = spaces.keysUnder(prefix);
  await service.processRecording(id);
  await service.processRecording(id, true);
  assert.deepEqual(spaces.keysUnder(prefix), stored);
  assert.deepEqual(await (await records()).findOne({ _id }), ready);
});

test("a missing source fails for good with a readable reason and deletes nothing", async () => {
  const { id, _id, prefix } = await seed({}, false);
  // What the previous implementation wiped before it noticed the source was gone.
  spaces.objects.set(`${prefix}processed/video.mp4`, Buffer.from("video"));
  spaces.objects.set(`${prefix}hls/master.m3u8`, Buffer.from("#EXTM3U"));
  await assert.rejects(service.processRecording(id, false), UnrecoverableError);
  const doc = await (await records()).findOne({ _id });
  assert.equal(doc?.status, "failed");
  assert.match(doc?.failureReason ?? "", /غير موجود في التخزين/);
  assert.deepEqual(spaces.keysUnder(prefix), [`${prefix}hls/master.m3u8`, `${prefix}processed/video.mp4`]);
});

test("playback and download links are issued only for files that exist", async () => {
  const gone = await seed({ status: "failed", mp4Key: "helper-recordings/x/processed/video.mp4", hlsKey: "helper-recordings/x/hls/master.m3u8" }, false);
  await assert.rejects(service.downloadLink(actor, gone.id, "demo.mp4"), NotFoundException);
  await assert.rejects(service.streamFile(actor, gone.id, undefined, {} as never), NotFoundException);

  const ready = await seed({ status: "ready" }, false);
  const mp4Key = `${ready.prefix}run-1/video.mp4`;
  await (await records()).updateOne({ _id: ready._id }, { $set: { mp4Key } });
  spaces.objects.set(mp4Key, Buffer.from("video"));
  assert.equal((await service.downloadLink(actor, ready.id, "demo.mp4")).url, `https://signed.test/${mp4Key}?name=demo.mp4`);

  // The processed file is gone but the upload survived: serve it under its real extension.
  const fallback = await seed({ status: "ready", mp4Key: "helper-recordings/y/processed/video.mp4" });
  assert.equal((await service.downloadLink(actor, fallback.id, "demo.mp4")).url, `https://signed.test/${fallback.rawKey}?name=demo.webm`);
  let redirected = "";
  await service.streamFile(actor, fallback.id, undefined, { redirect: (_status: number, url: string) => { redirected = url; } } as never);
  assert.equal(redirected, `https://signed.test/${fallback.rawKey}`);
});
