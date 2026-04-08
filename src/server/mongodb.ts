import dns from "node:dns";
import { MongoClient } from "mongodb";

let mongoDnsConfigured = false;

/**
 * mongodb+srv:// يعتمد على استعلامات DNS من نوع SRV. على بعض الشبكات/ويندوز يفشل
 * querySrv بـ ECONNREFUSED. تعيين MONGO_DNS_SERVERS يوجّه الاستعلام لخوادم DNS عامة.
 */
function applyMongoDnsFromEnv(): void {
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

type MongoClientCache = {
  client: MongoClient | null;
  promise: Promise<MongoClient> | null;
};

declare global {
  // eslint-disable-next-line no-var
  var mongoScrapping: MongoClientCache | undefined;
}

const globalCache = global.mongoScrapping ?? { client: null, promise: null };

global.mongoScrapping = globalCache;

export async function getMongoClient(): Promise<MongoClient> {
  const mongoUrl = process.env.MONGO_URL_SCRAPPING;
  if (!mongoUrl) {
    throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
  }

  applyMongoDnsFromEnv();

  if (globalCache.client) {
    return globalCache.client;
  }

  if (!globalCache.promise) {
    globalCache.promise = new MongoClient(mongoUrl, {
      serverSelectionTimeoutMS: 30_000,
    }).connect();
  }

  globalCache.client = await globalCache.promise;
  return globalCache.client;
}

export async function getMongoDb() {
  const dbName = process.env.MONGO_DBNAME_SCRAPPING;
  if (!dbName) {
    throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
  }
  const client = await getMongoClient();
  return client.db(dbName);
}
