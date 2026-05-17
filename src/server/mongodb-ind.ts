import { MongoClient } from "mongodb";
import { applyMongoDnsFromEnv } from "./mongodb";

let indClient: MongoClient | null = null;
let indConnectPromise: Promise<MongoClient> | null = null;

async function connectMongoIndClient(): Promise<MongoClient> {
  applyMongoDnsFromEnv();
  const uri = process.env.MONGO_URL_IND?.trim();
  if (!uri) {
    throw new Error("Missing MONGO_URL_IND environment variable.");
  }

  if (indClient) {
    return indClient;
  }

  if (!indConnectPromise) {
    indConnectPromise = MongoClient.connect(uri, {
      serverSelectionTimeoutMS: 30_000,
    }).then((client) => {
      indClient = client;
      return client;
    });
  }

  return indConnectPromise;
}

/** قاعدة بيانات Atlas الهند — صفحة مصادر تقييم السيارات فقط. */
export async function getMongoIndDb(): Promise<import("mongodb").Db> {
  const dbName = process.env.MONGO_DBNAME_IND?.trim() || process.env.MONGO_DBNAME_SCRAPPING?.trim();
  if (!dbName) {
    throw new Error("Missing MONGO_DBNAME_IND (or MONGO_DBNAME_SCRAPPING) environment variable.");
  }

  const client = await connectMongoIndClient();
  return client.db(dbName);
}
