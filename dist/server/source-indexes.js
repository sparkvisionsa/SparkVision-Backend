"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerSourceIndexWarmup = triggerSourceIndexWarmup;
const mongodb_1 = require("mongodb");
const mongodb_2 = require("./mongodb");
const harajScrape_1 = require("./models/harajScrape");
const yallaMotor_1 = require("./models/yallaMotor");
const syarah_1 = require("./models/syarah");
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
    {
        name: "smart_search_text",
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
];
const YALLA_INDEXES = [
    { name: "fetchedAt_desc", key: { fetchedAt: -1 } },
    { name: "scrapedAt_desc", key: { scrapedAt: -1 } },
    { name: "detailScrapedAt_desc", key: { detailScrapedAt: -1 } },
    { name: "adId_asc", key: { adId: 1 } },
    { name: "url_asc", key: { url: 1 } },
    { name: "detail_url_asc", key: { "detail.url": 1 } },
    {
        name: "smart_search_text",
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
];
const SYARAH_INDEXES = [
    { name: "fetchedAt_desc", key: { fetchedAt: -1 } },
    { name: "post_id_asc", key: { post_id: 1 } },
    { name: "id_asc", key: { id: 1 } },
    { name: "city_asc", key: { city: 1 } },
    { name: "brand_asc", key: { brand: 1 } },
    { name: "model_asc", key: { model: 1 } },
    { name: "year_desc", key: { year: -1 } },
    { name: "mileage_km_asc", key: { mileage_km: 1 } },
    { name: "price_cash_desc", key: { price_cash: -1 } },
    {
        name: "smart_search_text",
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
];
function shouldWarmupIndexes() {
    const value = (process.env.SOURCE_INDEX_WARMUP ?? "true").trim().toLowerCase();
    return value !== "0" && value !== "false";
}
async function createIndexesSafely(collection, specs) {
    for (const spec of specs) {
        try {
            await collection.createIndex(spec.key, { name: spec.name, ...(spec.options ?? {}) });
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
    const harajPrimary = (0, harajScrape_1.getHarajScrapeCollection)(db);
    const harajCars = (0, harajScrape_1.getCarsHarajCollection)(db);
    const yallaLegacy = (0, yallaMotor_1.getYallaMotorCollection)(db);
    const yallaUsed = (0, yallaMotor_1.getYallaUsedCollection)(db);
    const yallaNewCars = (0, yallaMotor_1.getYallaNewCarsCollection)(db);
    const syarah = (0, syarah_1.getSyarahCollection)(db);
    await Promise.all([
        createIndexesSafely(harajPrimary, HARJ_INDEXES),
        createIndexesSafely(harajCars, HARJ_INDEXES),
        createIndexesSafely(yallaLegacy, YALLA_INDEXES),
        createIndexesSafely(yallaUsed, YALLA_INDEXES),
        createIndexesSafely(yallaNewCars, YALLA_INDEXES),
        createIndexesSafely(syarah, SYARAH_INDEXES),
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
