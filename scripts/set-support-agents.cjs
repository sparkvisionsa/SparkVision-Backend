// Run after building. Without --apply this only checks the existing accounts.
const path = require("node:path");
require("dotenv").config({ path: ".env.local", quiet: true });
require("dotenv").config({ quiet: true });
require("module-alias").addAlias("@", path.join(__dirname, "../dist"));
const { getMongoDb } = require("../dist/server/mongodb");
const { findSupportUser } = require("../dist/support/support-agents");

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const phones = args.filter(arg => arg !== "--apply");
  if (!phones.length) throw new Error("Usage: npm run support:agents -- [--apply] 579228782 596220001");
  const db = await getMongoDb();
  const selected = [];
  for (const phone of phones) {
    const users = await findSupportUser(db, phone);
    if (users.length !== 1) throw new Error(`Expected exactly one existing account for ${phone}; found ${users.length}. No grants changed.`);
    if (users[0].isBlocked) throw new Error(`Account ${phone} is blocked. No grants changed.`);
    selected.push({ phone, user: users[0] });
  }
  if (apply) {
    const now = new Date();
    await db.collection("support_agents").createIndex({ userId: 1 }, { unique: true });
    for (const { user } of selected) {
      if (user.role === "super_admin") continue;
      await db.collection("support_agents").updateOne({ userId: String(user._id) }, {
        $set: { enabled: true, updatedAt: now, updatedBy: "script:set-support-agents" },
      }, { upsert: true });
    }
  }
  for (const { phone, user } of selected) {
    const grant = await db.collection("support_agents").findOne({ userId: String(user._id), enabled: true });
    console.log(JSON.stringify({ phone, userId: String(user._id), enabled: user.role === "super_admin" || Boolean(grant), applied: apply }));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => require("mongoose").disconnect());
