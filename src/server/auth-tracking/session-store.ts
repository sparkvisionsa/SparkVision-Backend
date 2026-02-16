import Redis from "ioredis";
import { authTrackingConfig } from "./config";
import { parseDateFromUnknown } from "./crypto";
import type { SessionDoc } from "./types";

let redisClient: Redis | null | undefined;
const memorySessionStore = new Map<string, { session: SessionDoc; expiresAt: number }>();

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
    // Redis is optional for this app; ignore connection errors and fallback to MongoDB.
  });
  return redisClient;
}

function sessionKey(sessionId: string) {
  return `sv:session:${sessionId}`;
}

function readMemorySession(sessionId: string) {
  const entry = memorySessionStore.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memorySessionStore.delete(sessionId);
    return null;
  }
  return entry.session;
}

function writeMemorySession(session: SessionDoc, ttlSeconds: number) {
  memorySessionStore.set(session._id, {
    session,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function hydrateSession(raw: Record<string, unknown>): SessionDoc {
  const session = raw as unknown as Partial<SessionDoc>;
  return {
    _id: String(session._id ?? ""),
    userId: session.userId ?? null,
    identityId: String(session.identityId ?? ""),
    fingerprintId: String(session.fingerprintId ?? ""),
    localBackupId: session.localBackupId ?? null,
    userAgent: String(session.userAgent ?? ""),
    device: session.device ?? {
      type: "unknown",
      os: "Unknown",
      browser: "Unknown",
    },
    geo: session.geo ?? {
      ipAddress: "0.0.0.0",
    },
    referrer: session.referrer ?? null,
    firstVisitAt: parseDateFromUnknown(session.firstVisitAt) ?? new Date(),
    startTime: parseDateFromUnknown(session.startTime) ?? new Date(),
    lastSeenAt: parseDateFromUnknown(session.lastSeenAt) ?? new Date(),
    endTime: parseDateFromUnknown(session.endTime),
    durationMs: Number(session.durationMs ?? 0),
    idleMs: Number(session.idleMs ?? 0),
    activeMs: Number(session.activeMs ?? 0),
    isActive: Boolean(session.isActive),
    isRemembered: Boolean(session.isRemembered),
    metadata: session.metadata ?? {},
  };
}

export async function readCachedSession(sessionId: string) {
  const memorySession = readMemorySession(sessionId);
  if (memorySession) {
    return memorySession;
  }

  const client = getRedisClient();
  if (!client) return null;
  try {
    if (client.status === "wait") await client.connect();
    const value = await client.get(sessionKey(sessionId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const session = hydrateSession(parsed);
    const ttlSeconds = authTrackingConfig.sessionTimeoutMinutes * 60;
    writeMemorySession(session, ttlSeconds);
    return session;
  } catch {
    return null;
  }
}

export async function writeCachedSession(session: SessionDoc, maxAgeSeconds?: number) {
  const ttlSeconds =
    maxAgeSeconds ?? authTrackingConfig.sessionTimeoutMinutes * 60;
  writeMemorySession(session, ttlSeconds);

  const client = getRedisClient();
  if (!client) return;
  try {
    if (client.status === "wait") await client.connect();
    await client.set(sessionKey(session._id), JSON.stringify(session), "EX", ttlSeconds);
  } catch {
    // Redis is optional. MongoDB remains the source of truth.
  }
}

export async function deleteCachedSession(sessionId: string) {
  memorySessionStore.delete(sessionId);

  const client = getRedisClient();
  if (!client) return;
  try {
    if (client.status === "wait") await client.connect();
    await client.del(sessionKey(sessionId));
  } catch {
    // ignore cache misses/failures
  }
}
