import { Injectable } from "@nestjs/common";
import Redis from "ioredis";
import type { AssetImportResult } from "./types";

const IMPORT_CACHE_TTL_SECONDS = 30 * 60;
const IMPORT_CACHE_TTL_MS = IMPORT_CACHE_TTL_SECONDS * 1000;

let redisClient: Redis | null | undefined;
const memoryImportStore = new Map<
  string,
  {
    value: AssetImportResult;
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
    // Redis is optional for this import flow.
  });
  return redisClient;
}

function importCacheKey(importId: string) {
  return `sv:asset-import:${importId}`;
}

function readMemoryImport(importId: string) {
  const entry = memoryImportStore.get(importId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryImportStore.delete(importId);
    return null;
  }
  return entry.value;
}

function writeMemoryImport(result: AssetImportResult) {
  memoryImportStore.set(result.importId, {
    value: result,
    expiresAt: Date.now() + IMPORT_CACHE_TTL_MS,
  });
}

@Injectable()
export class AssetImportCacheService {
  async setImportResult(result: AssetImportResult) {
    writeMemoryImport(result);

    const client = getRedisClient();
    if (!client) return;

    try {
      if (client.status === "wait") {
        await client.connect();
      }
      await client.set(
        importCacheKey(result.importId),
        JSON.stringify(result),
        "EX",
        IMPORT_CACHE_TTL_SECONDS,
      );
    } catch {
      // Keep the in-memory fallback only.
    }
  }

  async getImportResult(importId: string): Promise<AssetImportResult | null> {
    const cached = readMemoryImport(importId);
    if (cached) return cached;

    const client = getRedisClient();
    if (!client) return null;

    try {
      if (client.status === "wait") {
        await client.connect();
      }
      const raw = await client.get(importCacheKey(importId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AssetImportResult;
      writeMemoryImport(parsed);
      return parsed;
    } catch {
      return null;
    }
  }
}
