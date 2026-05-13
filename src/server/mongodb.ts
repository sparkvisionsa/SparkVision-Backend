import dns from "node:dns";
import mongoose from "mongoose";

let mongoDnsConfigured = false;

/**
 * mongodb+srv:// يعتمد على استعلامات DNS من نوع SRV. على بعض الشبكات/ويندوز يفشل
 * querySrv بـ ECONNREFUSED. تعيين MONGO_DNS_SERVERS يوجّه الاستعلام لخوادم DNS عامة.
 */
export function applyMongoDnsFromEnv(): void {
  if (mongoDnsConfigured) return;
  mongoDnsConfigured = true;

  const raw = process.env.MONGO_DNS_SERVERS?.trim();
  if (raw) {
    const servers = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (servers.length > 0) {
      dns.setServers(servers);
    }
  }

  const v4First = process.env.MONGO_IPV4_FIRST;
  if (v4First === "1" || v4First === "true") {
    dns.setDefaultResultOrder("ipv4first");
  }
}

/**
 * نفس اتصال Mongoose: وصول للـ driver الخام (GridFS، سكربتات، إلخ).
 * معرّف `_id` يُولَّد من Atlas/MongoDB تلقائيًا — لا يُمرَّر من التطبيق.
 */
/** يعيد نفس `Db` الذي يستخدمه Mongoose (متوافق مع حزمة mongodb في المشروع عبر التحويل). */
export async function getMongoDb(): Promise<import("mongodb").Db> {
  applyMongoDnsFromEnv();
  const uri = process.env.MONGO_URL_SCRAPPING;
  const dbName = process.env.MONGO_DBNAME_SCRAPPING;
  if (!uri) {
    throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
  }
  if (!dbName) {
    throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
  }

  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose.connection.db as unknown as import("mongodb").Db;
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 30_000,
    });
  } else {
    await mongoose.connection.asPromise();
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("MongoDB not connected");
  }
  return db as unknown as import("mongodb").Db;
}

export async function getMongoClient(): Promise<import("mongodb").MongoClient> {
  await getMongoDb();
  return mongoose.connection.getClient() as unknown as import("mongodb").MongoClient;
}
