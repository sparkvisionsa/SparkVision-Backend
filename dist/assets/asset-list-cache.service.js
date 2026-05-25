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
exports.AssetListCacheService = void 0;
const common_1 = require("@nestjs/common");
const ioredis_1 = __importDefault(require("ioredis"));
const LIST_CACHE_TTL_SECONDS = 5 * 60;
const LIST_CACHE_TTL_MS = LIST_CACHE_TTL_SECONDS * 1000;
let redisClient;
const memoryListStore = new Map();
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
function listCacheKey(projectId, keySuffix) {
    return `sv:assets:list:${projectId}:${keySuffix}`;
}
let AssetListCacheService = class AssetListCacheService {
    async get(projectId, keySuffix) {
        const key = listCacheKey(projectId, keySuffix);
        const memoryEntry = memoryListStore.get(key);
        if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
            return memoryEntry.value;
        }
        if (memoryEntry) {
            memoryListStore.delete(key);
        }
        const client = getRedisClient();
        if (!client)
            return null;
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const raw = await client.get(key);
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            memoryListStore.set(key, {
                value: parsed,
                expiresAt: Date.now() + LIST_CACHE_TTL_MS,
            });
            return parsed;
        }
        catch {
            return null;
        }
    }
    async set(projectId, keySuffix, value) {
        const key = listCacheKey(projectId, keySuffix);
        memoryListStore.set(key, {
            value,
            expiresAt: Date.now() + LIST_CACHE_TTL_MS,
        });
        const client = getRedisClient();
        if (!client)
            return;
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            await client.set(key, JSON.stringify(value), "EX", LIST_CACHE_TTL_SECONDS);
        }
        catch {
        }
    }
    async invalidateProject(projectId) {
        const prefix = `sv:assets:list:${projectId}:`;
        Array.from(memoryListStore.keys()).forEach((key) => {
            if (key.startsWith(prefix)) {
                memoryListStore.delete(key);
            }
        });
        const client = getRedisClient();
        if (!client)
            return;
        try {
            if (client.status === "wait") {
                await client.connect();
            }
            const keys = await client.keys(`${prefix}*`);
            if (keys.length > 0) {
                await client.del(...keys);
            }
        }
        catch {
        }
    }
};
exports.AssetListCacheService = AssetListCacheService;
exports.AssetListCacheService = AssetListCacheService = __decorate([
    (0, common_1.Injectable)()
], AssetListCacheService);
