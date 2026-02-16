import type { Request, Response } from "express";
import { getMongoDb } from "@/server/mongodb";
import { authTrackingConfig } from "./config";
import {
  ensureAuthTrackingInitialized,
  getAuthCollections,
} from "./collections";
import {
  randomId,
  sha256,
  signToken,
  verifyToken,
} from "./crypto";
import {
  clearRuntimeCacheByPrefix,
  getOrSetRuntimeCacheStaleWhileRevalidate,
} from "../lib/runtime-cache";
import { readCachedSession, writeCachedSession } from "./session-store";
import type {
  AdminConfigDoc,
  GuestAttemptDoc,
  SessionDeviceInfo,
  SessionDoc,
  SessionGeoInfo,
  SessionPayloadInput,
  UserDoc,
  UserProfileDoc,
} from "./types";

type CookieState = {
  identityToken?: string;
  sessionToken?: string;
  csrfToken?: string;
  sessionMaxAgeSeconds?: number;
};

export interface RequestContext {
  now: Date;
  config: AdminConfigDoc;
  identityId: string;
  sessionId: string;
  session: SessionDoc;
  user: UserDoc | null;
  profile: UserProfileDoc | null;
  guestAttempts: GuestAttemptDoc | null;
  isIdentityBlocked: boolean;
  isUserBlocked: boolean;
  ipAddress: string;
  userAgent: string;
  geo: SessionGeoInfo;
  device: SessionDeviceInfo;
  fingerprintId: string;
  localBackupId?: string;
  cookieState: CookieState;
}

function parseIpFromHeader(value: string | null) {
  if (!value) return "";
  return value.split(",")[0]?.trim() ?? "";
}

function readHeader(request: Request, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === "string" ? value : null;
}

function readCookie(request: Request, name: string) {
  if (request.cookies && typeof request.cookies[name] === "string") {
    return request.cookies[name] as string;
  }

  const rawCookie = readHeader(request, "cookie");
  if (!rawCookie) return undefined;
  const cookies = rawCookie.split(";");
  for (const entry of cookies) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return undefined;
}

export function getRequestIp(request: Request) {
  return (
    parseIpFromHeader(readHeader(request, "x-forwarded-for")) ||
    parseIpFromHeader(readHeader(request, "x-real-ip")) ||
    readHeader(request, "cf-connecting-ip") ||
    "0.0.0.0"
  );
}

function normalizeIpClass(ipAddress: string) {
  const parts = ipAddress.split(".");
  if (parts.length < 3) return ipAddress;
  return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
}

function detectDeviceType(userAgent: string): SessionDeviceInfo["type"] {
  const ua = userAgent.toLowerCase();
  if (ua.includes("bot") || ua.includes("spider") || ua.includes("crawl")) {
    return "bot";
  }
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("mobile") || ua.includes("android")) return "mobile";
  if (!ua) return "unknown";
  return "desktop";
}

function detectOs(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("windows")) return "Windows";
  if (ua.includes("mac os")) return "macOS";
  if (ua.includes("android")) return "Android";
  if (ua.includes("iphone") || ua.includes("ios")) return "iOS";
  if (ua.includes("linux")) return "Linux";
  return "Unknown";
}

function detectBrowser(userAgent: string) {
  const ua = userAgent.toLowerCase();
  if (ua.includes("edg/")) return "Edge";
  if (ua.includes("chrome/")) return "Chrome";
  if (ua.includes("firefox/")) return "Firefox";
  if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
  if (ua.includes("trident") || ua.includes("msie")) return "IE";
  return "Unknown";
}

const SESSION_PERSIST_INTERVAL_MS = 20_000;
const SYSTEM_CONFIG_CACHE_PREFIX = "auth:system-config";
const SYSTEM_CONFIG_CACHE_KEY = `${SYSTEM_CONFIG_CACHE_PREFIX}:system`;
const SYSTEM_CONFIG_CACHE_TTL_MS = 15_000;
const SYSTEM_CONFIG_CACHE_STALE_TTL_MS = 60_000;

function sessionCookieMaxAgeSeconds(rememberMe = false, timeoutMinutes?: number) {
  if (rememberMe) return authTrackingConfig.rememberMeDays * 24 * 60 * 60;
  const minutes = timeoutMinutes ?? authTrackingConfig.sessionTimeoutMinutes;
  return Math.max(5, minutes) * 60;
}

function toCookieMaxAgeMs(seconds?: number) {
  if (seconds === undefined) return undefined;
  return Math.max(0, seconds) * 1000;
}

function baseCookieOptions(maxAgeSeconds?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: authTrackingConfig.secureCookies,
    path: "/",
    maxAge: toCookieMaxAgeMs(maxAgeSeconds),
  };
}

export function applyContextCookies(
  response: Response,
  context: RequestContext,
  options?: { rememberMe?: boolean; clearSession?: boolean }
) {
  const identityMaxAge = authTrackingConfig.authCookieDays * 24 * 60 * 60;
  const sessionMaxAge = sessionCookieMaxAgeSeconds(
    Boolean(options?.rememberMe),
    context.config.sessionTimeoutMinutes
  );

  if (context.cookieState.identityToken) {
    response.cookie(
      authTrackingConfig.identityCookieName,
      context.cookieState.identityToken,
      baseCookieOptions(identityMaxAge)
    );
  }

  if (options?.clearSession) {
    response.cookie(authTrackingConfig.sessionCookieName, "", {
      ...baseCookieOptions(0),
      maxAge: 0,
      expires: new Date(0),
    });
  } else if (context.cookieState.sessionToken) {
    response.cookie(
      authTrackingConfig.sessionCookieName,
      context.cookieState.sessionToken,
      baseCookieOptions(sessionMaxAge)
    );
  }

  if (context.cookieState.csrfToken) {
    response.cookie(authTrackingConfig.csrfCookieName, context.cookieState.csrfToken, {
      httpOnly: false,
      sameSite: "lax" as const,
      secure: authTrackingConfig.secureCookies,
      path: "/",
      maxAge: toCookieMaxAgeMs(identityMaxAge),
    });
  }
}

