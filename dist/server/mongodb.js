"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMongoClient = getMongoClient;
exports.getMongoDb = getMongoDb;
const mongodb_1 = require("mongodb");
const globalCache = global.mongoScrapping ?? { client: null, promise: null };
global.mongoScrapping = globalCache;
async function getMongoClient() {
    const mongoUrl = process.env.MONGO_URL_SCRAPPING;
    if (!mongoUrl) {
        throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
    }
    if (globalCache.client) {
        return globalCache.client;
    }
    if (!globalCache.promise) {
        globalCache.promise = new mongodb_1.MongoClient(mongoUrl).connect();
    }
    globalCache.client = await globalCache.promise;
    return globalCache.client;
}
async function getMongoDb() {
    const dbName = process.env.MONGO_DBNAME_SCRAPPING;
    if (!dbName) {
        throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
    }
    const client = await getMongoClient();
    return client.db(dbName);
}
