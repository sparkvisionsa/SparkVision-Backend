import type {
  Collection,
  CreateIndexesOptions,
  Db,
  Document,
  Filter,
  IndexSpecification,
} from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import { authTrackingConfig } from "./config";
import { hashPassword } from "./crypto";
import type {
  ActivityDoc,
  AdminConfigDoc,
  BlockedEntityDoc,
  CompanyDoc,
  CompanyMembershipRole,
  GuestAttemptDoc,
  SessionDoc,
  UserCompanyMembershipDoc,
  UserDoc,
  UserMongoDoc,
  UserProfileDoc,
  UserRole,
} from "./types";

export const USERS_COLLECTION = "users";
export const COMPANIES_COLLECTION = "companies";
export const USER_COMPANY_MEMBERSHIPS_COLLECTION = "user_company_memberships";
export const USER_PROFILES_COLLECTION = "user_profiles";
export const SESSIONS_COLLECTION = "sessions";
export const ACTIVITIES_COLLECTION = "activities";
export const GUEST_ATTEMPTS_COLLECTION = "guest_attempts";
export const ADMIN_CONFIG_COLLECTION = "admin_config";
export const BLOCKED_ENTITIES_COLLECTION = "blocked_entities";

export interface AuthCollections {
  users: Collection<UserDoc>;
  companies: Collection<CompanyDoc>;
  userCompanyMemberships: Collection<UserCompanyMembershipDoc>;
  userProfiles: Collection<UserProfileDoc>;
  sessions: Collection<SessionDoc>;
  activities: Collection<ActivityDoc>;
  guestAttempts: Collection<GuestAttemptDoc>;
  adminConfig: Collection<AdminConfigDoc>;
  blockedEntities: Collection<BlockedEntityDoc>;
}

let ensurePromise: Promise<void> | null = null;

export function getAuthCollections(db: Db): AuthCollections {
  return {
    users: db.collection<UserDoc>(USERS_COLLECTION),
    companies: db.collection<CompanyDoc>(COMPANIES_COLLECTION),
    userCompanyMemberships: db.collection<UserCompanyMembershipDoc>(
      USER_COMPANY_MEMBERSHIPS_COLLECTION
    ),
    userProfiles: db.collection<UserProfileDoc>(USER_PROFILES_COLLECTION),
    sessions: db.collection<SessionDoc>(SESSIONS_COLLECTION),
    activities: db.collection<ActivityDoc>(ACTIVITIES_COLLECTION),
    guestAttempts: db.collection<GuestAttemptDoc>(GUEST_ATTEMPTS_COLLECTION),
    adminConfig: db.collection<AdminConfigDoc>(ADMIN_CONFIG_COLLECTION),
    blockedEntities: db.collection<BlockedEntityDoc>(BLOCKED_ENTITIES_COLLECTION),
  };
}

/**
 * Helper function to safely create indexes, ignoring errors if index already exists
 * or if the specification is invalid (like _id with unique: true)
 */
function isIgnorableIndexError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: number }).code;
  // 85: IndexOptionsConflict
  // 86: IndexKeySpecsConflict
  // 197: InvalidIndexSpecificationOption
  return code === 85 || code === 86 || code === 197;
}

async function createIndexSafely<T extends Document>(
  collection: Collection<T>,
  indexSpec: IndexSpecification,
  options: CreateIndexesOptions = {}
): Promise<void> {
  try {
    await collection.createIndex(indexSpec, options);
  } catch (error: unknown) {
    if (isIgnorableIndexError(error)) {
      // Silently ignore - index already exists or is invalid
      return;
    }
    // Re-throw other errors
    throw error;
  }
}

/**
 * Legacy / bad rows may miss `usernameLower`. A plain unique index on `usernameLower`
 * then treats many `null` values as duplicate keys (E11000) and breaks index builds + login.
 */
