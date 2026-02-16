"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.assertCsrf = assertCsrf;
exports.enforceGuestAccess = enforceGuestAccess;
exports.recordActivities = recordActivities;
exports.handleSessionPayload = handleSessionPayload;
exports.getSessionSnapshot = getSessionSnapshot;
exports.registerUser = registerUser;
exports.loginUser = loginUser;
exports.logoutUser = logoutUser;
exports.getUserProfile = getUserProfile;
exports.updateUserProfile = updateUserProfile;
exports.getAdminConfigPayload = getAdminConfigPayload;
exports.updateAdminConfigPayload = updateAdminConfigPayload;
exports.listAdminUsers = listAdminUsers;
exports.updateAdminUserState = updateAdminUserState;
exports.getAdminAnalytics = getAdminAnalytics;
exports.listAdminActivities = listAdminActivities;
exports.submitTrackingActions = submitTrackingActions;
const zod_1 = require("zod");
const mongodb_1 = require("../mongodb");
const collections_1 = require("./collections");
const config_1 = require("./config");
const context_1 = require("./context");
const crypto_1 = require("./crypto");
const rate_limit_1 = require("./rate-limit");
const session_store_1 = require("./session-store");
class HttpError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.HttpError = HttpError;
const registerSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_.-]+$/),
    password: zod_1.z.string().min(8).max(128),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    phone: zod_1.z.string().trim().max(32).optional().or(zod_1.z.literal("")),
});
const loginSchema = zod_1.z.object({
    username: zod_1.z.string().trim().min(3).max(32),
    password: zod_1.z.string().min(1).max(128),
    rememberMe: zod_1.z.boolean().optional(),
});
const profileSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional().nullable(),
    phone: zod_1.z.string().max(32).optional().nullable(),
    additionalInfo: zod_1.z.record(zod_1.z.unknown()).optional().nullable(),
});
const adminConfigSchema = zod_1.z.object({
    guestAttemptLimit: zod_1.z.number().int().min(0).max(1000).optional(),
    registrationRequired: zod_1.z.boolean().optional(),
    sessionTimeoutMinutes: zod_1.z.number().int().min(5).max(1440).optional(),
    dataRetentionDays: zod_1.z.number().int().min(1).max(3650).optional(),
    enableTracking: zod_1.z.boolean().optional(),
});
const adminUserActionSchema = zod_1.z.object({
    action: zod_1.z.enum(["block", "unblock", "force_logout"]),
    targetType: zod_1.z.enum(["user", "identity"]),
    targetId: zod_1.z.string().trim().min(1).max(128),
    reason: zod_1.z.string().trim().max(200).optional(),
});
const actionSchema = zod_1.z.object({
    actionType: zod_1.z.string().trim().min(1).max(100),
    actionDetails: zod_1.z.record(zod_1.z.unknown()).optional(),
    pageUrl: zod_1.z.string().trim().max(2000).optional(),
    route: zod_1.z.string().trim().max(200).optional(),
    timestamp: zod_1.z.string().optional(),
});
function toIso(value) {
    return value ? value.toISOString() : null;
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
function toPublicUser(user) {
    if (!user)
        return null;
    return {
        id: user._id,
        username: user.username,
        email: user.email ?? null,
        phone: user.phone ?? null,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: toIso(user.lastLoginAt),
    };
}
function coerceDate(input) {
    if (!input)
        return null;
    const date = new Date(input);
    if (Number.isNaN(date.getTime()))
        return null;
    return date;
}
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeOptionalText(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}
function isDuplicateKeyError(error) {
    return Boolean(error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000);
}
function stripUnknown(input) {
    if (!input)
        return undefined;
    return JSON.parse(JSON.stringify(input));
}
function startOfDay(date = new Date()) {
    const output = new Date(date);
    output.setHours(0, 0, 0, 0);
    return output;
}
function startOfWeek(date = new Date()) {
    const output = startOfDay(date);
    const day = output.getDay();
    const diff = day === 0 ? 6 : day - 1;
    output.setDate(output.getDate() - diff);
    return output;
}
function startOfMonth(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}
function toCsv(rows) {
    const escape = (value) => {
        const cell = String(value);
        if (/[",\r\n]/.test(cell)) {
            return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
    };
    return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}
function assertCsrf(request) {
    const csrfCookie = readCookie(request, config_1.authTrackingConfig.csrfCookieName);
    const csrfHeader = readHeader(request, "x-csrf-token");
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        throw new HttpError(403, "csrf_invalid", "Invalid CSRF token.");
    }
}
async function writeSessionPatch(sessionId, patch) {
    const db = await (0, mongodb_1.getMongoDb)();
    const { sessions } = (0, collections_1.getAuthCollections)(db);
    await sessions.updateOne({ _id: sessionId }, {
        $set: patch,
    });
}
async function resolveGuestAccessStatus(identityId, config) {
    const db = await (0, mongodb_1.getMongoDb)();
    const { guestAttempts, blockedEntities } = (0, collections_1.getAuthCollections)(db);
    const [attemptDoc, blockedIdentity] = await Promise.all([
        guestAttempts.findOne({ identityId }),
        blockedEntities.findOne({ entityType: "identity", entityId: identityId }),
    ]);
    const attemptsUsed = attemptDoc?.attemptCount ?? 0;
    const limit = config.guestAttemptLimit;
    const attemptsRemaining = Math.max(limit - attemptsUsed, 0);
    return {
        limit,
        attemptsUsed,
        attemptsRemaining,
        registrationRequired: config.registrationRequired,
        isBlocked: Boolean(blockedIdentity),
    };
}
async function enforceGuestAccess(request, options) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (context.isIdentityBlocked) {
        throw new HttpError(403, "identity_blocked", "Access blocked by administrator.");
    }
    if (context.isUserBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    if (context.user) {
        return {
            context,
            guest: await resolveGuestAccessStatus(context.identityId, context.config),
        };
    }
    const db = await (0, mongodb_1.getMongoDb)();
    const { guestAttempts } = (0, collections_1.getAuthCollections)(db);
    const usedAttempts = context.guestAttempts?.attemptCount ?? 0;
    const limit = context.config.guestAttemptLimit;
    if (context.config.registrationRequired && usedAttempts >= limit) {
        throw new HttpError(403, "registration_required", "Guest attempts exhausted. Registration is required.", {
            attemptsUsed: usedAttempts,
            attemptLimit: limit,
        });
    }
    let nextAttempts = usedAttempts;
    if (options?.incrementAttempt) {
        nextAttempts += 1;
        const now = new Date();
        await guestAttempts.updateOne({ identityId: context.identityId }, {
            $setOnInsert: {
                identityId: context.identityId,
                firstVisit: now,
            },
            $set: {
                fingerprintId: context.fingerprintId,
                lastVisit: now,
            },
            $inc: {
                attemptCount: 1,
            },
        }, { upsert: true });
        await recordActivities(context.session._id, context.identityId, null, [
            {
                actionType: "guest_attempt",
                actionDetails: {
                    reason: options.attemptReason ?? "generic",
                    attemptCount: nextAttempts,
                },
            },
        ]);
    }
    return {
        context,
        guest: {
            limit,
            attemptsUsed: nextAttempts,
            attemptsRemaining: Math.max(limit - nextAttempts, 0),
            registrationRequired: context.config.registrationRequired,
            isBlocked: false,
        },
    };
}
async function recordActivities(sessionId, identityId, userId, actions, requestMeta) {
    await (0, collections_1.ensureAuthTrackingInitialized)();
    if (!actions.length)
        return { inserted: 0 };
    const db = await (0, mongodb_1.getMongoDb)();
    const { activities } = (0, collections_1.getAuthCollections)(db);
    const docs = actions
        .slice(0, 100)
        .map((action) => {
        const parsed = actionSchema.safeParse(action);
        if (!parsed.success)
            return null;
        const value = parsed.data;
        return {
            activityId: (0, crypto_1.randomId)(),
            userIdentifier: identityId,
            userId,
            sessionId,
            actionType: value.actionType,
            actionDetails: stripUnknown(value.actionDetails),
            timestamp: coerceDate(value.timestamp) ?? new Date(),
            pageUrl: value.pageUrl,
            route: value.route,
            referrer: requestMeta?.referrer ?? null,
            userAgent: requestMeta?.userAgent,
            ipAddress: requestMeta?.ipAddress,
        };
    });
    const normalizedDocs = docs.filter((doc) => doc !== null);
    if (!normalizedDocs.length)
        return { inserted: 0 };
    await activities.insertMany(normalizedDocs, { ordered: false });
    return { inserted: normalizedDocs.length };
}
async function handleSessionPayload(request, payload) {
    const context = await (0, context_1.resolveRequestContext)(request, payload);
    if (context.isIdentityBlocked) {
        throw new HttpError(403, "identity_blocked", "Access blocked by administrator.");
    }
    if (context.isUserBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    const now = new Date();
    const activeMs = Math.max(0, Number(payload.activeMs ?? 0));
    const idleMs = Math.max(0, Number(payload.idleMs ?? 0));
    const durationMs = Number(payload.durationMs ?? 0) ||
        now.getTime() - new Date(context.session.startTime).getTime();
    const sessionPatch = {
        lastSeenAt: now,
        durationMs: Math.max(context.session.durationMs ?? 0, durationMs),
        activeMs: Math.max(context.session.activeMs ?? 0, activeMs),
        idleMs: Math.max(context.session.idleMs ?? 0, idleMs),
        referrer: payload.referrer ?? context.session.referrer ?? null,
        fingerprintId: context.fingerprintId,
        geo: context.geo,
        device: context.device,
        localBackupId: payload.localBackupId ?? context.session.localBackupId ?? null,
        userAgent: context.userAgent,
    };
    if (payload.eventType === "end") {
        sessionPatch.isActive = false;
        sessionPatch.endTime = now;
    }
    else {
        sessionPatch.isActive = true;
        sessionPatch.endTime = null;
    }
    await writeSessionPatch(context.session._id, sessionPatch);
    const nextSession = {
        ...context.session,
        ...sessionPatch,
    };
    await (0, session_store_1.writeCachedSession)(nextSession);
    await recordActivities(context.session._id, context.identityId, context.user?._id ?? null, [
        {
            actionType: `session_${payload.eventType}`,
            actionDetails: {
                activeMs,
                idleMs,
                durationMs: sessionPatch.durationMs,
            },
            pageUrl: payload.pageUrl,
            route: payload.pageUrl,
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: payload.referrer ?? null,
    });
    const guestAccess = await resolveGuestAccessStatus(context.identityId, context.config);
    return {
        context,
        payload: {
            session: {
                id: context.session._id,
                startedAt: context.session.startTime.toISOString(),
                lastSeenAt: now.toISOString(),
                isActive: payload.eventType !== "end",
            },
            user: toPublicUser(context.user),
            profile: context.profile,
            guestAccess,
            config: {
                guestAttemptLimit: context.config.guestAttemptLimit,
                registrationRequired: context.config.registrationRequired,
                sessionTimeoutMinutes: context.config.sessionTimeoutMinutes,
                dataRetentionDays: context.config.dataRetentionDays,
                enableTracking: context.config.enableTracking,
            },
            csrfToken: context.cookieState.csrfToken,
        },
    };
}
async function getSessionSnapshot(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    const guestAccess = await resolveGuestAccessStatus(context.identityId, context.config);
    return {
        context,
        payload: {
            user: toPublicUser(context.user),
            profile: context.profile,
            guestAccess,
            session: {
                id: context.session._id,
                startedAt: context.session.startTime.toISOString(),
                lastSeenAt: context.session.lastSeenAt.toISOString(),
                isActive: context.session.isActive,
            },
            config: {
                guestAttemptLimit: context.config.guestAttemptLimit,
                registrationRequired: context.config.registrationRequired,
                sessionTimeoutMinutes: context.config.sessionTimeoutMinutes,
                dataRetentionDays: context.config.dataRetentionDays,
                enableTracking: context.config.enableTracking,
            },
            csrfToken: context.cookieState.csrfToken,
        },
    };
}
async function registerUser(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (context.isIdentityBlocked) {
        throw new HttpError(403, "identity_blocked", "Access blocked by administrator.");
    }
    if (context.user) {
        throw new HttpError(400, "already_authenticated", "Already logged in.");
    }
    const ipKey = `${context.ipAddress}:register`;
    const limiter = (0, rate_limit_1.consumeRateLimit)(ipKey, { limit: 10, windowMs: 10 * 60 * 1000 });
    if (!limiter.allowed) {
        throw new HttpError(429, "rate_limited", "Too many registration attempts.");
    }
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
        throw new HttpError(400, "invalid_payload", "Invalid registration payload.");
    }
    const db = await (0, mongodb_1.getMongoDb)();
    const { users, userProfiles, sessions } = (0, collections_1.getAuthCollections)(db);
    const payload = parsed.data;
    const username = payload.username.trim();
    const usernameLower = username.toLowerCase();
    const email = normalizeOptionalText(payload.email);
    const phone = normalizeOptionalText(payload.phone);
    const existing = await users.findOne({ usernameLower });
    if (existing) {
        throw new HttpError(409, "username_exists", "Username is already in use.");
    }
    const now = new Date();
    const userId = (0, crypto_1.randomId)();
    const passwordHash = await (0, crypto_1.hashPassword)(payload.password);
    try {
        await users.insertOne({
            _id: userId,
            username,
            usernameLower,
            passwordHash,
            ...(email ? { email } : {}),
            ...(phone ? { phone } : {}),
            role: "user",
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
            isBlocked: false,
            blockedAt: null,
        });
    }
    catch (insertError) {
        if (isDuplicateKeyError(insertError)) {
            throw new HttpError(409, "registration_conflict", "Username or email is already in use.");
        }
        throw insertError;
    }
    await userProfiles.updateOne({ userId }, {
        $set: {
            userId,
            email: email ?? null,
            phone: phone ?? null,
            additionalInfo: null,
            updatedAt: now,
        },
    }, { upsert: true });
    await sessions.updateOne({ _id: context.session._id }, {
        $set: {
            userId,
            isRemembered: false,
            lastSeenAt: now,
        },
    });
    const user = await users.findOne({ _id: userId });
    if (!user) {
        throw new HttpError(500, "registration_failed", "Failed to create user.");
    }
    const nextSession = {
        ...context.session,
        userId,
        isRemembered: false,
        lastSeenAt: now,
    };
    await (0, session_store_1.writeCachedSession)(nextSession);
    await recordActivities(context.session._id, context.identityId, userId, [
        {
            actionType: "auth_register",
            actionDetails: {
                username,
            },
        },
        {
            actionType: "auth_login",
            actionDetails: {
                via: "registration",
            },
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    const guestAccess = await resolveGuestAccessStatus(context.identityId, context.config);
    return {
        context,
        user: toPublicUser(user),
        guestAccess,
    };
}
async function loginUser(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (context.isIdentityBlocked) {
        throw new HttpError(403, "identity_blocked", "Access blocked by administrator.");
    }
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
        throw new HttpError(400, "invalid_payload", "Invalid login payload.");
    }
    const payload = parsed.data;
    const limiter = (0, rate_limit_1.consumeRateLimit)(`${context.ipAddress}:login`, {
        limit: 30,
        windowMs: 10 * 60 * 1000,
    });
    if (!limiter.allowed) {
        throw new HttpError(429, "rate_limited", "Too many login attempts.");
    }
    const db = await (0, mongodb_1.getMongoDb)();
    const { users, userProfiles, sessions } = (0, collections_1.getAuthCollections)(db);
    const usernameLower = payload.username.toLowerCase();
    const user = await users.findOne({ usernameLower });
    if (!user) {
        throw new HttpError(401, "invalid_credentials", "Invalid username or password.");
    }
    if (user.isBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    const validPassword = await (0, crypto_1.verifyPassword)(payload.password, user.passwordHash);
    if (!validPassword) {
        throw new HttpError(401, "invalid_credentials", "Invalid username or password.");
    }
    const now = new Date();
    await users.updateOne({ _id: user._id }, {
        $set: {
            lastLoginAt: now,
            updatedAt: now,
        },
    });
    await sessions.updateOne({ _id: context.session._id }, {
        $set: {
            userId: user._id,
            isRemembered: Boolean(payload.rememberMe),
            lastSeenAt: now,
        },
    });
    const nextSession = {
        ...context.session,
        userId: user._id,
        isRemembered: Boolean(payload.rememberMe),
        lastSeenAt: now,
    };
    await (0, session_store_1.writeCachedSession)(nextSession, payload.rememberMe
        ? config_1.authTrackingConfig.rememberMeDays * 24 * 60 * 60
        : context.config.sessionTimeoutMinutes * 60);
    const profile = await userProfiles.findOne({ userId: user._id });
    await recordActivities(context.session._id, context.identityId, user._id, [
        {
            actionType: "auth_login",
            actionDetails: {
                rememberMe: Boolean(payload.rememberMe),
            },
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    const guestAccess = await resolveGuestAccessStatus(context.identityId, context.config);
    return {
        context,
        user: toPublicUser({
            ...user,
            lastLoginAt: now,
        }),
        profile,
        rememberMe: Boolean(payload.rememberMe),
        guestAccess,
    };
}
async function logoutUser(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    const now = new Date();
    await writeSessionPatch(context.session._id, {
        isActive: false,
        endTime: now,
        lastSeenAt: now,
        durationMs: Math.max(context.session.durationMs, now.getTime() - new Date(context.session.startTime).getTime()),
    });
    await (0, session_store_1.deleteCachedSession)(context.session._id);
    await recordActivities(context.session._id, context.identityId, context.user?._id ?? null, [{ actionType: "auth_logout" }], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    return {
        context,
    };
}
async function getUserProfile(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (!context.user) {
        throw new HttpError(401, "not_authenticated", "Authentication required.");
    }
    if (context.isUserBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    const profile = context.profile ?? {
        userId: context.user._id,
        email: context.user.email ?? null,
        phone: context.user.phone ?? null,
        additionalInfo: null,
        updatedAt: context.user.updatedAt,
    };
    return {
        context,
        payload: {
            user: toPublicUser(context.user),
            profile,
        },
    };
}
async function updateUserProfile(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (!context.user) {
        throw new HttpError(401, "not_authenticated", "Authentication required.");
    }
    if (context.isUserBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    assertCsrf(request);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
        throw new HttpError(400, "invalid_payload", "Invalid profile payload.");
    }
    const payload = parsed.data;
    const now = new Date();
    const db = await (0, mongodb_1.getMongoDb)();
    const { users, userProfiles } = (0, collections_1.getAuthCollections)(db);
    const email = normalizeOptionalText(payload.email ?? undefined);
    const phone = normalizeOptionalText(payload.phone ?? undefined);
    const userSet = {
        updatedAt: now,
    };
    const userUnset = {};
    if (email) {
        userSet.email = email;
    }
    else {
        userUnset.email = "";
    }
    if (phone) {
        userSet.phone = phone;
    }
    else {
        userUnset.phone = "";
    }
    try {
        await users.updateOne({ _id: context.user._id }, {
            $set: userSet,
            ...(Object.keys(userUnset).length > 0 ? { $unset: userUnset } : {}),
        });
    }
    catch (updateError) {
        if (isDuplicateKeyError(updateError)) {
            throw new HttpError(409, "profile_conflict", "This email is already in use by another account.");
        }
        throw updateError;
    }
    await userProfiles.updateOne({ userId: context.user._id }, {
        $set: {
            userId: context.user._id,
            email: email ?? null,
            phone: phone ?? null,
            additionalInfo: payload.additionalInfo ?? null,
            updatedAt: now,
        },
    }, { upsert: true });
    await recordActivities(context.session._id, context.identityId, context.user._id, [
        {
            actionType: "profile_update",
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    const updatedUser = await users.findOne({ _id: context.user._id });
    const updatedProfile = await userProfiles.findOne({ userId: context.user._id });
    return {
        context,
        payload: {
            user: toPublicUser(updatedUser),
            profile: updatedProfile,
        },
    };
}
function assertAdminUser(user, isBlocked) {
    if (!user) {
        throw new HttpError(401, "not_authenticated", "Authentication required.");
    }
    if (isBlocked || user.isBlocked) {
        throw new HttpError(403, "user_blocked", "User account is blocked.");
    }
    if (user.role !== "super_admin") {
        throw new HttpError(403, "forbidden", "Super admin access required.");
    }
}
async function getAdminConfigPayload(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    return {
        context,
        payload: context.config,
    };
}
async function updateAdminConfigPayload(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    assertCsrf(request);
    const parsed = adminConfigSchema.safeParse(body);
    if (!parsed.success) {
        throw new HttpError(400, "invalid_payload", "Invalid config payload.");
    }
    const updates = parsed.data;
    const now = new Date();
    const db = await (0, mongodb_1.getMongoDb)();
    const { adminConfig } = (0, collections_1.getAuthCollections)(db);
    await adminConfig.updateOne({ _id: "system" }, {
        $set: {
            ...updates,
            updatedAt: now,
            updatedBy: context.user._id,
        },
    });
    (0, context_1.invalidateSystemConfigCache)();
    const nextConfig = await adminConfig.findOne({ _id: "system" });
    await recordActivities(context.session._id, context.identityId, context.user._id, [
        {
            actionType: "admin_config_update",
            actionDetails: updates,
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    return {
        context,
        payload: nextConfig,
    };
}
async function listAdminUsers(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    const db = await (0, mongodb_1.getMongoDb)();
    const { sessions, users, guestAttempts, blockedEntities } = (0, collections_1.getAuthCollections)(db);
    const [sessionStats, userDocs, guestDocs, blockedDocs] = await Promise.all([
        sessions
            .aggregate([
            {
                $group: {
                    _id: "$identityId",
                    userId: { $max: "$userId" },
                    totalSessions: { $sum: 1 },
                    totalDurationMs: { $sum: { $ifNull: ["$durationMs", 0] } },
                    lastActiveAt: { $max: "$lastSeenAt" },
                    firstSeenAt: { $min: "$firstVisitAt" },
                },
            },
        ])
            .toArray(),
        users.find().toArray(),
        guestAttempts.find().toArray(),
        blockedEntities.find({ entityType: "identity" }).toArray(),
    ]);
    const usersById = new Map(userDocs.map((user) => [user._id, user]));
    const guestByIdentity = new Map(guestDocs.map((item) => [item.identityId, item]));
    const blockedIdentitySet = new Set(blockedDocs.map((item) => item.entityId));
    const rows = sessionStats.map((item) => {
        const user = item.userId ? usersById.get(item.userId) : null;
        const guest = guestByIdentity.get(item._id);
        const registered = Boolean(user);
        const attemptsUsed = guest?.attemptCount ?? 0;
        return {
            identityId: item._id,
            userId: user?._id ?? null,
            username: user?.username ?? "guest",
            role: user?.role ?? "guest",
            registrationStatus: registered ? "registered" : "guest",
            registrationDate: user?.createdAt?.toISOString() ?? null,
            lastActiveAt: item.lastActiveAt?.toISOString() ?? null,
            totalSessions: item.totalSessions,
            totalDurationMs: item.totalDurationMs,
            attemptsUsed,
            attemptsRemaining: Math.max(context.config.guestAttemptLimit - attemptsUsed, 0),
            isBlocked: registered ? Boolean(user?.isBlocked) : blockedIdentitySet.has(item._id),
        };
    });
    return {
        context,
        payload: {
            users: rows.sort((a, b) => {
                const left = new Date(a.lastActiveAt ?? 0).getTime();
                const right = new Date(b.lastActiveAt ?? 0).getTime();
                return right - left;
            }),
            config: context.config,
        },
    };
}
async function updateAdminUserState(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    assertCsrf(request);
    const parsed = adminUserActionSchema.safeParse(body);
    if (!parsed.success) {
        throw new HttpError(400, "invalid_payload", "Invalid user action payload.");
    }
    const payload = parsed.data;
    const db = await (0, mongodb_1.getMongoDb)();
    const { users, sessions, blockedEntities } = (0, collections_1.getAuthCollections)(db);
    if (payload.targetType === "user") {
        const user = await users.findOne({ _id: payload.targetId });
        if (!user) {
            throw new HttpError(404, "user_not_found", "User not found.");
        }
        if (payload.action === "block") {
            await users.updateOne({ _id: user._id }, {
                $set: {
                    isBlocked: true,
                    blockedAt: new Date(),
                    updatedAt: new Date(),
                },
            });
            await sessions.updateMany({ userId: user._id, isActive: true }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
        else if (payload.action === "unblock") {
            await users.updateOne({ _id: user._id }, {
                $set: {
                    isBlocked: false,
                    blockedAt: null,
                    updatedAt: new Date(),
                },
            });
        }
        else {
            await sessions.updateMany({ userId: user._id, isActive: true }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
    }
    else {
        if (payload.action === "block") {
            await blockedEntities.updateOne({
                entityType: "identity",
                entityId: payload.targetId,
            }, {
                $set: {
                    entityType: "identity",
                    entityId: payload.targetId,
                    reason: payload.reason ?? "Blocked by admin",
                    blockedAt: new Date(),
                    blockedBy: context.user._id,
                },
            }, { upsert: true });
            await sessions.updateMany({ identityId: payload.targetId, isActive: true }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
        else if (payload.action === "unblock") {
            await blockedEntities.deleteOne({
                entityType: "identity",
                entityId: payload.targetId,
            });
        }
        else {
            await sessions.updateMany({ identityId: payload.targetId, isActive: true }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
    }
    await recordActivities(context.session._id, context.identityId, context.user._id, [
        {
            actionType: "admin_user_action",
            actionDetails: payload,
        },
    ], {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    return {
        context,
        payload: {
            success: true,
        },
    };
}
async function getAdminAnalytics(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    const db = await (0, mongodb_1.getMongoDb)();
    const { users, sessions, activities, guestAttempts } = (0, collections_1.getAuthCollections)(db);
    const today = startOfDay();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();
    const activeThreshold = new Date(Date.now() - 5 * 60 * 1000);
    const [totalRegisteredUsers, totalGuests, activeUsers, newUsersToday, newUsersWeek, newUsersMonth, totalSessions, avgSessionDurationAgg, featureUsage, peakUsageRaw, downloadStats, searchStats, geoDistribution, deviceStats, browserStats, retentionRaw, conversionRaw,] = await Promise.all([
        users.countDocuments({}),
        guestAttempts.countDocuments({}),
        sessions.distinct("identityId", {
            isActive: true,
            lastSeenAt: { $gte: activeThreshold },
        }).then((items) => items.length),
        users.countDocuments({ createdAt: { $gte: today } }),
        users.countDocuments({ createdAt: { $gte: weekStart } }),
        users.countDocuments({ createdAt: { $gte: monthStart } }),
        sessions.countDocuments({}),
        sessions
            .aggregate([
            {
                $group: {
                    _id: null,
                    avgDurationMs: { $avg: "$durationMs" },
                },
            },
        ])
            .toArray(),
        activities
            .aggregate([
            {
                $group: {
                    _id: "$actionType",
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
            { $limit: 20 },
        ])
            .toArray(),
        activities
            .aggregate([
            {
                $group: {
                    _id: { $hour: "$timestamp" },
                    count: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ])
            .toArray(),
        activities.countDocuments({
            actionType: { $in: ["download", "export", "file_download"] },
        }),
        activities
            .aggregate([
            { $match: { actionType: "search" } },
            {
                $group: {
                    _id: {
                        $ifNull: [
                            "$actionDetails.query",
                            "$actionDetails.search",
                        ],
                    },
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
        ])
            .toArray(),
        sessions
            .aggregate([
            {
                $group: {
                    _id: { $ifNull: ["$geo.country", "Unknown"] },
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
        ])
            .toArray(),
        sessions
            .aggregate([
            {
                $group: {
                    _id: { $ifNull: ["$device.type", "unknown"] },
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
        ])
            .toArray(),
        sessions
            .aggregate([
            {
                $group: {
                    _id: { $ifNull: ["$device.browser", "Unknown"] },
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
        ])
            .toArray(),
        sessions
            .aggregate([
            {
                $group: {
                    _id: "$identityId",
                    sessionCount: { $sum: 1 },
                },
            },
        ])
            .toArray(),
        sessions
            .aggregate([
            {
                $group: {
                    _id: "$identityId",
                    hasGuest: {
                        $max: {
                            $cond: [{ $eq: ["$userId", null] }, 1, 0],
                        },
                    },
                    hasRegistered: {
                        $max: {
                            $cond: [{ $ne: ["$userId", null] }, 1, 0],
                        },
                    },
                },
            },
        ])
            .toArray(),
    ]);
    const avgSessionDurationMs = avgSessionDurationAgg[0]?.avgDurationMs ?? 0;
    const retentionReturning = retentionRaw.filter((row) => row.sessionCount > 1).length;
    const retentionTotal = retentionRaw.length;
    const retentionRate = retentionTotal
        ? (retentionReturning / retentionTotal) * 100
        : 0;
    const guestTotalForConversion = conversionRaw.filter((row) => row.hasGuest === 1).length;
    const convertedUsers = conversionRaw.filter((row) => row.hasGuest === 1 && row.hasRegistered === 1).length;
    const conversionRate = guestTotalForConversion
        ? (convertedUsers / guestTotalForConversion) * 100
        : 0;
    const peakUsageByHour = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        count: peakUsageRaw.find((item) => item._id === hour)?.count ?? 0,
    }));
    return {
        context,
        payload: {
            overview: {
                totalUsers: totalRegisteredUsers + totalGuests,
                registeredUsers: totalRegisteredUsers,
                guests: totalGuests,
                activeUsers,
                newUsers: {
                    today: newUsersToday,
                    week: newUsersWeek,
                    month: newUsersMonth,
                },
                totalSessions,
                averageSessionDurationMs: Math.round(avgSessionDurationMs),
                mostUsedFeatures: featureUsage.slice(0, 8).map((item) => ({
                    actionType: item._id,
                    count: item.count,
                })),
                peakUsageByHour,
            },
            engagement: {
                retentionRate,
                returningUsers: retentionReturning,
                trackedUsers: retentionTotal,
            },
            conversion: {
                conversionRate,
                convertedUsers,
                guestPopulation: guestTotalForConversion,
            },
            downloads: {
                totalDownloads: downloadStats,
            },
            searchAnalytics: searchStats.map((item) => ({
                query: item._id || "(empty)",
                count: item.count,
            })),
            geoDistribution: geoDistribution.map((item) => ({
                country: item._id,
                count: item.count,
            })),
            deviceStats: deviceStats.map((item) => ({
                type: item._id,
                count: item.count,
            })),
            browserStats: browserStats.map((item) => ({
                browser: item._id,
                count: item.count,
            })),
            featureUsage: featureUsage.map((item) => ({
                actionType: item._id,
                count: item.count,
            })),
            generatedAt: new Date().toISOString(),
        },
    };
}
async function listAdminActivities(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    const actionType = typeof request.query.actionType === "string" ? request.query.actionType : null;
    const userIdentifier = typeof request.query.userIdentifier === "string" ? request.query.userIdentifier : null;
    const userQuery = typeof request.query.userQuery === "string" ? request.query.userQuery.trim() : undefined;
    const dateFrom = coerceDate(typeof request.query.dateFrom === "string" ? request.query.dateFrom : undefined);
    const dateTo = coerceDate(typeof request.query.dateTo === "string" ? request.query.dateTo : undefined);
    const format = typeof request.query.format === "string" ? request.query.format : "json";
    const page = Math.max(1, Number(typeof request.query.page === "string" ? request.query.page : "1"));
    const limit = Math.min(200, Math.max(1, Number(typeof request.query.limit === "string" ? request.query.limit : "50")));
    const filter = {};
    if (actionType)
        filter.actionType = actionType;
    if (userIdentifier) {
        filter.userIdentifier = userIdentifier;
    }
    else if (userQuery) {
        const normalizedQuery = escapeRegex(userQuery);
        filter.$or = [
            { userIdentifier: { $regex: normalizedQuery, $options: "i" } },
            { userId: { $regex: normalizedQuery, $options: "i" } },
            { sessionId: { $regex: normalizedQuery, $options: "i" } },
            { ipAddress: { $regex: normalizedQuery, $options: "i" } },
        ];
    }
    if (dateFrom || dateTo) {
        filter.timestamp = {};
        if (dateFrom)
            filter.timestamp.$gte = dateFrom;
        if (dateTo) {
            const end = new Date(dateTo);
            end.setHours(23, 59, 59, 999);
            filter.timestamp.$lte = end;
        }
    }
    const db = await (0, mongodb_1.getMongoDb)();
    const { activities } = (0, collections_1.getAuthCollections)(db);
    const [items, total] = await Promise.all([
        activities
            .find(filter)
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .toArray(),
        activities.countDocuments(filter),
    ]);
    const normalized = items.map((item) => ({
        activityId: item.activityId,
        userIdentifier: item.userIdentifier,
        userId: item.userId ?? null,
        sessionId: item.sessionId,
        actionType: item.actionType,
        actionDetails: item.actionDetails ?? {},
        timestamp: item.timestamp.toISOString(),
        pageUrl: item.pageUrl ?? null,
        route: item.route ?? null,
        referrer: item.referrer ?? null,
        ipAddress: item.ipAddress ?? null,
    }));
    if (format === "csv" || format === "excel") {
        const rows = [
            [
                "activityId",
                "timestamp",
                "userIdentifier",
                "userId",
                "sessionId",
                "actionType",
                "pageUrl",
                "route",
                "ipAddress",
                "details",
            ],
            ...normalized.map((item) => [
                item.activityId,
                item.timestamp,
                item.userIdentifier,
                item.userId ?? "",
                item.sessionId,
                item.actionType,
                item.pageUrl ?? "",
                item.route ?? "",
                item.ipAddress ?? "",
                JSON.stringify(item.actionDetails ?? {}),
            ]),
        ];
        return {
            context,
            payload: toCsv(rows),
            export: format,
        };
    }
    if (format === "pdf") {
        const text = normalized
            .slice(0, 200)
            .map((item) => `${item.timestamp} | ${item.actionType} | ${item.userIdentifier} | ${item.pageUrl ?? "-"}`)
            .join("\n");
        return {
            context,
            payload: text,
            export: "pdf",
        };
    }
    return {
        context,
        payload: {
            items: normalized,
            total,
            page,
            limit,
        },
    };
}
async function submitTrackingActions(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    if (context.isIdentityBlocked) {
        throw new HttpError(403, "identity_blocked", "Access blocked by administrator.");
    }
    const actions = Array.isArray(body?.actions)
        ? (body.actions ?? [])
        : [body];
    const parsedActions = actions
        .map((entry) => actionSchema.safeParse(entry))
        .filter((entry) => entry.success)
        .map((entry) => entry.data);
    if (!parsedActions.length) {
        return {
            context,
            payload: {
                inserted: 0,
            },
        };
    }
    const inserted = await recordActivities(context.session._id, context.identityId, context.user?._id ?? null, parsedActions, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        referrer: readHeader(request, "referer"),
    });
    const containsSearch = parsedActions.some((action) => action.actionType === "search");
    if (containsSearch && !context.user) {
        const db = await (0, mongodb_1.getMongoDb)();
        const { guestAttempts } = (0, collections_1.getAuthCollections)(db);
        await guestAttempts.updateOne({ identityId: context.identityId }, {
            $setOnInsert: {
                identityId: context.identityId,
                firstVisit: new Date(),
            },
            $set: {
                fingerprintId: context.fingerprintId,
                lastVisit: new Date(),
            },
            $inc: {
                attemptCount: 1,
            },
        }, { upsert: true });
    }
    const guestAccess = await resolveGuestAccessStatus(context.identityId, context.config);
    return {
        context,
        payload: {
            inserted: inserted.inserted,
            guestAccess,
        },
    };
}
