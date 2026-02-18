import { MongoServerError } from "mongodb";
import { getMongoDb } from "./mongodb";
import { getCarsHarajCollection, getHarajScrapeCollection } from "./models/harajScrape";
import {
  getYallaNewCarsCollection,
  getYallaMotorCollection,
  getYallaUsedCollection,
} from "./models/yallaMotor";
import { getSyarahCollection } from "./models/syarah";

type IndexDirection = 1 | -1;
type IndexSpec = {
  key: Record<string, IndexDirection>;
  name: string;
};
type IndexableCollection = {
  createIndex: (
    indexSpec: Record<string, IndexDirection>,
    options?: { name?: string }
  ) => Promise<string>;
};

declare global {
  // eslint-disable-next-line no-var
  var sparkSourceIndexesWarmup: Promise<void> | undefined;
}

const HARJ_INDEXES: IndexSpec[] = [
  { name: "postDate_desc", key: { postDate: -1 } },
  { name: "item_postDate_desc", key: { "item.postDate": -1 } },
  { name: "item_tag0_postDate_desc", key: { "item.tags.0": 1, "item.postDate": -1 } },
  { name: "item_tag1_postDate_desc", key: { "item.tags.1": 1, "item.postDate": -1 } },
  { name: "item_tag2_postDate_desc", key: { "item.tags.2": 1, "item.postDate": -1 } },
  { name: "city_asc", key: { city: 1 } },
  { name: "item_city_asc", key: { "item.city": 1 } },
  { name: "item_geoCity_asc", key: { "item.geoCity": 1 } },
  { name: "priceNumeric_desc", key: { priceNumeric: -1 } },
  { name: "commentsCount_desc", key: { commentsCount: -1 } },
  { name: "postId_asc", key: { postId: 1 } },
];

const YALLA_INDEXES: IndexSpec[] = [
  { name: "fetchedAt_desc", key: { fetchedAt: -1 } },
  { name: "scrapedAt_desc", key: { scrapedAt: -1 } },
  { name: "detailScrapedAt_desc", key: { detailScrapedAt: -1 } },
  { name: "adId_asc", key: { adId: 1 } },
  { name: "url_asc", key: { url: 1 } },
  { name: "detail_url_asc", key: { "detail.url": 1 } },
];

const SYARAH_INDEXES: IndexSpec[] = [
  { name: "fetchedAt_desc", key: { fetchedAt: -1 } },
  { name: "post_id_asc", key: { post_id: 1 } },
  { name: "id_asc", key: { id: 1 } },
  { name: "city_asc", key: { city: 1 } },
  { name: "brand_asc", key: { brand: 1 } },
  { name: "model_asc", key: { model: 1 } },
  { name: "year_desc", key: { year: -1 } },
  { name: "mileage_km_asc", key: { mileage_km: 1 } },
  { name: "price_cash_desc", key: { price_cash: -1 } },
];

function shouldWarmupIndexes() {
  const value = (process.env.SOURCE_INDEX_WARMUP ?? "true").trim().toLowerCase();
  return value !== "0" && value !== "false";
}

async function createIndexesSafely(collection: IndexableCollection, specs: IndexSpec[]) {
  for (const spec of specs) {
    try {
      await collection.createIndex(spec.key, { name: spec.name });
    } catch (error) {
      if (error instanceof MongoServerError) {
        // Index conflicts (already exists with another shape/options) should not block startup.
        if (error.code === 85 || error.code === 86 || error.code === 11000) {
          continue;
        }
      }
      throw error;
    }
  }
}

async function warmupSourceIndexes() {
  const db = await getMongoDb();
  const harajPrimary = getHarajScrapeCollection(db);
  const harajCars = getCarsHarajCollection(db);
  const yallaLegacy = getYallaMotorCollection(db);
  const yallaUsed = getYallaUsedCollection(db);
  const yallaNewCars = getYallaNewCarsCollection(db);
  const syarah = getSyarahCollection(db);

  await Promise.all([
    createIndexesSafely(harajPrimary, HARJ_INDEXES),
    createIndexesSafely(harajCars, HARJ_INDEXES),
    createIndexesSafely(yallaLegacy, YALLA_INDEXES),
    createIndexesSafely(yallaUsed, YALLA_INDEXES),
    createIndexesSafely(yallaNewCars, YALLA_INDEXES),
    createIndexesSafely(syarah, SYARAH_INDEXES),
  ]);
}

export function triggerSourceIndexWarmup() {
  if (!shouldWarmupIndexes()) {
    return;
  }
  if (!global.sparkSourceIndexesWarmup) {
    global.sparkSourceIndexesWarmup = warmupSourceIndexes().catch((error) => {
      console.error("[source-indexes] Warmup failed", error);
    });
  }
}
