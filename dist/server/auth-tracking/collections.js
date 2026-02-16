"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED_ENTITIES_COLLECTION = exports.ADMIN_CONFIG_COLLECTION = exports.GUEST_ATTEMPTS_COLLECTION = exports.ACTIVITIES_COLLECTION = exports.SESSIONS_COLLECTION = exports.USER_PROFILES_COLLECTION = exports.USERS_COLLECTION = void 0;
exports.getAuthCollections = getAuthCollections;
exports.ensureAuthTrackingInitialized = ensureAuthTrackingInitialized;
const mongodb_1 = require("../mongodb");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
exports.USERS_COLLECTION = "users";
exports.USER_PROFILES_COLLECTION = "user_profiles";
exports.SESSIONS_COLLECTION = "sessions";
exports.ACTIVITIES_COLLECTION = "activities";
exports.GUEST_ATTEMPTS_COLLECTION = "guest_attempts";
exports.ADMIN_CONFIG_COLLECTION = "admin_config";
exports.BLOCKED_ENTITIES_COLLECTION = "blocked_entities";
let ensurePromise = null;
function getAuthCollections(db) {
    return {
        users: db.collection(exports.USERS_COLLECTION),
        userProfiles: db.collection(exports.USER_PROFILES_COLLECTION),
        sessions: db.collection(exports.SESSIONS_COLLECTION),
        activities: db.collection(exports.ACTIVITIES_COLLECTION),
        guestAttempts: db.collection(exports.GUEST_ATTEMPTS_COLLECTION),
        adminConfig: db.collection(exports.ADMIN_CONFIG_COLLECTION),
        blockedEntities: db.collection(exports.BLOCKED_ENTITIES_COLLECTION),
    };
}
function isIgnorableIndexError(error) {
    if (typeof error !== "object" || error === null)
        return false;
    const code = error.code;
    return code === 85 || code === 86 || code === 197;
}
async function createIndexSafely(collection, indexSpec, options = {}) {
    try {
        await collection.createIndex(indexSpec, options);
    }
    catch (error) {
        if (isIgnorableIndexError(error)) {
            return;
        }
        throw error;
    }
}
async function ensureIndexes(db) {
    const { users, userProfiles, sessions, activities, guestAttempts, adminConfig, blockedEntities, } = getAuthCollections(db);
    await Promise.all([
        createIndexSafely(users, { usernameLower: 1 }, { unique: true }),
        createIndexSafely(users, { role: 1, isBlocked: 1 }),
        createIndexSafely(users, { email: 1 }, { unique: true, sparse: true }),
        createIndexSafely(userProfiles, { userId: 1 }, { unique: true }),
        createIndexSafely(sessions, { userId: 1, isActive: 1, lastSeenAt: -1 }),
        createIndexSafely(sessions, { identityId: 1, lastSeenAt: -1 }),
        createIndexSafely(sessions, { fingerprintId: 1 }),
        createIndexSafely(sessions, { endTime: 1 }),
        createIndexSafely(activities, { timestamp: -1 }),
        createIndexSafely(activities, { userIdentifier: 1, timestamp: -1 }),
        createIndexSafely(activities, { actionType: 1, timestamp: -1 }),
        createIndexSafely(activities, { sessionId: 1 }),
        createIndexSafely(guestAttempts, { identityId: 1 }, { unique: true }),
        createIndexSafely(guestAttempts, { fingerprintId: 1 }),
        createIndexSafely(blockedEntities, { entityType: 1, entityId: 1 }, { unique: true }),
    ]);
}
async function ensureAdminConfigAndSuperAdmin(db) {
    const { adminConfig, users, userProfiles } = getAuthCollections(db);
    await adminConfig.updateOne({ _id: "system" }, {
        $setOnInsert: {
            _id: "system",
            guestAttemptLimit: config_1.authTrackingConfig.guestAttemptLimitDefault,
            registrationRequired: config_1.authTrackingConfig.registrationRequiredDefault,
            sessionTimeoutMinutes: config_1.authTrackingConfig.sessionTimeoutMinutes,
            dataRetentionDays: config_1.authTrackingConfig.dataRetentionDaysDefault,
            enableTracking: config_1.authTrackingConfig.trackingEnabledDefault,
            updatedAt: new Date(),
            updatedBy: "system",
        },
    }, { upsert: true });
    const username = config_1.authTrackingConfig.superAdminUsername.trim();
    const usernameLower = username.toLowerCase();
    const existingAdmin = await users.findOne({ usernameLower });
    if (existingAdmin) {
        if (existingAdmin.role !== "super_admin") {
            await users.updateOne({ _id: existingAdmin._id }, {
                $set: {
                    role: "super_admin",
                    updatedAt: new Date()
                }
            });
        }
        return;
    }
    const passwordHash = await (0, crypto_1.hashPassword)(config_1.authTrackingConfig.superAdminPassword);
    const now = new Date();
    const userId = (0, crypto_1.randomId)();
    await users.insertOne({
        _id: userId,
        username,
        usernameLower,
        passwordHash,
        role: "super_admin",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        isBlocked: false,
    });
    await userProfiles.updateOne({ userId }, {
        $setOnInsert: {
            userId,
            email: null,
            phone: null,
            additionalInfo: null,
            updatedAt: now,
        },
    }, { upsert: true });
}
async function ensureAuthTrackingInitialized() {
    if (!ensurePromise) {
        ensurePromise = (async () => {
            try {
                const db = await (0, mongodb_1.getMongoDb)();
                await ensureIndexes(db);
                await ensureAdminConfigAndSuperAdmin(db);
            }
            catch (error) {
                ensurePromise = null;
                throw error;
            }
        })();
    }
    await ensurePromise;
}
