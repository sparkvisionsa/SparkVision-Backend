import type {
  Collection,
  CreateIndexesOptions,
  Db,
  Document,
  IndexSpecification,
} from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import { authTrackingConfig } from "./config";
import { hashPassword, randomId } from "./crypto";
import type {
  ActivityDoc,
  AdminConfigDoc,
  BlockedEntityDoc,
  GuestAttemptDoc,
  SessionDoc,
  UserDoc,
  UserProfileDoc,
} from "./types";

export const USERS_COLLECTION = "users";
export const USER_PROFILES_COLLECTION = "user_profiles";
export const SESSIONS_COLLECTION = "sessions";
export const ACTIVITIES_COLLECTION = "activities";
export const GUEST_ATTEMPTS_COLLECTION = "guest_attempts";
export const ADMIN_CONFIG_COLLECTION = "admin_config";
export const BLOCKED_ENTITIES_COLLECTION = "blocked_entities";

export interface AuthCollections {
  users: Collection<UserDoc>;
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

async function ensureIndexes(db: Db) {
  const {
    users,
    userProfiles,
    sessions,
    activities,
    guestAttempts,
    adminConfig,
    blockedEntities,
  } = getAuthCollections(db);

  // Create all indexes safely with error handling
  await Promise.all([
    // Users collection indexes
    createIndexSafely(users, { usernameLower: 1 }, { unique: true }),
    createIndexSafely(users, { role: 1, isBlocked: 1 }),
    createIndexSafely(users, { email: 1 }, { unique: true, sparse: true }),
    
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
            updatedAt: new Date()
          } 
        }
      );
    }
    return;
  }

  // Create new super admin
  const passwordHash = await hashPassword(authTrackingConfig.superAdminPassword);
  const now = new Date();
  const userId = randomId();

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
      } catch (error) {
        // Reset the promise so it can be retried
        ensurePromise = null;
        throw error;
      }
    })();
  }
  await ensurePromise;
}
