"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestIp = getRequestIp;
exports.applyContextCookies = applyContextCookies;
exports.invalidateSystemConfigCache = invalidateSystemConfigCache;
exports.resolveRequestContext = resolveRequestContext;
const mongodb_1 = require("../mongodb");
const config_1 = require("./config");
const collections_1 = require("./collections");
const crypto_1 = require("./crypto");
const runtime_cache_1 = require("../lib/runtime-cache");
const session_store_1 = require("./session-store");
function parseIpFromHeader(value) {
    if (!value)
        return "";
    return value.split(",")[0]?.trim() ?? "";
}
function readHeader(request, name) {
    const value = request.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }
    return typeof value === "string" ? value : null;
}
function readCookie(request, name) {
    if (request.cookies && typeof request.cookies[name] === "string") {
        return request.cookies[name];
    }
    const rawCookie = readHeader(request, "cookie");
    if (!rawCookie)
        return undefined;
    const cookies = rawCookie.split(";");
    for (const entry of cookies) {
        const [key, ...valueParts] = entry.trim().split("=");
        if (key === name) {
            return decodeURIComponent(valueParts.join("="));
        }
    }
    return undefined;
}
function getRequestIp(request) {
    return (parseIpFromHeader(readHeader(request, "x-forwarded-for")) ||
        parseIpFromHeader(readHeader(request, "x-real-ip")) ||
        readHeader(request, "cf-connecting-ip") ||
        "0.0.0.0");
}
function normalizeIpClass(ipAddress) {
    const parts = ipAddress.split(".");
    if (parts.length < 3)
        return ipAddress;
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
}
function detectDeviceType(userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes("bot") || ua.includes("spider") || ua.includes("crawl")) {
        return "bot";
    }
    if (ua.includes("ipad") || ua.includes("tablet"))
        return "tablet";
    if (ua.includes("mobile") || ua.includes("android"))
        return "mobile";
    if (!ua)
        return "unknown";
    return "desktop";
}
function detectOs(userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes("windows"))
        return "Windows";
    if (ua.includes("mac os"))
        return "macOS";
    if (ua.includes("android"))
        return "Android";
    if (ua.includes("iphone") || ua.includes("ios"))
        return "iOS";
    if (ua.includes("linux"))
        return "Linux";
    return "Unknown";
}
function detectBrowser(userAgent) {
    const ua = userAgent.toLowerCase();
    if (ua.includes("edg/"))
        return "Edge";
    if (ua.includes("chrome/"))
        return "Chrome";
    if (ua.includes("firefox/"))
        return "Firefox";
    if (ua.includes("safari/") && !ua.includes("chrome/"))
        return "Safari";
    if (ua.includes("trident") || ua.includes("msie"))
        return "IE";
    return "Unknown";
}
const SESSION_PERSIST_INTERVAL_MS = 20_000;
const SYSTEM_CONFIG_CACHE_PREFIX = "auth:system-config";
const SYSTEM_CONFIG_CACHE_KEY = `${SYSTEM_CONFIG_CACHE_PREFIX}:system`;
const SYSTEM_CONFIG_CACHE_TTL_MS = 15_000;
const SYSTEM_CONFIG_CACHE_STALE_TTL_MS = 60_000;
function sessionCookieMaxAgeSeconds(rememberMe = false, timeoutMinutes) {
    if (rememberMe)
        return config_1.authTrackingConfig.rememberMeDays * 24 * 60 * 60;
    const minutes = timeoutMinutes ?? config_1.authTrackingConfig.sessionTimeoutMinutes;
    return Math.max(5, minutes) * 60;
}
function toCookieMaxAgeMs(seconds) {
    if (seconds === undefined)
        return undefined;
    return Math.max(0, seconds) * 1000;
}
function baseCookieOptions(maxAgeSeconds) {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: config_1.authTrackingConfig.secureCookies,
        path: "/",
        maxAge: toCookieMaxAgeMs(maxAgeSeconds),
    };
}
function applyContextCookies(response, context, options) {
    const identityMaxAge = config_1.authTrackingConfig.authCookieDays * 24 * 60 * 60;
    const sessionMaxAge = sessionCookieMaxAgeSeconds(Boolean(options?.rememberMe), context.config.sessionTimeoutMinutes);
    if (context.cookieState.identityToken) {
        response.cookie(config_1.authTrackingConfig.identityCookieName, context.cookieState.identityToken, baseCookieOptions(identityMaxAge));
    }
    if (options?.clearSession) {
        response.cookie(config_1.authTrackingConfig.sessionCookieName, "", {
            ...baseCookieOptions(0),
            maxAge: 0,
            expires: new Date(0),
        });
    }
    else if (context.cookieState.sessionToken) {
        response.cookie(config_1.authTrackingConfig.sessionCookieName, context.cookieState.sessionToken, baseCookieOptions(sessionMaxAge));
    }
    if (context.cookieState.csrfToken) {
        response.cookie(config_1.authTrackingConfig.csrfCookieName, context.cookieState.csrfToken, {
            httpOnly: false,
            sameSite: "lax",
            secure: config_1.authTrackingConfig.secureCookies,
            path: "/",
            maxAge: toCookieMaxAgeMs(identityMaxAge),
        });
    }
}
async function getSystemConfig() {
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(SYSTEM_CONFIG_CACHE_KEY, SYSTEM_CONFIG_CACHE_TTL_MS, SYSTEM_CONFIG_CACHE_STALE_TTL_MS, async () => {
        const db = await (0, mongodb_1.getMongoDb)();
        const { adminConfig } = (0, collections_1.getAuthCollections)(db);
        const existing = await adminConfig.findOne({ _id: "system" });
        if (existing)
            return existing;
        const created = {
            _id: "system",
            guestAttemptLimit: config_1.authTrackingConfig.guestAttemptLimitDefault,
            registrationRequired: config_1.authTrackingConfig.registrationRequiredDefault,
            sessionTimeoutMinutes: config_1.authTrackingConfig.sessionTimeoutMinutes,
            dataRetentionDays: config_1.authTrackingConfig.dataRetentionDaysDefault,
            enableTracking: config_1.authTrackingConfig.trackingEnabledDefault,
            updatedAt: new Date(),
            updatedBy: "system",
        };
        await adminConfig.updateOne({ _id: "system" }, { $setOnInsert: created }, { upsert: true });
        return created;
    });
}
function invalidateSystemConfigCache() {
    (0, runtime_cache_1.clearRuntimeCacheByPrefix)(SYSTEM_CONFIG_CACHE_PREFIX);
}
function createFingerprintId(identityId, ipAddress, userAgent, payload) {
    const fingerprint = payload?.fingerprint;
    const raw = [
        identityId,
        normalizeIpClass(ipAddress),
        userAgent,
        fingerprint?.canvas ?? "",
        fingerprint?.webgl ?? "",
        fingerprint?.audio ?? "",
        fingerprint?.timezone ?? "",
        fingerprint?.platform ?? "",
        fingerprint?.language ?? "",
        fingerprint?.screenResolution ?? "",
        fingerprint?.deviceMemory ?? "",
        fingerprint?.hardwareConcurrency ?? "",
        payload?.localBackupId ?? "",
    ].join("|");
    return (0, crypto_1.sha256)(raw);
}
function createSessionDoc(input) {
    return {
        _id: input.sessionId,
        identityId: input.identityId,
        fingerprintId: input.fingerprintId,
        localBackupId: input.localBackupId ?? null,
        userAgent: input.userAgent,
        device: input.device,
        geo: input.geo,
        referrer: input.referrer ?? null,
        firstVisitAt: input.now,
        startTime: input.now,
        lastSeenAt: input.now,
        endTime: null,
        durationMs: 0,
        idleMs: 0,
        activeMs: 0,
        isActive: true,
        isRemembered: false,
        metadata: {},
    };
}
async function resolveRequestContext(request, payload) {
    await (0, collections_1.ensureAuthTrackingInitialized)();
    const now = new Date();
    const db = await (0, mongodb_1.getMongoDb)();
    const collections = (0, collections_1.getAuthCollections)(db);
    const config = await getSystemConfig();
    const userAgent = readHeader(request, "user-agent") ?? "";
    const ipAddress = getRequestIp(request);
    const geo = {
        ipAddress,
        country: readHeader(request, "x-vercel-ip-country") ?? undefined,
        city: readHeader(request, "x-vercel-ip-city") ?? undefined,
        region: readHeader(request, "x-vercel-ip-country-region") ?? undefined,
    };
    const device = {
        type: detectDeviceType(userAgent),
        os: detectOs(userAgent),
        browser: detectBrowser(userAgent),
        screenResolution: payload?.fingerprint?.screenResolution,
        language: payload?.fingerprint?.language,
    };
    let identityToken = readCookie(request, config_1.authTrackingConfig.identityCookieName);
    let identityPayload = (0, crypto_1.verifyToken)(identityToken);
    if (!identityPayload?.id) {
        identityPayload = {
            id: (0, crypto_1.randomId)(),
            iat: Date.now(),
        };
        identityToken = (0, crypto_1.signToken)(identityPayload);
    }
    const identityId = identityPayload.id;
    const csrfCookie = readCookie(request, config_1.authTrackingConfig.csrfCookieName);
    const csrfToken = csrfCookie || (0, crypto_1.randomId)();
    let sessionToken = readCookie(request, config_1.authTrackingConfig.sessionCookieName);
    let sessionPayload = (0, crypto_1.verifyToken)(sessionToken);
    if (!sessionPayload?.sid || sessionPayload.id !== identityId) {
        sessionPayload = {
            sid: (0, crypto_1.randomId)(),
            id: identityId,
            iat: Date.now(),
        };
        sessionToken = (0, crypto_1.signToken)(sessionPayload);
    }
    const fingerprintId = createFingerprintId(identityId, ipAddress, userAgent, payload);
    let session = (await (0, session_store_1.readCachedSession)(sessionPayload.sid)) ??
        (await collections.sessions.findOne({ _id: sessionPayload.sid }));
    const timeoutMs = config.sessionTimeoutMinutes * 60 * 1000;
    const isSessionExpired = session &&
        now.getTime() - new Date(session.lastSeenAt).getTime() > timeoutMs;
    if (!session || session.identityId !== identityId || isSessionExpired) {
        const replacementSession = createSessionDoc({
            sessionId: sessionPayload.sid,
            identityId,
            fingerprintId,
            userAgent,
            geo,
            device,
            localBackupId: payload?.localBackupId,
            referrer: payload?.referrer,
            now,
        });
        session = replacementSession;
        await collections.sessions.updateOne({ _id: replacementSession._id }, { $set: replacementSession }, { upsert: true });
    }
    else {
        const previousSeenAt = new Date(session.lastSeenAt);
        const wasSessionActive = session.isActive;
        const fingerprintChanged = session.fingerprintId !== fingerprintId;
        const nextDuration = Math.max(session.durationMs ?? 0, now.getTime() - new Date(session.startTime).getTime());
        session = {
            ...session,
            isActive: true,
            endTime: null,
            lastSeenAt: now,
            durationMs: nextDuration,
            fingerprintId,
            localBackupId: payload?.localBackupId ?? session.localBackupId ?? null,
            device: {
                ...session.device,
                ...device,
            },
            geo: {
                ...session.geo,
                ...geo,
            },
            userAgent: userAgent || session.userAgent,
        };
        const shouldPersistSession = Boolean(payload) ||
            !wasSessionActive ||
            fingerprintChanged ||
            now.getTime() - previousSeenAt.getTime() >= SESSION_PERSIST_INTERVAL_MS;
        if (shouldPersistSession) {
            await collections.sessions.updateOne({ _id: session._id }, {
                $set: {
                    lastSeenAt: session.lastSeenAt,
                    durationMs: session.durationMs,
                    isActive: true,
                    endTime: null,
                    fingerprintId: session.fingerprintId,
                    localBackupId: session.localBackupId ?? null,
                    device: session.device,
                    geo: session.geo,
                    userAgent: session.userAgent,
                    referrer: payload?.referrer ?? session.referrer ?? null,
                },
            });
        }
    }
    await (0, session_store_1.writeCachedSession)(session);
    const [user, profile, guestAttempts, blockedIdentity] = await Promise.all([
        session.userId ? collections.users.findOne({ _id: session.userId }) : Promise.resolve(null),
        session.userId
            ? collections.userProfiles.findOne({ userId: session.userId })
            : Promise.resolve(null),
        collections.guestAttempts.findOne({ identityId }),
        collections.blockedEntities.findOne({
            entityType: "identity",
            entityId: identityId,
        }),
    ]);
    const isUserBlocked = Boolean(user?.isBlocked);
    return {
        now,
        config,
        identityId,
        sessionId: session._id,
        session,
        user,
        profile,
        guestAttempts,
        isIdentityBlocked: Boolean(blockedIdentity),
        isUserBlocked,
        ipAddress,
        userAgent,
        geo,
        device,
        fingerprintId,
        localBackupId: payload?.localBackupId,
        cookieState: {
            identityToken,
            sessionToken,
            csrfToken,
        },
    };
}
