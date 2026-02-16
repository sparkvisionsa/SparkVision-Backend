import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const mongoUrl = process.env.MONGO_URL_SCRAPPING;
const dbName = process.env.MONGO_DBNAME_SCRAPPING;

if (!mongoUrl || !dbName) {
  throw new Error("Missing MONGO_URL_SCRAPPING or MONGO_DBNAME_SCRAPPING in environment.");
}

async function createIndexes(collection, specs) {
  for (const spec of specs) {
    try {
      const name = await collection.createIndex(spec);
      console.log(`[ok] ${collection.collectionName} -> ${name}`);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === 85 || code === 86) {
        console.log(`[skip] ${collection.collectionName} -> conflict/already exists`);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  const client = await new MongoClient(mongoUrl).connect();
  try {
    const db = client.db(dbName);

    const haraj = db.collection("harajScrape");
    const yallaLegacy = db.collection("yallamotortest");
    const yallaUsed = db.collection("YallaUsed");

    await createIndexes(haraj, [
      { "item.tags.0": 1, "item.postDate": -1 },
      { "item.tags.1": 1, "item.postDate": -1 },
      { "item.tags.2": 1, "item.postDate": -1 },
      { "item.carInfo.model": 1 },
      { "item.city": 1 },
      { "item.geoCity": 1 },
    ]);

    await createIndexes(yallaLegacy, [
      { fetchedAt: -1 },
      { detailScrapedAt: -1 },
      { adId: 1 },
      { url: 1 },
      { "detail.url": 1 },
    ]);

    await createIndexes(yallaUsed, [
      { fetchedAt: -1 },
      { scrapedAt: -1 },
      { detailScrapedAt: -1 },
      { adId: 1 },
      { url: 1 },
      { "detail.url": 1 },
    ]);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