async function migrateUsersUsernameLowerField(db: Db) {
  const { users } = getAuthCollections(db);
  const brokenFilter = {
    username: { $exists: true, $type: "string", $ne: "" },
    $or: [
      { usernameLower: { $exists: false } },
      { usernameLower: "" },
      { usernameLower: null },
    ],
  } as unknown as Filter<UserDoc>;
  const broken = await users
    .find(brokenFilter)
    .project({ _id: 1, username: 1 })
    .toArray();

  const now = new Date();
  for (const doc of broken) {
    const u = typeof doc.username === "string" ? doc.username.trim() : "";
    if (!u) continue;
    await users.updateOne(
      { _id: doc._id },
      { $set: { usernameLower: u.toLowerCase(), updatedAt: now } }
    );
  }
}

async function replaceUsersUsernameLowerUniqueIndex(db: Db) {
  const { users } = getAuthCollections(db);
  const indexes = await users.indexes();
  for (const idx of indexes) {
    const key = idx.key as Record<string, number> | undefined;
    if (!key || Object.keys(key).length !== 1 || key.usernameLower !== 1) continue;
    const name = idx.name;
    if (!name || name === "_id_") continue;
    try {
      await users.dropIndex(name);
    } catch {
      // ignore
    }
    break;
  }

  try {
    await users.createIndex(
      { usernameLower: 1 },
      {
        unique: true,
        partialFilterExpression: { usernameLower: { $type: "string" } },
      }
    );
  } catch (error: unknown) {
    if (!isIgnorableIndexError(error)) {
      throw error;
    }
  }
}

async function ensureIndexes(db: Db) {
  const {
    users,
    companies,
    userCompanyMemberships,
    userProfiles,
    sessions,
    activities,
    guestAttempts,
    adminConfig,
    blockedEntities,
  } = getAuthCollections(db);

  await migrateUsersUsernameLowerField(db);
  await replaceUsersUsernameLowerUniqueIndex(db);

  // Create all indexes safely with error handling
  await Promise.all([
    // Users: usernameLower index is created in replaceUsersUsernameLowerUniqueIndex (partial unique)
    createIndexSafely(users, { role: 1, isBlocked: 1 }),
    createIndexSafely(users, { company: 1 }, { sparse: true }),
    createIndexSafely(users, { email: 1 }, { unique: true, sparse: true }),
    createIndexSafely(companies, { name: 1 }),
    createIndexSafely(
      userCompanyMemberships,
      { userId: 1, companyId: 1 },
      { unique: true }
    ),
    createIndexSafely(userCompanyMemberships, { companyId: 1 }),
    createIndexSafely(userCompanyMemberships, { userId: 1 }),
    
    // User profiles collection indexes
    createIndexSafely(userProfiles, { userId: 1 }, { unique: true }),
    
    // Sessions collection indexes
    createIndexSafely(sessions, { userId: 1, isActive: 1, lastSeenAt: -1 }),
    createIndexSafely(sessions, { identityId: 1, lastSeenAt: -1 }),
    createIndexSafely(sessions, { fingerprintId: 1 }),
    createIndexSafely(sessions, { endTime: 1 }),
    
    // Activities collection indexes
    createIndexSafely(activities, { timestamp: -1 }),
    createIndexSafely(activities, { userIdentifier: 1, timestamp: -1 }),
    createIndexSafely(activities, { actionType: 1, timestamp: -1 }),
    createIndexSafely(activities, { sessionId: 1 }),
    
    // Guest attempts collection indexes
    createIndexSafely(guestAttempts, { identityId: 1 }, { unique: true }),
    createIndexSafely(guestAttempts, { fingerprintId: 1 }),
    
    // ❌ REMOVED: adminConfig._id index - MongoDB creates this automatically
    // DO NOT create index on _id field - it's always unique by default
    // adminConfig.createIndex({ _id: 1 }, { unique: true }), // This causes Error 197
    
    // Blocked entities collection indexes
    createIndexSafely(blockedEntities, { entityType: 1, entityId: 1 }, { unique: true }),
  ]);
}

