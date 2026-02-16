"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerSourceIndexWarmup = triggerSourceIndexWarmup;
const mongodb_1 = require("mongodb");
const mongodb_2 = require("./mongodb");
const harajScrape_1 = require("./models/harajScrape");
const yallaMotor_1 = require("./models/yallaMotor");
const HARJ_INDEXES = [
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
const YALLA_INDEXES = [
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
async function createIndexesSafely(collection, specs) {
    for (const spec of specs) {
        try {
            await collection.createIndex(spec.key, { name: spec.name });
        }
        catch (error) {
            if (error instanceof mongodb_1.MongoServerError) {
                if (error.code === 85 || error.code === 86 || error.code === 11000) {
                    continue;
                }
            }
            throw error;
        }
    }
}
async function warmupSourceIndexes() {
    const db = await (0, mongodb_2.getMongoDb)();
    const haraj = (0, harajScrape_1.getHarajScrapeCollection)(db);
    const yallaLegacy = (0, yallaMotor_1.getYallaMotorCollection)(db);
    const yallaUsed = (0, yallaMotor_1.getYallaUsedCollection)(db);
    await Promise.all([
        createIndexesSafely(haraj, HARJ_INDEXES),
        createIndexesSafely(yallaLegacy, YALLA_INDEXES),
        createIndexesSafely(yallaUsed, YALLA_INDEXES),
    ]);
}
function triggerSourceIndexWarmup() {
    if (!shouldWarmupIndexes()) {
        return;
    }
    if (!global.sparkSourceIndexesWarmup) {
        global.sparkSourceIndexesWarmup = warmupSourceIndexes().catch((error) => {
            console.error("[source-indexes] Warmup failed", error);
        });
    }
}
