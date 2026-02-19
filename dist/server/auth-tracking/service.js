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
exports.getAdminSourceRecordStats = getAdminSourceRecordStats;
exports.listAdminActivities = listAdminActivities;
exports.submitTrackingActions = submitTrackingActions;
const zod_1 = require("zod");
const mongodb_1 = require("../mongodb");
const harajScrape_1 = require("../models/harajScrape");
const syarah_1 = require("../models/syarah");
const yallaMotor_1 = require("../models/yallaMotor");
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
    identityIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(200).optional(),
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
function isWithinHours(value, hours) {
    if (!value)
        return false;
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp))
        return false;
    return Date.now() - timestamp <= hours * 60 * 60 * 1000;
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
const EPOCH_MILLISECONDS_THRESHOLD = 1_000_000_000_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const CARS_PAGE_HARAJ_TAG0 = "\u062d\u0631\u0627\u062c\u0020\u0627\u0644\u0633\u064a\u0627\u0631\u0627\u062a";
const CARS_PAGE_HARAJ_EXCLUDED_TAG1 = [
    "\u0642\u0637\u0639\u0020\u063a\u064a\u0627\u0631\u0020\u0648\u0645\u0644\u062d\u0642\u0627\u062a",
    "\u0634\u0627\u062d\u0646\u0627\u062a\u0020\u0648\u0645\u0639\u062f\u0627\u062a\u0020\u062b\u0642\u064a\u0644\u0629",
];
const SOURCE_COLLECTION_STATS_SPECS = [
    {
        sourceId: "haraj",
        sourceLabel: "Haraj",
        collectionName: harajScrape_1.HARAJ_SCRAPE_COLLECTION,
        collectionLabel: "Haraj Primary",
        dateFields: [
            { path: "lastSeenAt", mode: "date" },
            { path: "firstSeenAt", mode: "date" },
            { path: "postDate", mode: "epoch_mixed" },
            { path: "item.updateDate", mode: "epoch_mixed" },
            { path: "item.postDate", mode: "epoch_mixed" },
        ],
        priceFields: ["priceNumeric", "item.price.numeric", "item.price.formattedPrice"],
        imageFields: ["hasImage", "imagesList", "item.imagesList"],
        phoneFields: ["phone"],
    },
    {
        sourceId: "haraj",
        sourceLabel: "Haraj",
        collectionName: harajScrape_1.CARS_HARAJ_COLLECTION,
        collectionLabel: "CarsHaraj",
        dateFields: [
            { path: "lastSeenAt", mode: "date" },
            { path: "firstSeenAt", mode: "date" },
            { path: "postDate", mode: "epoch_mixed" },
            { path: "item.updateDate", mode: "epoch_mixed" },
            { path: "item.postDate", mode: "epoch_mixed" },
        ],
        priceFields: ["priceNumeric", "item.price.numeric", "item.price.formattedPrice"],
        imageFields: ["hasImage", "imagesList", "item.imagesList"],
        phoneFields: ["phone"],
    },
    {
        sourceId: "yallamotor",
        sourceLabel: "YallaMotor",
        collectionName: yallaMotor_1.YALLA_MOTOR_LEGACY_COLLECTION,
        collectionLabel: "Yalla Legacy",
        dateFields: [
            { path: "detailScrapedAt", mode: "date" },
            { path: "scrapedAt", mode: "date" },
            { path: "fetchedAt", mode: "date" },
            { path: "lastSeenAt", mode: "date" },
        ],
        priceFields: ["price", "cardPriceText", "priceComparison.markerPrice", "detail.priceBox"],
        imageFields: ["images", "detail.images"],
        phoneFields: ["phone"],
    },
    {
        sourceId: "yallamotor",
        sourceLabel: "YallaMotor",
        collectionName: yallaMotor_1.YALLA_MOTOR_USED_COLLECTION,
        collectionLabel: "Yalla Used",
        dateFields: [
            { path: "detailScrapedAt", mode: "date" },
            { path: "scrapedAt", mode: "date" },
            { path: "fetchedAt", mode: "date" },
            { path: "lastSeenAt", mode: "date" },
        ],
        priceFields: ["price", "cardPriceText", "priceComparison.markerPrice", "detail.priceBox"],
        imageFields: ["images", "detail.images"],
        phoneFields: ["phone"],
    },
    {
        sourceId: "yallamotor",
        sourceLabel: "YallaMotor",
        collectionName: yallaMotor_1.YALLA_MOTOR_NEW_CARS_COLLECTION,
        collectionLabel: "Yalla New Cars",
        dateFields: [
            { path: "detailScrapedAt", mode: "date" },
            { path: "scrapedAt", mode: "date" },
            { path: "fetchedAt", mode: "date" },
            { path: "lastSeenAt", mode: "date" },
        ],
        priceFields: ["price", "cardPriceText", "priceComparison.markerPrice", "detail.priceBox"],
        imageFields: ["images", "detail.images"],
        phoneFields: ["phone"],
    },
    {
        sourceId: "syarah",
        sourceLabel: "Syarah",
        collectionName: syarah_1.SYARAH_COLLECTION,
        collectionLabel: "Syarah",
        dateFields: [{ path: "fetchedAt", mode: "epoch_mixed" }],
        priceFields: ["price_cash", "price_monthly"],
        imageFields: ["images", "featured_image"],
        phoneFields: [],
    },
];
function roundToSingleDecimal(value) {
    return Math.round(value * 10) / 10;
}
function toCoveragePercentage(part, whole) {
    if (!whole)
        return 0;
    return roundToSingleDecimal((part / whole) * 100);
}
function pickOldestDate(values) {
    return values.reduce((oldest, value) => {
        if (!value)
            return oldest;
        if (!oldest)
            return value;
        return value.getTime() < oldest.getTime() ? value : oldest;
    }, null);
}
function pickNewestDate(values) {
    return values.reduce((newest, value) => {
        if (!value)
            return newest;
        if (!newest)
            return value;
        return value.getTime() > newest.getTime() ? value : newest;
    }, null);
}
function buildDateFieldExpression(spec) {
    const fieldValue = `$${spec.path}`;
    if (spec.mode === "epoch_seconds" || spec.mode === "epoch_mixed") {
        return {
            $let: {
                vars: {
                    numericValue: {
                        $convert: {
                            input: fieldValue,
                            to: "double",
                            onError: null,
                            onNull: null,
                        },
                    },
                    directDate: {
                        $convert: {
                            input: fieldValue,
                            to: "date",
                            onError: null,
                            onNull: null,
                        },
                    },
                },
                in: {
                    $ifNull: [
                        {
                            $convert: {
                                input: {
                                    $cond: [
                                        { $eq: ["$$numericValue", null] },
                                        null,
                                        spec.mode === "epoch_seconds"
                                            ? { $multiply: ["$$numericValue", 1000] }
                                            : {
                                                $cond: [
                                                    { $gt: ["$$numericValue", EPOCH_MILLISECONDS_THRESHOLD] },
                                                    "$$numericValue",
                                                    { $multiply: ["$$numericValue", 1000] },
                                                ],
                                            },
                                    ],
                                },
                                to: "date",
                                onError: null,
                                onNull: null,
                            },
                        },
                        "$$directDate",
                    ],
                },
            },
        };
    }
    return {
        $convert: {
            input: fieldValue,
            to: "date",
            onError: null,
            onNull: null,
        },
    };
}
function buildDateExpression(dateFields) {
    const [firstField, ...otherFields] = dateFields.map((field) => buildDateFieldExpression(field));
    if (!firstField)
        return null;
    return otherFields.reduce((expression, candidate) => ({
        $ifNull: [expression, candidate],
    }), firstField);
}
function buildFieldHasDataExpression(path) {
    const fieldValue = `$${path}`;
    return {
        $let: {
            vars: {
                value: fieldValue,
                valueType: { $type: fieldValue },
            },
            in: {
                $switch: {
                    branches: [
                        {
                            case: { $in: ["$$valueType", ["missing", "null", "undefined"]] },
                            then: false,
                        },
                        {
                            case: { $eq: ["$$valueType", "bool"] },
                            then: "$$value",
                        },
                        {
                            case: { $eq: ["$$valueType", "array"] },
                            then: { $gt: [{ $size: "$$value" }, 0] },
                        },
                        {
                            case: { $eq: ["$$valueType", "object"] },
                            then: { $gt: [{ $size: { $objectToArray: "$$value" } }, 0] },
                        },
                        {
                            case: { $eq: ["$$valueType", "string"] },
                            then: {
                                $gt: [{ $strLenCP: { $trim: { input: "$$value" } } }, 0],
                            },
                        },
                        {
                            case: {
                                $in: ["$$valueType", ["int", "long", "double", "decimal"]],
                            },
                            then: { $ne: ["$$value", 0] },
                        },
                        {
                            case: { $eq: ["$$valueType", "date"] },
                            then: true,
                        },
                    ],
                    default: true,
                },
            },
        },
    };
}
function buildAnyFieldHasDataExpression(paths) {
    if (!paths.length) {
        return {
            $literal: false,
        };
    }
    const checks = paths.map((path) => buildFieldHasDataExpression(path));
    if (checks.length === 1) {
        return checks[0];
    }
    return {
        $or: checks,
    };
}
async function collectSourceCollectionStats(db, spec, generatedAt, filter = {}) {
    const collection = db.collection(spec.collectionName);
    const dateExpression = buildDateExpression(spec.dateFields);
    const hasPriceExpression = buildAnyFieldHasDataExpression(spec.priceFields);
    const hasImageExpression = buildAnyFieldHasDataExpression(spec.imageFields);
    const hasPhoneExpression = buildAnyFieldHasDataExpression(spec.phoneFields);
    const since24Hours = new Date(generatedAt.getTime() - ONE_DAY_MS);
    const since7Days = new Date(generatedAt.getTime() - ONE_DAY_MS * 7);
    const pipeline = [];
    if (Object.keys(filter).length > 0) {
        pipeline.push({
            $match: filter,
        });
    }
    pipeline.push({
        $project: {
            statsDate: dateExpression,
            hasPrice: hasPriceExpression,
            hasImages: hasImageExpression,
            hasPhone: hasPhoneExpression,
        },
    }, {
        $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            oldestRecordAt: { $min: "$statsDate" },
            newestRecordAt: { $max: "$statsDate" },
            recordsInLast24Hours: {
                $sum: {
                    $cond: [
                        {
                            $and: [
                                { $ne: ["$statsDate", null] },
                                { $gte: ["$statsDate", since24Hours] },
                            ],
                        },
                        1,
                        0,
                    ],
                },
            },
            recordsInLast7Days: {
                $sum: {
                    $cond: [
                        {
                            $and: [
                                { $ne: ["$statsDate", null] },
                                { $gte: ["$statsDate", since7Days] },
                            ],
                        },
                        1,
                        0,
                    ],
                },
            },
            recordsWithPrice: {
                $sum: {
                    $cond: ["$hasPrice", 1, 0],
                },
            },
            recordsWithImages: {
                $sum: {
                    $cond: ["$hasImages", 1, 0],
                },
            },
            recordsWithPhone: {
                $sum: {
                    $cond: ["$hasPhone", 1, 0],
                },
            },
        },
    });
    const [aggregate] = await collection
        .aggregate(pipeline)
        .toArray();
    const fallback = {
        totalRecords: 0,
        oldestRecordAt: null,
        newestRecordAt: null,
        recordsInLast24Hours: 0,
        recordsInLast7Days: 0,
        recordsWithPrice: 0,
        recordsWithImages: 0,
        recordsWithPhone: 0,
    };
    const row = aggregate ?? fallback;
    return {
        sourceId: spec.sourceId,
        sourceLabel: spec.sourceLabel,
        collectionName: spec.collectionName,
        collectionLabel: spec.collectionLabel,
        totalRecords: row.totalRecords ?? 0,
        oldestRecordAt: row.oldestRecordAt ?? null,
        newestRecordAt: row.newestRecordAt ?? null,
        recordsInLast24Hours: row.recordsInLast24Hours ?? 0,
        recordsInLast7Days: row.recordsInLast7Days ?? 0,
        recordsWithPrice: row.recordsWithPrice ?? 0,
        recordsWithImages: row.recordsWithImages ?? 0,
        recordsWithPhone: row.recordsWithPhone ?? 0,
    };
}
function summarizeRecordStats(rows) {
    return {
        totalRecords: rows.reduce((sum, row) => sum + row.totalRecords, 0),
        oldestRecordAt: pickOldestDate(rows.map((row) => row.oldestRecordAt)),
        newestRecordAt: pickNewestDate(rows.map((row) => row.newestRecordAt)),
        recordsInLast24Hours: rows.reduce((sum, row) => sum + row.recordsInLast24Hours, 0),
        recordsInLast7Days: rows.reduce((sum, row) => sum + row.recordsInLast7Days, 0),
    };
}
function buildCarsPageHarajFilter() {
    return {
        $and: [
            {
                $or: [
                    { "tags.0": CARS_PAGE_HARAJ_TAG0 },
                    { "item.tags.0": CARS_PAGE_HARAJ_TAG0 },
                ],
            },
            {
                $nor: [
                    { "tags.1": { $in: CARS_PAGE_HARAJ_EXCLUDED_TAG1 } },
                    { "item.tags.1": { $in: CARS_PAGE_HARAJ_EXCLUDED_TAG1 } },
                    { "gql.posts.json.data.posts.items.tags.1": { $in: CARS_PAGE_HARAJ_EXCLUDED_TAG1 } },
                ],
            },
        ],
    };
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
    const [identitySessionStats, userDocs, guestDocs, blockedDocs] = await Promise.all([
        sessions
            .aggregate([
            {
                $sort: { lastSeenAt: -1 },
            },
            {
                $group: {
                    _id: "$identityId",
                    userId: { $max: "$userId" },
                    localBackupId: { $max: "$localBackupId" },
                    totalSessions: { $sum: 1 },
                    activeSessions: {
                        $sum: {
                            $cond: [{ $eq: ["$isActive", true] }, 1, 0],
                        },
                    },
                    totalDurationMs: { $sum: { $ifNull: ["$durationMs", 0] } },
                    lastActiveAt: { $max: "$lastSeenAt" },
                    firstSeenAt: { $min: "$firstVisitAt" },
                    lastSessionId: { $first: "$_id" },
                    primaryIpAddress: { $first: "$geo.ipAddress" },
                    deviceTypes: { $addToSet: "$device.type" },
                },
            },
        ])
            .toArray(),
        users.find().toArray(),
        guestAttempts.find().toArray(),
        blockedEntities.find({ entityType: "identity" }).toArray(),
    ]);
    const usersById = new Map(userDocs.map((user) => [user._id, user]));
    const guestAttemptsByIdentity = new Map(guestDocs.map((item) => [item.identityId, item.attemptCount]));
    const blockedIdentitySet = new Set(blockedDocs.map((item) => item.entityId));
    const toTimestamp = (value) => {
        if (!value)
            return 0;
        const timestamp = value.getTime();
        return Number.isNaN(timestamp) ? 0 : timestamp;
    };
    const identityNodes = identitySessionStats.map((item) => ({
        identityId: item._id,
        userId: item.userId ?? null,
        localBackupId: normalizeOptionalText(item.localBackupId) ?? null,
        totalSessions: item.totalSessions ?? 0,
        activeSessions: item.activeSessions ?? 0,
        totalDurationMs: item.totalDurationMs ?? 0,
        lastActiveAt: item.lastActiveAt ?? null,
        firstSeenAt: item.firstSeenAt ?? null,
        lastSessionId: item.lastSessionId ?? null,
        primaryIpAddress: normalizeOptionalText(item.primaryIpAddress) ?? null,
        deviceTypes: Array.from(new Set((item.deviceTypes ?? [])
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0))),
        attemptsUsed: guestAttemptsByIdentity.get(item._id) ?? 0,
        isIdentityBlocked: blockedIdentitySet.has(item._id),
    }));
    const registeredBuckets = new Map();
    const guestBuckets = new Map();
    for (const node of identityNodes) {
        if (node.userId && usersById.has(node.userId)) {
            const existing = registeredBuckets.get(node.userId) ?? [];
            existing.push(node);
            registeredBuckets.set(node.userId, existing);
            continue;
        }
        const guestKey = node.localBackupId
            ? `local:${node.localBackupId}`
            : `identity:${node.identityId}`;
        const existing = guestBuckets.get(guestKey) ?? [];
        existing.push(node);
        guestBuckets.set(guestKey, existing);
    }
    const buildRowFromNodes = (nodes, options) => {
        const uniqueIdentityIds = Array.from(new Set(nodes.map((node) => node.identityId).filter((value) => value.length > 0)));
        const uniqueDeviceTypes = Array.from(new Set(nodes
            .flatMap((node) => node.deviceTypes)
            .filter((value) => value.length > 0)));
        const totalSessions = nodes.reduce((sum, node) => sum + node.totalSessions, 0);
        const activeSessions = nodes.reduce((sum, node) => sum + node.activeSessions, 0);
        const totalDurationMs = nodes.reduce((sum, node) => sum + node.totalDurationMs, 0);
        const attemptsUsed = nodes.reduce((sum, node) => sum + node.attemptsUsed, 0);
        const primaryNode = nodes
            .slice()
            .sort((left, right) => toTimestamp(right.lastActiveAt) - toTimestamp(left.lastActiveAt))[0] ??
            nodes[0];
        const lastActiveAt = nodes.length > 0
            ? new Date(Math.max(...nodes.map((node) => toTimestamp(node.lastActiveAt))))
            : null;
        const firstSeenAt = nodes.length > 0
            ? new Date(Math.min(...nodes.map((node) => {
                const timestamp = toTimestamp(node.firstSeenAt);
                return timestamp > 0 ? timestamp : Number.MAX_SAFE_INTEGER;
            })))
            : null;
        return {
            entityId: options.entityId,
            identityId: primaryNode?.identityId ?? "",
            identityIds: uniqueIdentityIds,
            identityCount: uniqueIdentityIds.length,
            guestGroupKey: options.guestGroupKey,
            localBackupId: options.localBackupId,
            lastSessionId: primaryNode?.lastSessionId ?? null,
            primaryIpAddress: primaryNode?.primaryIpAddress ?? null,
            deviceTypes: uniqueDeviceTypes,
            userId: options.userId,
            username: options.username,
            role: options.role,
            registrationStatus: options.registrationStatus,
            registrationDate: options.registrationDate,
            lastActiveAt: toIso(lastActiveAt),
            firstSeenAt: firstSeenAt && Number.isFinite(firstSeenAt.getTime()) && firstSeenAt.getTime() < Number.MAX_SAFE_INTEGER
                ? toIso(firstSeenAt)
                : null,
            totalSessions,
            activeSessions,
            totalDurationMs,
            attemptsUsed,
            attemptsRemaining: options.registrationStatus === "guest"
                ? Math.max(context.config.guestAttemptLimit - attemptsUsed, 0)
                : 0,
            isBlocked: options.isBlocked,
        };
    };
    const registeredRows = Array.from(registeredBuckets.entries())
        .map(([userId, nodes]) => {
        const user = usersById.get(userId);
        if (!user)
            return null;
        const latestNode = nodes
            .slice()
            .sort((left, right) => toTimestamp(right.lastActiveAt) - toTimestamp(left.lastActiveAt))[0] ??
            nodes[0];
        return buildRowFromNodes(nodes, {
            entityId: `user:${user._id}`,
            userId: user._id,
            username: user.username,
            role: user.role,
            registrationStatus: "registered",
            registrationDate: user.createdAt?.toISOString() ?? null,
            isBlocked: Boolean(user.isBlocked),
            localBackupId: latestNode?.localBackupId ?? null,
            guestGroupKey: null,
        });
    })
        .filter((row) => Boolean(row));
    const guestRows = Array.from(guestBuckets.entries()).map(([guestKey, nodes]) => {
        const latestNode = nodes
            .slice()
            .sort((left, right) => toTimestamp(right.lastActiveAt) - toTimestamp(left.lastActiveAt))[0] ??
            nodes[0];
        const displayName = latestNode?.localBackupId
            ? `Guest ${latestNode.localBackupId.slice(0, 8)}`
            : "Guest Visitor";
        return {
            ...buildRowFromNodes(nodes, {
                entityId: guestKey,
                userId: null,
                username: displayName,
                role: "guest",
                registrationStatus: "guest",
                registrationDate: null,
                isBlocked: nodes.some((node) => node.isIdentityBlocked),
                localBackupId: latestNode?.localBackupId ?? null,
                guestGroupKey: guestKey,
            }),
        };
    });
    const rows = [...registeredRows, ...guestRows];
    const searchQuery = typeof request.query.search === "string"
        ? request.query.search.trim().toLowerCase()
        : "";
    const registrationFilter = request.query.registrationStatus === "registered" ||
        request.query.registrationStatus === "guest"
        ? request.query.registrationStatus
        : "all";
    const accessState = request.query.accessState === "blocked" || request.query.accessState === "active"
        ? request.query.accessState
        : "all";
    const page = Math.max(1, Number(typeof request.query.page === "string" ? request.query.page : "1"));
    const limit = Math.min(100, Math.max(5, Number(typeof request.query.limit === "string" ? request.query.limit : "20")));
    const sortedRows = rows.sort((a, b) => {
        const left = new Date(a.lastActiveAt ?? 0).getTime();
        const right = new Date(b.lastActiveAt ?? 0).getTime();
        return right - left;
    });
    const filteredRows = sortedRows.filter((row) => {
        if (registrationFilter !== "all" && row.registrationStatus !== registrationFilter) {
            return false;
        }
        if (accessState === "blocked" && !row.isBlocked)
            return false;
        if (accessState === "active" && row.isBlocked)
            return false;
        if (!searchQuery)
            return true;
        const searchable = [
            row.entityId,
            row.username,
            row.userId ?? "",
            row.identityId,
            row.lastSessionId ?? "",
            row.localBackupId ?? "",
            row.primaryIpAddress ?? "",
            row.registrationStatus,
            row.role,
            ...row.identityIds,
            ...row.deviceTypes,
        ]
            .join(" ")
            .toLowerCase();
        return searchable.includes(searchQuery);
    });
    const total = filteredRows.length;
    const start = (page - 1) * limit;
    const usersPage = filteredRows.slice(start, start + limit);
    const summary = filteredRows.reduce((acc, row) => {
        acc.total += 1;
        if (row.registrationStatus === "registered") {
            acc.registered += 1;
        }
        else {
            acc.guests += 1;
            if (row.identityCount > 1) {
                acc.guestWithMultipleIdentities += 1;
            }
            acc.maxGuestIdentityCount = Math.max(acc.maxGuestIdentityCount, row.identityCount);
        }
        if (row.isBlocked) {
            acc.blocked += 1;
        }
        if (isWithinHours(row.lastActiveAt, 24)) {
            acc.activeInLast24Hours += 1;
            if (row.registrationStatus === "guest") {
                acc.activeGuestInLast24Hours += 1;
            }
        }
        return acc;
    }, {
        total: 0,
        registered: 0,
        guests: 0,
        blocked: 0,
        activeInLast24Hours: 0,
        activeGuestInLast24Hours: 0,
        guestWithMultipleIdentities: 0,
        maxGuestIdentityCount: 0,
    });
    return {
        context,
        payload: {
            users: usersPage,
            total,
            page,
            limit,
            hasNext: start + limit < total,
            summary,
            config: context.config,
        },
    };
}
async function updateAdminUserState(request, body) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    const adminUserId = context.user._id;
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
        const normalizedIdentityIds = Array.from(new Set((payload.identityIds ?? [])
            .map((value) => value.trim())
            .filter((value) => value.length > 0)));
        const targetIdentityIds = normalizedIdentityIds.length > 0
            ? normalizedIdentityIds
            : [payload.targetId];
        if (payload.action === "block") {
            await blockedEntities.bulkWrite(targetIdentityIds.map((identityId) => ({
                updateOne: {
                    filter: {
                        entityType: "identity",
                        entityId: identityId,
                    },
                    update: {
                        $set: {
                            entityType: "identity",
                            entityId: identityId,
                            reason: payload.reason ?? "Blocked by admin",
                            blockedAt: new Date(),
                            blockedBy: adminUserId,
                        },
                    },
                    upsert: true,
                },
            })), { ordered: false });
            await sessions.updateMany({
                identityId: { $in: targetIdentityIds },
                isActive: true,
            }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
        else if (payload.action === "unblock") {
            await blockedEntities.deleteMany({
                entityType: "identity",
                entityId: { $in: targetIdentityIds },
            });
        }
        else {
            await sessions.updateMany({
                identityId: { $in: targetIdentityIds },
                isActive: true,
            }, {
                $set: {
                    isActive: false,
                    endTime: new Date(),
                    lastSeenAt: new Date(),
                },
            });
        }
    }
    await recordActivities(context.session._id, context.identityId, adminUserId, [
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
async function getAdminSourceRecordStats(request) {
    const context = await (0, context_1.resolveRequestContext)(request);
    assertAdminUser(context.user, context.isUserBlocked);
    const db = await (0, mongodb_1.getMongoDb)();
    const generatedAt = new Date();
    const collections = await Promise.all(SOURCE_COLLECTION_STATS_SPECS.map((spec) => collectSourceCollectionStats(db, spec, generatedAt)));
    const sourceMap = new Map();
    for (const collection of collections) {
        const existing = sourceMap.get(collection.sourceId);
        if (existing) {
            existing.collections.push(collection);
            continue;
        }
        sourceMap.set(collection.sourceId, {
            sourceId: collection.sourceId,
            sourceLabel: collection.sourceLabel,
            collections: [collection],
        });
    }
    const sources = Array.from(sourceMap.values())
        .map((source) => {
        const totalRecords = source.collections.reduce((sum, collection) => sum + collection.totalRecords, 0);
        const recordsInLast24Hours = source.collections.reduce((sum, collection) => sum + collection.recordsInLast24Hours, 0);
        const recordsInLast7Days = source.collections.reduce((sum, collection) => sum + collection.recordsInLast7Days, 0);
        const recordsWithPrice = source.collections.reduce((sum, collection) => sum + collection.recordsWithPrice, 0);
        const recordsWithImages = source.collections.reduce((sum, collection) => sum + collection.recordsWithImages, 0);
        const recordsWithPhone = source.collections.reduce((sum, collection) => sum + collection.recordsWithPhone, 0);
        const oldestRecordAt = pickOldestDate(source.collections.map((collection) => collection.oldestRecordAt));
        const newestRecordAt = pickNewestDate(source.collections.map((collection) => collection.newestRecordAt));
        const largestCollection = source.collections.reduce((best, collection) => {
            if (!best || collection.totalRecords > best.totalRecords) {
                return collection;
            }
            return best;
        }, null);
        const freshestCollection = source.collections.reduce((best, collection) => {
            if (!collection.newestRecordAt)
                return best;
            if (!best || !best.newestRecordAt)
                return collection;
            return collection.newestRecordAt.getTime() > best.newestRecordAt.getTime()
                ? collection
                : best;
        }, null);
        return {
            sourceId: source.sourceId,
            sourceLabel: source.sourceLabel,
            collectionCount: source.collections.length,
            totalRecords,
            oldestRecordAt: toIso(oldestRecordAt),
            newestRecordAt: toIso(newestRecordAt),
            recordsInLast24Hours,
            recordsInLast7Days,
            recordsWithPrice,
            recordsWithImages,
            recordsWithPhone,
            priceCoverage: toCoveragePercentage(recordsWithPrice, totalRecords),
            imageCoverage: toCoveragePercentage(recordsWithImages, totalRecords),
            phoneCoverage: toCoveragePercentage(recordsWithPhone, totalRecords),
            largestCollection: largestCollection
                ? {
                    collectionId: largestCollection.collectionName,
                    collectionName: largestCollection.collectionLabel,
                    totalRecords: largestCollection.totalRecords,
                }
                : null,
            freshestCollection: freshestCollection && freshestCollection.newestRecordAt
                ? {
                    collectionId: freshestCollection.collectionName,
                    collectionName: freshestCollection.collectionLabel,
                    newestRecordAt: freshestCollection.newestRecordAt.toISOString(),
                }
                : null,
            collections: source.collections
                .slice()
                .sort((left, right) => right.totalRecords - left.totalRecords)
                .map((collection) => ({
                collectionId: collection.collectionName,
                collectionName: collection.collectionLabel,
                totalRecords: collection.totalRecords,
                oldestRecordAt: toIso(collection.oldestRecordAt),
                newestRecordAt: toIso(collection.newestRecordAt),
                recordsInLast24Hours: collection.recordsInLast24Hours,
                recordsInLast7Days: collection.recordsInLast7Days,
                recordsWithPrice: collection.recordsWithPrice,
                recordsWithImages: collection.recordsWithImages,
                recordsWithPhone: collection.recordsWithPhone,
                priceCoverage: toCoveragePercentage(collection.recordsWithPrice, collection.totalRecords),
                imageCoverage: toCoveragePercentage(collection.recordsWithImages, collection.totalRecords),
                phoneCoverage: toCoveragePercentage(collection.recordsWithPhone, collection.totalRecords),
            })),
        };
    })
        .sort((left, right) => right.totalRecords - left.totalRecords);
    const harajCollections = collections.filter((collection) => collection.sourceId === "haraj");
    const yallaCollections = collections.filter((collection) => collection.sourceId === "yallamotor");
    const syarahCollections = collections.filter((collection) => collection.sourceId === "syarah");
    const otherPageHarajSummary = summarizeRecordStats(harajCollections);
    const carsPageYallaSummary = summarizeRecordStats(yallaCollections);
    const carsPageSyarahSummary = summarizeRecordStats(syarahCollections);
    const filteredCarsHarajCollections = await Promise.all(SOURCE_COLLECTION_STATS_SPECS.filter((spec) => spec.sourceId === "haraj").map((spec) => collectSourceCollectionStats(db, spec, generatedAt, buildCarsPageHarajFilter())));
    const carsPageHarajSummary = summarizeRecordStats(filteredCarsHarajCollections);
    const carsPageSummary = summarizeRecordStats([
        carsPageHarajSummary,
        carsPageYallaSummary,
        carsPageSyarahSummary,
    ]);
    const pages = [
        {
            pageId: "cars",
            pageLabel: "Cars",
            totalRecords: carsPageSummary.totalRecords,
            oldestRecordAt: toIso(carsPageSummary.oldestRecordAt),
            newestRecordAt: toIso(carsPageSummary.newestRecordAt),
            recordsInLast24Hours: carsPageSummary.recordsInLast24Hours,
            recordsInLast7Days: carsPageSummary.recordsInLast7Days,
            sources: [
                {
                    sourceId: "haraj",
                    sourceLabel: "Haraj (Cars Filters)",
                    totalRecords: carsPageHarajSummary.totalRecords,
                    recordsInLast24Hours: carsPageHarajSummary.recordsInLast24Hours,
                    recordsInLast7Days: carsPageHarajSummary.recordsInLast7Days,
                },
                {
                    sourceId: "yallamotor",
                    sourceLabel: "YallaMotor",
                    totalRecords: carsPageYallaSummary.totalRecords,
                    recordsInLast24Hours: carsPageYallaSummary.recordsInLast24Hours,
                    recordsInLast7Days: carsPageYallaSummary.recordsInLast7Days,
                },
                {
                    sourceId: "syarah",
                    sourceLabel: "Syarah",
                    totalRecords: carsPageSyarahSummary.totalRecords,
                    recordsInLast24Hours: carsPageSyarahSummary.recordsInLast24Hours,
                    recordsInLast7Days: carsPageSyarahSummary.recordsInLast7Days,
                },
            ].sort((left, right) => right.totalRecords - left.totalRecords),
        },
        {
            pageId: "other",
            pageLabel: "Other",
            totalRecords: otherPageHarajSummary.totalRecords,
            oldestRecordAt: toIso(otherPageHarajSummary.oldestRecordAt),
            newestRecordAt: toIso(otherPageHarajSummary.newestRecordAt),
            recordsInLast24Hours: otherPageHarajSummary.recordsInLast24Hours,
            recordsInLast7Days: otherPageHarajSummary.recordsInLast7Days,
            sources: [
                {
                    sourceId: "haraj",
                    sourceLabel: "Haraj",
                    totalRecords: otherPageHarajSummary.totalRecords,
                    recordsInLast24Hours: otherPageHarajSummary.recordsInLast24Hours,
                    recordsInLast7Days: otherPageHarajSummary.recordsInLast7Days,
                },
            ],
        },
    ];
    const totalRecords = collections.reduce((sum, collection) => sum + collection.totalRecords, 0);
    const recordsInLast24Hours = collections.reduce((sum, collection) => sum + collection.recordsInLast24Hours, 0);
    const recordsInLast7Days = collections.reduce((sum, collection) => sum + collection.recordsInLast7Days, 0);
    const recordsWithPrice = collections.reduce((sum, collection) => sum + collection.recordsWithPrice, 0);
    const recordsWithImages = collections.reduce((sum, collection) => sum + collection.recordsWithImages, 0);
    const recordsWithPhone = collections.reduce((sum, collection) => sum + collection.recordsWithPhone, 0);
    const oldestRecordAt = pickOldestDate(collections.map((collection) => collection.oldestRecordAt));
    const newestRecordAt = pickNewestDate(collections.map((collection) => collection.newestRecordAt));
    return {
        context,
        payload: {
            overview: {
                totalSources: sources.length,
                totalCollections: collections.length,
                totalRecords,
                oldestRecordAt: toIso(oldestRecordAt),
                newestRecordAt: toIso(newestRecordAt),
                recordsInLast24Hours,
                recordsInLast7Days,
                recordsWithPrice,
                recordsWithImages,
                recordsWithPhone,
                priceCoverage: toCoveragePercentage(recordsWithPrice, totalRecords),
                imageCoverage: toCoveragePercentage(recordsWithImages, totalRecords),
                phoneCoverage: toCoveragePercentage(recordsWithPhone, totalRecords),
            },
            sources,
            pages,
            generatedAt: generatedAt.toISOString(),
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
