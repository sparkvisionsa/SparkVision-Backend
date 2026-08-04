"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMongoDnsFromEnv = applyMongoDnsFromEnv;
exports.getMongoDb = getMongoDb;
exports.getMongoClient = getMongoClient;
const node_dns_1 = __importDefault(require("node:dns"));
const mongoose_1 = __importDefault(require("mongoose"));
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
async function getMongoDb() {
    applyMongoDnsFromEnv();
    const uri = process.env.MONGO_URL_SCRAPPING;
    const dbName = process.env.MONGO_DBNAME_SCRAPPING;
    if (!uri) {
        throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
    }
    if (!dbName) {
        throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
    }
    if (mongoose_1.default.connection.readyState === 1 && mongoose_1.default.connection.db) {
        return mongoose_1.default.connection.db;
    }
    if (mongoose_1.default.connection.readyState === 0) {
        await mongoose_1.default.connect(uri, {
            dbName,
            serverSelectionTimeoutMS: 30_000,
        });
    }
    else {
        await mongoose_1.default.connection.asPromise();
    }
    const db = mongoose_1.default.connection.db;
    if (!db) {
        throw new Error("MongoDB not connected");
    }
    return db;
}
async function getMongoClient() {
    await getMongoDb();
    return mongoose_1.default.connection.getClient();
}
