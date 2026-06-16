"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMongoIndDb = getMongoIndDb;
const mongodb_1 = require("mongodb");
const mongodb_2 = require("./mongodb");
let indClient = null;
let indConnectPromise = null;
async function connectMongoIndClient() {
    (0, mongodb_2.applyMongoDnsFromEnv)();
    const uri = process.env.MONGO_URL_IND?.trim();
    if (!uri) {
        throw new Error("Missing MONGO_URL_IND environment variable.");
    }
    if (indClient) {
        return indClient;
    }
    if (!indConnectPromise) {
        indConnectPromise = mongodb_1.MongoClient.connect(uri, {
            serverSelectionTimeoutMS: 30_000,
        }).then((client) => {
            indClient = client;
            return client;
        });
    }
    return indConnectPromise;
}
async function getMongoIndDb() {
    const dbName = process.env.MONGO_DBNAME_IND?.trim() || process.env.MONGO_DBNAME_SCRAPPING?.trim();
    if (!dbName) {
        throw new Error("Missing MONGO_DBNAME_IND (or MONGO_DBNAME_SCRAPPING) environment variable.");
    }
    const client = await connectMongoIndClient();
    return client.db(dbName);
}
