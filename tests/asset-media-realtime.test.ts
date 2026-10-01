import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { io } from "socket.io-client";
import { RealtimeService } from "../src/realtime/realtime.service";
import { AssetMediaRealtimeService, assetMediaRevision } from "../src/machine-valuation/asset-media-realtime";
import { mongoAssetPhotos } from "../src/machine-valuation/asset-upload-idempotency";
import { getMongoDb } from "../src/server/mongodb";

test("direct nested asset writes reach Socket.IO, respect company rooms and change revisions without updatedAt", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const previous = [process.env.MONGO_URL_SCRAPPING, process.env.MONGO_DBNAME_SCRAPPING];
  process.env.MONGO_URL_SCRAPPING = mongo.getUri(); process.env.MONGO_DBNAME_SCRAPPING = "asset_media_realtime_test";
  const http = createServer();
  const realtime = new RealtimeService({ resolve: async (req: any) => ({ userId: "owner", companyId: req.headers["x-test-company"], staff: false, superAdmin: false, sessionId: "test" }) } as any);
  const watcher = new AssetMediaRealtimeService(realtime);
  const clients: ReturnType<typeof io>[] = [];
  try {
    const db = await getMongoDb(), pid = new ObjectId(), aid = new ObjectId();
    await db.collection("mv_projects").insertOne({ _id: pid, companyId: "company-a", userId: "owner" });
    const timestamp = new Date("2026-01-01");
    await db.collection("assets").insertOne({ _id: aid, projectId: pid, isAssetFolder: true, images: {}, updatedAt: timestamp });
    realtime.attach(http);
    await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
    for (const company of ["company-a", "company-b"]) {
      const client = io(`http://127.0.0.1:${(http.address() as any).port}`, { path: "/api/realtime/socket.io", addTrailingSlash: false, transports: ["polling"], extraHeaders: { "x-test-company": company } });
      clients.push(client);
      await new Promise<void>((resolve, reject) => { client.once("connect", () => resolve()); client.once("connect_error", reject); });
    }
    const otherEvents: unknown[] = []; clients[1].on("resource:changed", event => otherEvents.push(event));
    await watcher.start();
    const readyUntil = Date.now() + 10_000;
    while (!(watcher as any).stream.resumeToken && Date.now() < readyUntil) await new Promise(resolve => setTimeout(resolve, 25));
    assert.ok((watcher as any).stream.resumeToken, "change stream is ready before external writes");
    let revision = await assetMediaRevision(db, pid);
    const changed = () => new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { clients[0].off("resource:changed", listener); reject(new Error("No socket update for direct database write")); }, 7000);
      const listener = (event: any) => { if (event.resource === "assets") { clearTimeout(timer); clients[0].off("resource:changed", listener); resolve(event); } };
      clients[0].on("resource:changed", listener);
    });
    for (const category of ["main", "other", "details", "brand", "futureCategory"]) {
      const event = changed();
      const image = { url: `https://images.example/${category}.png` };
      await db.collection("assets").updateOne({ _id: aid }, { $set: { [`images.${category}`]: category === "other" ? [image] : image } });
      assert.equal((await event).projectId, pid.toString());
      const next = await assetMediaRevision(db, pid);
      assert.notEqual(next, revision); revision = next;
      assert.deepEqual((await db.collection("assets").findOne({ _id: aid }))!.updatedAt, timestamp);
    }
    assert.equal(otherEvents.length, 0, "project identifiers stay in the authorized company room");
    const photos = await db.collection("assets").aggregate([{ $match: { _id: aid } }, { $project: { images: mongoAssetPhotos() } }]).next();
    assert.equal(photos!.images.length, 5, "every category participates in folder photo counts");
    const replacementEvent = changed();
    await db.collection("assets").updateOne({ _id: aid }, { $set: { "images.brand.url": "https://images.example/replaced.png" } });
    await replacementEvent;
    assert.notEqual(await assetMediaRevision(db, pid), revision, "same-count replacements invalidate the cards");
    const removeEvent = changed();
    await db.collection("assets").updateOne({ _id: aid }, { $set: { images: { main: null, other: [], details: null, brand: null } } });
    await removeEvent;
    const empty = await db.collection("assets").aggregate([{ $match: { _id: aid } }, { $project: { images: mongoAssetPhotos() } }]).next();
    assert.equal(empty!.images.length, 0);
  } finally {
    await watcher.onModuleDestroy(); clients.forEach(client => client.disconnect()); realtime.onModuleDestroy();
    if (http.listening) await new Promise<void>(resolve => http.close(() => resolve()));
    await mongoose.disconnect(); await mongo.stop();
    for (const [index, key] of ["MONGO_URL_SCRAPPING", "MONGO_DBNAME_SCRAPPING"].entries()) {
      if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index];
    }
  }
});
