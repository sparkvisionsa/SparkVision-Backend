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
    const key = spec && typeof spec === "object" && "key" in spec ? spec.key : spec;
    const options = spec && typeof spec === "object" && "options" in spec ? spec.options : undefined;
    try {
      const name = await collection.createIndex(key, options);
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
    const carsHaraj = db.collection("CarsHaraj");
    const yallaLegacy = db.collection("yallamotortest");
    const yallaUsed = db.collection("YallaUsed");
    const yallaNewCars = db.collection("yallaMotorNewCars");
    const syarah = db.collection("syarah");

    await createIndexes(haraj, [
      { "item.tags.0": 1, "item.postDate": -1 },
      { "item.tags.1": 1, "item.postDate": -1 },
      { "item.tags.2": 1, "item.postDate": -1 },
      { "item.carInfo.model": 1 },
      { "item.city": 1 },
      { "item.geoCity": 1 },
      {
        key: {
          title: "text",
          "item.title": "text",
          "item.bodyTEXT": "text",
          tags: "text",
          "item.tags": "text",
          "gql.posts.json.data.posts.items.title": "text",
          "gql.posts.json.data.posts.items.bodyTEXT": "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            title: 12,
            "item.title": 12,
            tags: 10,
            "item.tags": 10,
            "gql.posts.json.data.posts.items.title": 8,
            "item.bodyTEXT": 4,
            "gql.posts.json.data.posts.items.bodyTEXT": 3,
          },
        },
      },
    ]);

    await createIndexes(carsHaraj, [
      { "item.tags.0": 1, "item.postDate": -1 },
      { "item.tags.1": 1, "item.postDate": -1 },
      { "item.tags.2": 1, "item.postDate": -1 },
      { "item.carInfo.model": 1 },
      { "item.city": 1 },
      { "item.geoCity": 1 },
      {
        key: {
          title: "text",
          "item.title": "text",
          "item.bodyTEXT": "text",
          tags: "text",
          "item.tags": "text",
          "gql.posts.json.data.posts.items.title": "text",
          "gql.posts.json.data.posts.items.bodyTEXT": "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            title: 12,
            "item.title": 12,
            tags: 10,
            "item.tags": 10,
            "gql.posts.json.data.posts.items.title": 8,
            "item.bodyTEXT": 4,
            "gql.posts.json.data.posts.items.bodyTEXT": 3,
          },
        },
      },
    ]);

    await createIndexes(yallaLegacy, [
      { fetchedAt: -1 },
      { detailScrapedAt: -1 },
      { adId: 1 },
      { url: 1 },
      { "detail.url": 1 },
      {
        key: {
          cardTitle: "text",
          title: "text",
          description: "text",
          location: "text",
          breadcrumbs: "text",
          "detail.breadcrumb": "text",
          "detail.overview.h1": "text",
          "detail.overview.h4": "text",
          "detail.description": "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            cardTitle: 12,
            title: 11,
            "detail.overview.h1": 10,
            breadcrumbs: 8,
            "detail.breadcrumb": 8,
            location: 6,
            description: 4,
            "detail.description": 4,
            "detail.overview.h4": 3,
          },
        },
      },
    ]);

    await createIndexes(yallaUsed, [
      { fetchedAt: -1 },
      { scrapedAt: -1 },
      { detailScrapedAt: -1 },
      { adId: 1 },
      { url: 1 },
      { "detail.url": 1 },
      {
        key: {
          cardTitle: "text",
          title: "text",
          description: "text",
          location: "text",
          breadcrumbs: "text",
          "detail.breadcrumb": "text",
          "detail.overview.h1": "text",
          "detail.overview.h4": "text",
          "detail.description": "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            cardTitle: 12,
            title: 11,
            "detail.overview.h1": 10,
            breadcrumbs: 8,
            "detail.breadcrumb": 8,
            location: 6,
            description: 4,
            "detail.description": 4,
            "detail.overview.h4": 3,
          },
        },
      },
    ]);

    await createIndexes(yallaNewCars, [
      { fetchedAt: -1 },
      { scrapedAt: -1 },
      { detailScrapedAt: -1 },
      { adId: 1 },
      { url: 1 },
      { "detail.url": 1 },
      {
        key: {
          cardTitle: "text",
          title: "text",
          description: "text",
          location: "text",
          breadcrumbs: "text",
          "detail.breadcrumb": "text",
          "detail.overview.h1": "text",
          "detail.overview.h4": "text",
          "detail.description": "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            cardTitle: 12,
            title: 11,
            "detail.overview.h1": 10,
            breadcrumbs: 8,
            "detail.breadcrumb": 8,
            location: 6,
            description: 4,
            "detail.description": 4,
            "detail.overview.h4": 3,
          },
        },
      },
    ]);

    await createIndexes(syarah, [
      { fetchedAt: -1 },
      { post_id: 1 },
      { id: 1 },
      { city: 1 },
      { brand: 1 },
      { model: 1 },
      { year: -1 },
      { mileage_km: 1 },
      { price_cash: -1 },
      {
        key: {
          title: "text",
          brand: "text",
          model: "text",
          trim: "text",
          city: "text",
          origin: "text",
          fuel_type: "text",
          transmission: "text",
          tags: "text",
        },
        options: {
          name: "smart_search_text",
          default_language: "none",
          weights: {
            title: 12,
            brand: 11,
            model: 11,
            trim: 8,
            tags: 7,
            city: 5,
            origin: 4,
            fuel_type: 3,
            transmission: 3,
          },
        },
      },
    ]);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
