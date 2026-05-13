import { Injectable } from "@nestjs/common";
import Redis from "ioredis";

const LIST_CACHE_TTL_SECONDS = 5 * 60;
const LIST_CACHE_TTL_MS = LIST_CACHE_TTL_SECONDS * 1000;

let redisClient: Redis | null | undefined;
const memoryListStore = new Map<
  string,
  {
    value: unknown;
    expiresAt: number;
  }
>();

function isRedisCacheEnabled() {
  const value = process.env.ENABLE_REDIS_CACHE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function getRedisClient() {
  if (redisClient !== undefined) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || !isRedisCacheEnabled()) {
    redisClient = null;
    return redisClient;
  }

  redisClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: () => null,
  });
  redisClient.on("error", () => {
    // Redis is optional for asset list caching.
  });
  return redisClient;
}

function listCacheKey(projectId: string, keySuffix: string) {
  return `sv:assets:list:${projectId}:${keySuffix}`;
}

@Injectable()
export class AssetListCacheService {
  async get<T>(projectId: string, keySuffix: string): Promise<T | null> {
    const key = listCacheKey(projectId, keySuffix);
    const memoryEntry = memoryListStore.get(key);
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
      return memoryEntry.value as T;
    }
    if (memoryEntry) {
      memoryListStore.delete(key);
    }

    const client = getRedisClient();
    if (!client) return null;

    try {
      if (client.status === "wait") {
        await client.connect();
      }
      const raw = await client.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as T;
      memoryListStore.set(key, {
        value: parsed,
        expiresAt: Date.now() + LIST_CACHE_TTL_MS,
      });
      return parsed;
    } catch {
      return null;
    }
  }

  async set<T>(projectId: string, keySuffix: string, value: T) {
    const key = listCacheKey(projectId, keySuffix);
    memoryListStore.set(key, {
      value,
      expiresAt: Date.now() + LIST_CACHE_TTL_MS,
    });

    const client = getRedisClient();
    if (!client) return;

    try {
      if (client.status === "wait") {
        await client.connect();
      }
      await client.set(key, JSON.stringify(value), "EX", LIST_CACHE_TTL_SECONDS);
    } catch {
      // Ignore Redis cache failures.
    }
  }

  async invalidateProject(projectId: string) {
    const prefix = `sv:assets:list:${projectId}:`;
    Array.from(memoryListStore.keys()).forEach((key) => {
      if (key.startsWith(prefix)) {
        memoryListStore.delete(key);
      }
    });

    const client = getRedisClient();
    if (!client) return;

    try {
      if (client.status === "wait") {
        await client.connect();
      }
      const keys = await client.keys(`${prefix}*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch {
      // Ignore Redis cache failures.
    }
  }
}
