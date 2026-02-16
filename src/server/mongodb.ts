import { MongoClient } from "mongodb";

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

  if (globalCache.client) {
    return globalCache.client;
  }

  if (!globalCache.promise) {
    globalCache.promise = new MongoClient(mongoUrl).connect();
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