async function ensureAdminConfigAndSuperAdmin(db: Db) {
  const { adminConfig, users, userProfiles } = getAuthCollections(db);

  // Ensure system configuration exists
  await adminConfig.updateOne(
    { _id: "system" },
    {
      $setOnInsert: {
        _id: "system",
        guestAttemptLimit: authTrackingConfig.guestAttemptLimitDefault,
        registrationRequired: authTrackingConfig.registrationRequiredDefault,
        sessionTimeoutMinutes: authTrackingConfig.sessionTimeoutMinutes,
        dataRetentionDays: authTrackingConfig.dataRetentionDaysDefault,
        enableTracking: authTrackingConfig.trackingEnabledDefault,
        updatedAt: new Date(),
        updatedBy: "system",
      } satisfies AdminConfigDoc,
    },
    { upsert: true }
  );

  // Ensure super admin user exists
  const username = authTrackingConfig.superAdminUsername.trim();
  const usernameLower = username.toLowerCase();
  const existingAdmin = await users.findOne({ usernameLower });
  
  if (existingAdmin) {
    // If admin exists but doesn't have super_admin role, update it
    if (existingAdmin.role !== "super_admin") {
      await users.updateOne(
        { _id: existingAdmin._id },
        {
          $set: {
            role: "super_admin",
            updatedAt: new Date(),
          },
          $unset: { company: "", companyId: "", company_id: "" },
        },
      );
    }
    return;
  }

  // Create new super admin — MongoDB يولّد `_id` (ObjectId) تلقائياً
  const passwordHash = await hashPassword(authTrackingConfig.superAdminPassword);
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
  } as UserDoc);
  const userId = insertResult.insertedId;

  await userProfiles.updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        email: null,
        phone: null,
        additionalInfo: null,
        updatedAt: now,
      } satisfies UserProfileDoc,
    },
    { upsert: true }
  );
}

function membershipRoleFromLegacyUserRole(role: string): CompanyMembershipRole {
  if (role === "company_admin") return "company_admin";
  if (role === "viewer" || role === "valuer") return "valuer";
  if (role === "data_entry") return "data_entry";
  if (role === "reviewer") return "reviewer";
  if (role === "inspector") return "inspector";
  return "valuer";
}

/** يحوّل الدور القديم `viewer` إلى `valuer` في `users` و`user_company_memberships`. */
async function migrateLegacyViewerRoleToValuer(db: Db) {
  const now = new Date();
  const { users, userCompanyMemberships } = getAuthCollections(db);
  await users.updateMany({ role: "viewer" } as unknown as Filter<UserDoc>, {
    $set: { role: "valuer" satisfies UserRole, updatedAt: now },
  });
  await userCompanyMemberships.updateMany(
    { role: "viewer" } as unknown as Filter<UserCompanyMembershipDoc>,
    { $set: { role: "valuer" satisfies CompanyMembershipRole, updatedAt: now } },
  );
}

/** نقل `users.companyId` القديم إلى `user_company_memberships` ثم إزالة الحقل من المستخدم. */
async function migrateLegacyUserCompanyToMemberships(db: Db) {
  const { users, userCompanyMemberships } = getAuthCollections(db);
  const legacyFilter = {
    companyId: { $exists: true, $nin: [null, ""] },
  } as Filter<Document>;
  const legacy = await db.collection(USERS_COLLECTION).find(legacyFilter).toArray();

  const now = new Date();
  for (const raw of legacy) {
    const u = raw as unknown as UserMongoDoc & { companyId?: import("mongodb").ObjectId };
    const cid = u.companyId;
    if (!cid) continue;

    const exists = await userCompanyMemberships.findOne({
      userId: u._id,
      companyId: cid,
    });
    if (exists) {
      await users.updateOne(
        { _id: u._id },
        {
          $set: { company: cid, updatedAt: now },
          $unset: { companyId: "", company_id: "" },
        },
      );
      continue;
    }

    const memRole: CompanyMembershipRole =
      u.role === "super_admin" ? "company_admin" : membershipRoleFromLegacyUserRole(u.role);

    await userCompanyMemberships.insertOne({
      userId: u._id,
      companyId: cid,
      role: memRole,
      createdAt: u.createdAt ?? now,
      updatedAt: now,
    } as UserCompanyMembershipDoc);

    if (u.role === "super_admin") {
      await users.updateOne(
        { _id: u._id },
        {
          $set: { role: "super_admin" as UserRole, updatedAt: now },
          $unset: { companyId: "", company: "", company_id: "" },
        },
      );
    } else {
      await users.updateOne(
        { _id: u._id },
        {
          $set: {
            role: memRole as UserRole,
            company: cid,
            updatedAt: now,
          },
          $unset: { companyId: "", company_id: "" },
        },
      );
    }
  }
}

