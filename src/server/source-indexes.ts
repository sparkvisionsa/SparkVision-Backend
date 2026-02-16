import { MongoServerError } from "mongodb";
import { getMongoDb } from "./mongodb";
import { getHarajScrapeCollection } from "./models/harajScrape";
import {
  getYallaMotorCollection,
  getYallaUsedCollection,
} from "./models/yallaMotor";

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
  const haraj = getHarajScrapeCollection(db);
  const yallaLegacy = getYallaMotorCollection(db);
  const yallaUsed = getYallaUsedCollection(db);

  await Promise.all([
    createIndexesSafely(haraj, HARJ_INDEXES),
    createIndexesSafely(yallaLegacy, YALLA_INDEXES),
    createIndexesSafely(yallaUsed, YALLA_INDEXES),
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