async function getSystemConfig(): Promise<AdminConfigDoc> {
  return getOrSetRuntimeCacheStaleWhileRevalidate(
    SYSTEM_CONFIG_CACHE_KEY,
    SYSTEM_CONFIG_CACHE_TTL_MS,
    SYSTEM_CONFIG_CACHE_STALE_TTL_MS,
    async () => {
      const db = await getMongoDb();
      const { adminConfig } = getAuthCollections(db);
      const existing = await adminConfig.findOne({ _id: "system" });
      if (existing) return existing;

      const created: AdminConfigDoc = {
        _id: "system",
        guestAttemptLimit: authTrackingConfig.guestAttemptLimitDefault,
        registrationRequired: authTrackingConfig.registrationRequiredDefault,
        sessionTimeoutMinutes: authTrackingConfig.sessionTimeoutMinutes,
        dataRetentionDays: authTrackingConfig.dataRetentionDaysDefault,
        enableTracking: authTrackingConfig.trackingEnabledDefault,
        updatedAt: new Date(),
        updatedBy: "system",
      };
      await adminConfig.updateOne(
        { _id: "system" },
        { $setOnInsert: created },
        { upsert: true }
      );
      return created;
    }
  );
}

export function invalidateSystemConfigCache() {
  clearRuntimeCacheByPrefix(SYSTEM_CONFIG_CACHE_PREFIX);
}

type IdentityTokenPayload = {
  id: string;
  iat: number;
};

type SessionTokenPayload = {
  sid: string;
  id: string;
  iat: number;
};

function createFingerprintId(
  identityId: string,
  ipAddress: string,
  userAgent: string,
  payload?: SessionPayloadInput
) {
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
  return sha256(raw);
}

function createSessionDoc(
  input: {
    sessionId: string;
    identityId: string;
    fingerprintId: string;
    userAgent: string;
    geo: SessionGeoInfo;
    device: SessionDeviceInfo;
    localBackupId?: string;
    referrer?: string;
    now: Date;
  }
): SessionDoc {
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

export async function resolveRequestContext(
  request: Request,
  payload?: SessionPayloadInput
): Promise<RequestContext> {
  await ensureAuthTrackingInitialized();
  const now = new Date();
  const db = await getMongoDb();
  const collections = getAuthCollections(db);
  const config = await getSystemConfig();
  const userAgent = readHeader(request, "user-agent") ?? "";
  const ipAddress = getRequestIp(request);
  const geo: SessionGeoInfo = {
    ipAddress,
    country: readHeader(request, "x-vercel-ip-country") ?? undefined,
    city: readHeader(request, "x-vercel-ip-city") ?? undefined,
    region: readHeader(request, "x-vercel-ip-country-region") ?? undefined,
  };
  const device: SessionDeviceInfo = {
    type: detectDeviceType(userAgent),
    os: detectOs(userAgent),
    browser: detectBrowser(userAgent),
    screenResolution: payload?.fingerprint?.screenResolution,
    language: payload?.fingerprint?.language,
  };

  let identityToken = readCookie(request, authTrackingConfig.identityCookieName);
  let identityPayload = verifyToken<IdentityTokenPayload>(identityToken);
  if (!identityPayload?.id) {
    identityPayload = {
      id: randomId(),
      iat: Date.now(),
    };
    identityToken = signToken(identityPayload);
  }
  const identityId = identityPayload.id;

  const csrfCookie = readCookie(request, authTrackingConfig.csrfCookieName);
  const csrfToken = csrfCookie || randomId();

  let sessionToken = readCookie(request, authTrackingConfig.sessionCookieName);
  let sessionPayload = verifyToken<SessionTokenPayload>(sessionToken);
  if (!sessionPayload?.sid || sessionPayload.id !== identityId) {
    sessionPayload = {
      sid: randomId(),
      id: identityId,
      iat: Date.now(),
    };
    sessionToken = signToken(sessionPayload);
  }

  const fingerprintId = createFingerprintId(identityId, ipAddress, userAgent, payload);
  let session =
    (await readCachedSession(sessionPayload.sid)) ??
    (await collections.sessions.findOne({ _id: sessionPayload.sid }));

  const timeoutMs = config.sessionTimeoutMinutes * 60 * 1000;
  const isSessionExpired =
    session &&
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
    await collections.sessions.updateOne(
      { _id: replacementSession._id },
      { $set: replacementSession },
      { upsert: true }
    );
  } else {
    const previousSeenAt = new Date(session.lastSeenAt);
    const wasSessionActive = session.isActive;
    const fingerprintChanged = session.fingerprintId !== fingerprintId;
    const nextDuration = Math.max(
      session.durationMs ?? 0,
      now.getTime() - new Date(session.startTime).getTime()
    );
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
    const shouldPersistSession =
      Boolean(payload) ||
      !wasSessionActive ||
      fingerprintChanged ||
      now.getTime() - previousSeenAt.getTime() >= SESSION_PERSIST_INTERVAL_MS;

    if (shouldPersistSession) {
      await collections.sessions.updateOne(
        { _id: session._id },
        {
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
        }
      );
    }
  }

  await writeCachedSession(session);

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