/** يمزامن `users.role` و`users.company` مع عضوية الشركة (إصلاح بيانات قديمة كانت تخزّن role=user فقط). */
async function backfillUserRoleAndCompanyFromMemberships(db: Db) {
  const { users, userCompanyMemberships } = getAuthCollections(db);
  const rawIds = await userCompanyMemberships.distinct("userId");
  const now = new Date();

  for (const userId of rawIds) {
    const oid = userId as import("mongodb").ObjectId;
    const u = await users.findOne({ _id: oid });
    if (!u || u.role === "super_admin") continue;

    const all = await userCompanyMemberships.find({ userId: oid }).toArray();
    if (all.length === 0) continue;

    const adminMem = all.find((x) => x.role === "company_admin");
    const primary = adminMem ?? all[0]!;
    const newRole: UserRole =
      primary.role === "company_admin" ? "company_admin" : (primary.role as UserRole);

    await users.updateOne(
      { _id: oid },
      {
        $set: {
          role: newRole,
          company: primary.companyId,
          updatedAt: now,
        },
        $unset: { companyId: "", company_id: "" },
      },
    );
  }
}

/** إزالة حقول مكرّرة قديمة على `users` (المعرّف الوحيد للشركة على المستخدم: `company`). */
async function stripDuplicateCompanyKeysOnUsers(db: Db) {
  const { users } = getAuthCollections(db);
  await users.updateMany(
    { $or: [{ companyId: { $exists: true } }, { company_id: { $exists: true } }] },
    { $unset: { companyId: "", company_id: "" } },
  );
}

/**
 * يضمن صف عضوية `company_admin` لكل شركة عندها `adminUserId`.
 */
async function syncCompanyAdminMemberships(db: Db) {
  const { companies, userCompanyMemberships } = getAuthCollections(db);
  const now = new Date();
  const rows = await companies.find({}).toArray();

  for (const c of rows) {
    if (!c.adminUserId) continue;
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
      } as UserCompanyMembershipDoc);
    }
  }
}

async function backfillCompanyDocuments(db: Db) {
  const { companies, userCompanyMemberships } = getAuthCollections(db);
  await companies.updateMany(
    { memberUserIds: { $exists: true } },
    { $unset: { memberUserIds: "" } }
  );

  const rows = await companies.find({}).toArray();
  for (const c of rows) {
    if (c.adminUserId) continue;

    const adminMem = await userCompanyMemberships.findOne({
      companyId: c._id,
      role: "company_admin",
    });
    if (!adminMem) continue;

    await companies.updateOne(
      { _id: c._id },
      { $set: { adminUserId: adminMem.userId, updatedAt: new Date() } }
    );
  }
}

/**
 * Ensures all auth tracking infrastructure is initialized:
 * - Database indexes are created
 * - System configuration exists
 * - Super admin account exists
 * 
 * This is called once per application startup and cached.
 */
export async function ensureAuthTrackingInitialized() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      try {
        const db = await getMongoDb();
        await ensureIndexes(db);
        await ensureAdminConfigAndSuperAdmin(db);
        await migrateLegacyViewerRoleToValuer(db);
        await migrateLegacyUserCompanyToMemberships(db);
        await syncCompanyAdminMemberships(db);
        await backfillCompanyDocuments(db);
        await backfillUserRoleAndCompanyFromMemberships(db);
        await stripDuplicateCompanyKeysOnUsers(db);
      } catch (error) {
        // Reset the promise so it can be retried
        ensurePromise = null;
        throw error;
      }
    })();
  }
  await ensurePromise;
}
