"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED_ENTITIES_COLLECTION = exports.ADMIN_CONFIG_COLLECTION = exports.GUEST_ATTEMPTS_COLLECTION = exports.ACTIVITIES_COLLECTION = exports.SESSIONS_COLLECTION = exports.USER_PROFILES_COLLECTION = exports.USER_COMPANY_MEMBERSHIPS_COLLECTION = exports.COMPANIES_COLLECTION = exports.USERS_COLLECTION = void 0;
exports.getAuthCollections = getAuthCollections;
exports.ensureAuthTrackingInitialized = ensureAuthTrackingInitialized;
const mongodb_1 = require("../mongodb");
const config_1 = require("./config");
const crypto_1 = require("./crypto");
exports.USERS_COLLECTION = "users";
exports.COMPANIES_COLLECTION = "companies";
exports.USER_COMPANY_MEMBERSHIPS_COLLECTION = "user_company_memberships";
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
        companies: db.collection(exports.COMPANIES_COLLECTION),
        userCompanyMemberships: db.collection(exports.USER_COMPANY_MEMBERSHIPS_COLLECTION),
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
async function migrateUsersUsernameLowerField(db) {
    const { users } = getAuthCollections(db);
    const brokenFilter = {
        username: { $exists: true, $type: "string", $ne: "" },
        $or: [
            { usernameLower: { $exists: false } },
            { usernameLower: "" },
            { usernameLower: null },
        ],
    };
    const broken = await users
        .find(brokenFilter)
        .project({ _id: 1, username: 1 })
        .toArray();
    const now = new Date();
    for (const doc of broken) {
        const u = typeof doc.username === "string" ? doc.username.trim() : "";
        if (!u)
            continue;
        await users.updateOne({ _id: doc._id }, { $set: { usernameLower: u.toLowerCase(), updatedAt: now } });
    }
}
async function replaceUsersUsernameLowerUniqueIndex(db) {
    const { users } = getAuthCollections(db);
    const indexes = await users.indexes();
    for (const idx of indexes) {
        const key = idx.key;
        if (!key || Object.keys(key).length !== 1 || key.usernameLower !== 1)
            continue;
        const name = idx.name;
        if (!name || name === "_id_")
            continue;
        try {
            await users.dropIndex(name);
        }
        catch {
        }
        break;
    }
    try {
        await users.createIndex({ usernameLower: 1 }, {
            unique: true,
            partialFilterExpression: { usernameLower: { $type: "string" } },
        });
    }
    catch (error) {
        if (!isIgnorableIndexError(error)) {
            throw error;
        }
    }
}
async function ensureIndexes(db) {
    const { users, companies, userCompanyMemberships, userProfiles, sessions, activities, guestAttempts, adminConfig, blockedEntities, } = getAuthCollections(db);
    await migrateUsersUsernameLowerField(db);
    await replaceUsersUsernameLowerUniqueIndex(db);
    await Promise.all([
        createIndexSafely(users, { role: 1, isBlocked: 1 }),
        createIndexSafely(users, { company: 1 }, { sparse: true }),
        createIndexSafely(users, { email: 1 }, { unique: true, sparse: true }),
        createIndexSafely(companies, { name: 1 }),
        createIndexSafely(userCompanyMemberships, { userId: 1, companyId: 1 }, { unique: true }),
        createIndexSafely(userCompanyMemberships, { companyId: 1 }),
        createIndexSafely(userCompanyMemberships, { userId: 1 }),
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
                    updatedAt: new Date(),
                },
                $unset: { company: "", companyId: "", company_id: "" },
            });
        }
        return;
    }
    const passwordHash = await (0, crypto_1.hashPassword)(config_1.authTrackingConfig.superAdminPassword);
    const now = new Date();
    const insertResult = await users.insertOne({
        username,
        usernameLower,
        passwordHash,
        role: "super_admin",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        isBlocked: false,
    });
    const userId = insertResult.insertedId;
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
function membershipRoleFromLegacyUserRole(role) {
    if (role === "company_admin")
        return "company_admin";
    if (role === "viewer" || role === "valuer")
        return "valuer";
    if (role === "data_entry")
        return "data_entry";
    if (role === "reviewer")
        return "reviewer";
    if (role === "inspector")
        return "inspector";
    return "valuer";
}
async function migrateLegacyViewerRoleToValuer(db) {
    const now = new Date();
    const { users, userCompanyMemberships } = getAuthCollections(db);
    await users.updateMany({ role: "viewer" }, {
        $set: { role: "valuer", updatedAt: now },
    });
    await userCompanyMemberships.updateMany({ role: "viewer" }, { $set: { role: "valuer", updatedAt: now } });
}
async function migrateLegacyUserCompanyToMemberships(db) {
    const { users, userCompanyMemberships } = getAuthCollections(db);
    const legacyFilter = {
        companyId: { $exists: true, $nin: [null, ""] },
    };
    const legacy = await db.collection(exports.USERS_COLLECTION).find(legacyFilter).toArray();
    const now = new Date();
    for (const raw of legacy) {
        const u = raw;
        const cid = u.companyId;
        if (!cid)
            continue;
        const exists = await userCompanyMemberships.findOne({
            userId: u._id,
            companyId: cid,
        });
        if (exists) {
            await users.updateOne({ _id: u._id }, {
                $set: { company: cid, updatedAt: now },
                $unset: { companyId: "", company_id: "" },
            });
            continue;
        }
        const memRole = u.role === "super_admin" ? "company_admin" : membershipRoleFromLegacyUserRole(u.role);
        await userCompanyMemberships.insertOne({
            userId: u._id,
            companyId: cid,
            role: memRole,
            createdAt: u.createdAt ?? now,
            updatedAt: now,
        });
        if (u.role === "super_admin") {
            await users.updateOne({ _id: u._id }, {
                $set: { role: "super_admin", updatedAt: now },
                $unset: { companyId: "", company: "", company_id: "" },
            });
        }
        else {
            await users.updateOne({ _id: u._id }, {
                $set: {
                    role: memRole,
                    company: cid,
                    updatedAt: now,
                },
                $unset: { companyId: "", company_id: "" },
            });
        }
    }
}
async function backfillUserRoleAndCompanyFromMemberships(db) {
    const { users, userCompanyMemberships } = getAuthCollections(db);
    const rawIds = await userCompanyMemberships.distinct("userId");
    const now = new Date();
    for (const userId of rawIds) {
        const oid = userId;
        const u = await users.findOne({ _id: oid });
        if (!u || u.role === "super_admin")
            continue;
        const all = await userCompanyMemberships.find({ userId: oid }).toArray();
        if (all.length === 0)
            continue;
        const adminMem = all.find((x) => x.role === "company_admin");
        const primary = adminMem ?? all[0];
        const newRole = primary.role === "company_admin" ? "company_admin" : primary.role;
        await users.updateOne({ _id: oid }, {
            $set: {
                role: newRole,
                company: primary.companyId,
                updatedAt: now,
            },
            $unset: { companyId: "", company_id: "" },
        });
    }
}
async function stripDuplicateCompanyKeysOnUsers(db) {
    const { users } = getAuthCollections(db);
    await users.updateMany({ $or: [{ companyId: { $exists: true } }, { company_id: { $exists: true } }] }, { $unset: { companyId: "", company_id: "" } });
}
async function syncCompanyAdminMemberships(db) {
    const { companies, userCompanyMemberships } = getAuthCollections(db);
    const now = new Date();
    const rows = await companies.find({}).toArray();
    for (const c of rows) {
        if (!c.adminUserId)
            continue;
        const ex = await userCompanyMemberships.findOne({
            userId: c.adminUserId,
            companyId: c._id,
        });
        if (!ex) {
            await userCompanyMemberships.insertOne({
                userId: c.adminUserId,
                companyId: c._id,
                role: "company_admin",
                createdAt: now,
                updatedAt: now,
            });
        }
    }
}
async function backfillCompanyDocuments(db) {
    const { companies, userCompanyMemberships } = getAuthCollections(db);
    await companies.updateMany({ memberUserIds: { $exists: true } }, { $unset: { memberUserIds: "" } });
    const rows = await companies.find({}).toArray();
    for (const c of rows) {
        if (c.adminUserId)
            continue;
        const adminMem = await userCompanyMemberships.findOne({
            companyId: c._id,
            role: "company_admin",
        });
        if (!adminMem)
            continue;
        await companies.updateOne({ _id: c._id }, { $set: { adminUserId: adminMem.userId, updatedAt: new Date() } });
    }
}
async function ensureAuthTrackingInitialized() {
    if (!ensurePromise) {
        ensurePromise = (async () => {
            try {
                const db = await (0, mongodb_1.getMongoDb)();
                await ensureIndexes(db);
                await ensureAdminConfigAndSuperAdmin(db);
                await migrateLegacyViewerRoleToValuer(db);
                await migrateLegacyUserCompanyToMemberships(db);
                await syncCompanyAdminMemberships(db);
                await backfillCompanyDocuments(db);
                await backfillUserRoleAndCompanyFromMemberships(db);
                await stripDuplicateCompanyKeysOnUsers(db);
            }
            catch (error) {
                ensurePromise = null;
                throw error;
            }
        })();
    }
    await ensurePromise;
}
