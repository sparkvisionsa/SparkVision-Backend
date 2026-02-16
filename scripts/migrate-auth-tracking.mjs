import { config as loadEnv } from "dotenv";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

loadEnv();

const mongoUrl = process.env.MONGO_URL_SCRAPPING;
const dbName = process.env.MONGO_DBNAME_SCRAPPING;

if (!mongoUrl || !dbName) {
  console.error("❌ Missing MONGO_URL_SCRAPPING or MONGO_DBNAME_SCRAPPING in .env file");
  process.exit(1);
}

const ADMIN_USERNAME = process.env.SUPER_ADMIN_USERNAME ?? "admin000";
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "admin000";

const client = new MongoClient(mongoUrl);

function randomId() {
  return crypto.randomUUID();
}

async function createIndexSafely(collection, indexSpec, options = {}) {
  try {
    await collection.createIndex(indexSpec, options);
    const indexName = options.name || JSON.stringify(indexSpec);
    console.log(`✅ Created index: ${collection.collectionName}.${indexName}`);
  } catch (error) {
    if (error.code === 85 || error.code === 86) {
      // Index already exists or duplicate key error
      console.log(`ℹ️  Index already exists: ${collection.collectionName}.${JSON.stringify(indexSpec)}`);
    } else if (error.code === 197) {
      // Invalid index specification (like _id with unique)
      console.log(`⚠️  Skipped invalid index: ${collection.collectionName}.${JSON.stringify(indexSpec)}`);
    } else {
      throw error;
    }
  }
}

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    
    const db = client.db(dbName);

    // Get or create collections
    const collections = await db.listCollections().toArray();
    const existingCollections = collections.map(c => c.name);
    
    const requiredCollections = [
      'users',
      'user_profiles',
      'sessions',
      'activities',
      'guest_attempts',
      'admin_config',
      'blocked_entities'
    ];

    for (const collName of requiredCollections) {
      if (!existingCollections.includes(collName)) {
        await db.createCollection(collName);
        console.log(`✅ Created collection: ${collName}`);
      }
    }

    const users = db.collection("users");
    const userProfiles = db.collection("user_profiles");
    const sessions = db.collection("sessions");
    const activities = db.collection("activities");
    const guestAttempts = db.collection("guest_attempts");
    const adminConfig = db.collection("admin_config");
    const blockedEntities = db.collection("blocked_entities");

    console.log("\n📊 Creating indexes...");

    // Create indexes safely (avoiding _id with unique: true)
    await createIndexSafely(users, { usernameLower: 1 }, { unique: true, name: "usernameLower_unique" });
    await createIndexSafely(users, { role: 1, isBlocked: 1 }, { name: "role_isBlocked" });
    await createIndexSafely(users, { email: 1 }, { unique: true, sparse: true, name: "email_unique_sparse" });
    
    await createIndexSafely(userProfiles, { userId: 1 }, { unique: true, name: "userId_unique" });
    
    await createIndexSafely(sessions, { userId: 1, isActive: 1, lastSeenAt: -1 }, { name: "userId_active_lastSeen" });
    await createIndexSafely(sessions, { identityId: 1, lastSeenAt: -1 }, { name: "identityId_lastSeen" });
    await createIndexSafely(sessions, { fingerprintId: 1 }, { name: "fingerprintId" });
    await createIndexSafely(sessions, { endTime: 1 }, { name: "endTime" });
    
    await createIndexSafely(activities, { timestamp: -1 }, { name: "timestamp_desc" });
    await createIndexSafely(activities, { userIdentifier: 1, timestamp: -1 }, { name: "userIdentifier_timestamp" });
    await createIndexSafely(activities, { actionType: 1, timestamp: -1 }, { name: "actionType_timestamp" });
    await createIndexSafely(activities, { sessionId: 1 }, { name: "sessionId" });
    
    await createIndexSafely(guestAttempts, { identityId: 1 }, { unique: true, name: "identityId_unique" });
    await createIndexSafely(guestAttempts, { fingerprintId: 1 }, { name: "fingerprintId" });
    
    // Note: Removed the problematic _id index creation for adminConfig
    // MongoDB automatically creates a unique index on _id, no need to specify it
    
    await createIndexSafely(blockedEntities, { entityType: 1, entityId: 1 }, { unique: true, name: "entityType_entityId_unique" });

    console.log("\n⚙️  Setting up system configuration...");

    // Initialize admin config
    const configResult = await adminConfig.updateOne(
      { _id: "system" },
      {
        $setOnInsert: {
          _id: "system",
          guestAttemptLimit: 5,
          registrationRequired: false, // Changed to false for better UX
          sessionTimeoutMinutes: 30,
          dataRetentionDays: 180,
          enableTracking: true,
          createdAt: new Date(),
          updatedBy: "migration",
        },
        $set: {
          updatedAt: new Date(),
        }
      },
      { upsert: true }
    );

    if (configResult.upsertedCount > 0) {
      console.log("✅ Created system configuration");
    } else {
      console.log("ℹ️  System configuration already exists");
    }

    console.log("\n👤 Setting up super admin account...");

    // Create super admin user
    const usernameLower = ADMIN_USERNAME.toLowerCase();
    const existingAdmin = await users.findOne({ usernameLower });
    
    if (!existingAdmin) {
      const now = new Date();
      const userId = randomId();
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      
      await users.insertOne({
        _id: userId,
        username: ADMIN_USERNAME,
        usernameLower,
        passwordHash,
        role: "super_admin",
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        isBlocked: false,
        blockedAt: null,
        email: null,
        phone: null,
      });
      
      await userProfiles.insertOne({
        userId,
        email: null,
        phone: null,
        additionalInfo: {},
        createdAt: now,
        updatedAt: now,
      });
      
      console.log(`✅ Created super admin account: ${ADMIN_USERNAME}`);
      console.log(`   Username: ${ADMIN_USERNAME}`);
      console.log(`   Password: ${ADMIN_PASSWORD}`);
      console.log(`   ⚠️  IMPORTANT: Change the password after first login!`);
    } else {
      console.log(`ℹ️  Super admin already exists: ${ADMIN_USERNAME}`);
      
      // Update role if needed
      if (existingAdmin.role !== "super_admin") {
        await users.updateOne(
          { _id: existingAdmin._id },
          { $set: { role: "super_admin", updatedAt: new Date() } }
        );
        console.log(`✅ Updated ${ADMIN_USERNAME} role to super_admin`);
      }
    }

    // Display migration summary
    console.log("\n" + "=".repeat(60));
    console.log("✅ AUTH TRACKING MIGRATION COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60));
    console.log("\n📋 Summary:");
    console.log(`   Database: ${dbName}`);
    console.log(`   Collections created/verified: ${requiredCollections.length}`);
    console.log(`   Indexes created/verified: Multiple indexes on all collections`);
    console.log(`   Super Admin: ${ADMIN_USERNAME}`);
    console.log(`   System Config: Initialized with default settings`);
    
    console.log("\n🎯 Next Steps:");
    console.log("   1. Start your application: npm run dev");
    console.log("   2. Login with super admin credentials");
    console.log("   3. Navigate to /admin/dashboard");
    console.log("   4. Change the default admin password");
    console.log("   5. Configure guest attempt limits in admin settings");
    
    console.log("\n📚 Configuration:");
    console.log("   - Guest Attempt Limit: 5");
    console.log("   - Registration Required: false (users can browse first)");
    console.log("   - Session Timeout: 30 minutes");
    console.log("   - Data Retention: 180 days");
    console.log("   - Tracking: Enabled");
    
    console.log("\n" + "=".repeat(60) + "\n");

  } catch (error) {
    console.error("\n❌ Migration failed with error:");
    console.error(error);
    throw error;
  }
}

run()
  .catch((error) => {
    console.error("\n💥 Fatal error during migration:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.close();
    console.log("🔌 Disconnected from MongoDB\n");
  });
