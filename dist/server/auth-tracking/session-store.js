"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readCachedSession = readCachedSession;
exports.writeCachedSession = writeCachedSession;
exports.deleteCachedSession = deleteCachedSession;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("./config");
const crypto_1 = require("./crypto");
let redisClient;
const memorySessionStore = new Map();
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
function sessionKey(sessionId) {
    return `sv:session:${sessionId}`;
}
function readMemorySession(sessionId) {
    const entry = memorySessionStore.get(sessionId);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        memorySessionStore.delete(sessionId);
        return null;
    }
    return entry.session;
}
function writeMemorySession(session, ttlSeconds) {
    memorySessionStore.set(session._id, {
        session,
        expiresAt: Date.now() + ttlSeconds * 1000,
    });
}
function hydrateSession(raw) {
    const session = raw;
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
        firstVisitAt: (0, crypto_1.parseDateFromUnknown)(session.firstVisitAt) ?? new Date(),
        startTime: (0, crypto_1.parseDateFromUnknown)(session.startTime) ?? new Date(),
        lastSeenAt: (0, crypto_1.parseDateFromUnknown)(session.lastSeenAt) ?? new Date(),
        endTime: (0, crypto_1.parseDateFromUnknown)(session.endTime),
        durationMs: Number(session.durationMs ?? 0),
        idleMs: Number(session.idleMs ?? 0),
        activeMs: Number(session.activeMs ?? 0),
        isActive: Boolean(session.isActive),
        isRemembered: Boolean(session.isRemembered),
        metadata: session.metadata ?? {},
    };
}
async function readCachedSession(sessionId) {
    const memorySession = readMemorySession(sessionId);
    if (memorySession) {
        return memorySession;
    }
    const client = getRedisClient();
    if (!client)
        return null;
    try {
        if (client.status === "wait")
            await client.connect();
        const value = await client.get(sessionKey(sessionId));
        if (!value)
            return null;
        const parsed = JSON.parse(value);
        const session = hydrateSession(parsed);
        const ttlSeconds = config_1.authTrackingConfig.sessionTimeoutMinutes * 60;
        writeMemorySession(session, ttlSeconds);
        return session;
    }
    catch {
        return null;
    }
}
async function writeCachedSession(session, maxAgeSeconds) {
    const ttlSeconds = maxAgeSeconds ?? config_1.authTrackingConfig.sessionTimeoutMinutes * 60;
    writeMemorySession(session, ttlSeconds);
    const client = getRedisClient();
    if (!client)
        return;
    try {
        if (client.status === "wait")
            await client.connect();
        await client.set(sessionKey(session._id), JSON.stringify(session), "EX", ttlSeconds);
    }
    catch {
    }
}
async function deleteCachedSession(sessionId) {
    memorySessionStore.delete(sessionId);
    const client = getRedisClient();
    if (!client)
        return;
    try {
        if (client.status === "wait")
            await client.connect();
        await client.del(sessionKey(sessionId));
    }
    catch {
    }
}
