"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMongoClient = getMongoClient;
exports.getMongoDb = getMongoDb;
const node_dns_1 = __importDefault(require("node:dns"));
const mongodb_1 = require("mongodb");
let mongoDnsConfigured = false;
function applyMongoDnsFromEnv() {
    if (mongoDnsConfigured)
        return;
    mongoDnsConfigured = true;
    const raw = process.env.MONGO_DNS_SERVERS?.trim();
    if (raw) {
        const servers = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (servers.length > 0) {
            node_dns_1.default.setServers(servers);
        }
    }
    const v4First = process.env.MONGO_IPV4_FIRST;
    if (v4First === "1" || v4First === "true") {
        node_dns_1.default.setDefaultResultOrder("ipv4first");
    }
}
const globalCache = global.mongoScrapping ?? { client: null, promise: null };
global.mongoScrapping = globalCache;
async function getMongoClient() {
    const mongoUrl = process.env.MONGO_URL_SCRAPPING;
    if (!mongoUrl) {
        throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
    }
    applyMongoDnsFromEnv();
    if (globalCache.client) {
        return globalCache.client;
    }
    if (!globalCache.promise) {
        globalCache.promise = new mongodb_1.MongoClient(mongoUrl, {
            serverSelectionTimeoutMS: 30_000,
        }).connect();
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
