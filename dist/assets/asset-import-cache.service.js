"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetImportCacheService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const IMPORT_CACHE_TTL_SECONDS = 30 * 60;
const IMPORT_CACHE_TTL_MS = IMPORT_CACHE_TTL_SECONDS * 1000;
let redisClient;
const memoryImportStore = new Map();
function isRedisCacheEnabled() {
    const value = process.env.ENABLE_REDIS_CACHE?.trim().toLowerCase();
    return value === "true" || value === "1" || value === "yes";
}
function getRedisClient() {
    if (redisClient !== undefined)
        return redisClient;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || !isRedisCacheEnabled()) {
        redisClient = null;
        return redisClient;
    }
    redisClient = new ioredis_1.default(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        retryStrategy: () => null,
    });
    redisClient.on("error", () => {
    });
    return redisClient;
}
function importCacheKey(importId) {
    return `sv:asset-import:${importId}`;
}
function readMemoryImport(importId) {
    const entry = memoryImportStore.get(importId);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        memoryImportStore.delete(importId);
        return null;
    }
    return entry.value;
}
function writeMemoryImport(result) {
    memoryImportStore.set(result.importId, {
        value: result,
        expiresAt: Date.now() + IMPORT_CACHE_TTL_MS,
    });
}
let AssetImportCacheService = class AssetImportCacheService {
    async setImportResult(result) {
        writeMemoryImport(result);
        const client = getRedisClient();
        if (!client)
            return;
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            await client.set(importCacheKey(result.importId), JSON.stringify(result), "EX", IMPORT_CACHE_TTL_SECONDS);
        }
        catch {
        }
    }
    async getImportResult(importId) {
        const cached = readMemoryImport(importId);
        if (cached)
            return cached;
        const client = getRedisClient();
        if (!client)
            return null;
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const raw = await client.get(importCacheKey(importId));
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            writeMemoryImport(parsed);
            return parsed;
        }
        catch {
            return null;
        }
    }
};
exports.AssetImportCacheService = AssetImportCacheService;
exports.AssetImportCacheService = AssetImportCacheService = __decorate([
    (0, common_1.Injectable)()
], AssetImportCacheService);
