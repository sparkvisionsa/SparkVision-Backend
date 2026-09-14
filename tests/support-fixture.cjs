const path = require("node:path");
const { randomUUID } = require("node:crypto");

async function createSupportFixture(port = 0) {
  require("reflect-metadata");
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongo = await MongoMemoryServer.create();
  // This fixture never loads .env and can only use its own ephemeral MongoDB.
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "support_integration";
  process.env.ENABLE_REDIS_CACHE = "false";
  process.env.SUPPORT_AI_API_KEY = "";
  process.env.GEMINI_API_KEY = "";
  process.env.CORS_ORIGINS = "http://127.0.0.1:3100,http://localhost:3100";
  require("module-alias").addAlias("@", path.join(__dirname, "../dist"));
  const { Module } = require("@nestjs/common");
  const { NestFactory } = require("@nestjs/core");
  const { APP_FILTER } = require("@nestjs/core");
  const { SupportModule } = require("../dist/support/support.module");
  const { RealtimeModule } = require("../dist/realtime/realtime.module");
  const { RealtimeService } = require("../dist/realtime/realtime.service");
  const { ApiErrorFilter } = require("../dist/common/api-error.filter");
  const { AuthTrackingController } = require("../dist/auth-tracking/auth-tracking.controller");
  const { getMongoDb } = require("../dist/server/mongodb");
  const { ensureAuthTrackingInitialized } = require("../dist/server/auth-tracking/collections");
  const { signToken } = require("../dist/server/auth-tracking/crypto");
  const { ObjectId } = require("mongodb");
  class TestModule {}
  Module({ imports: [RealtimeModule, SupportModule], controllers: [AuthTrackingController], providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.use(require("cookie-parser")());
  app.setGlobalPrefix("api");
  app.get(RealtimeService).attach(app.getHttpServer());
  await app.listen(port, "127.0.0.1");
  const db = await getMongoDb();
  await ensureAuthTrackingInitialized();
  const companyA = new ObjectId(); const companyB = new ObjectId();
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: companyA, name: "شركة الاختبار الأولى", valueTechProductIds: ["machine-valuation", "real-estate-valuation"], createdAt: now, updatedAt: now },
    { _id: companyB, name: "شركة الاختبار الثانية", valueTechProductIds: ["machine-valuation"], createdAt: now, updatedAt: now },
  ]);
  const users = {};
  for (const [name, company, role, phone] of [
    ["owner", companyA, "company_admin", "0500000001"], ["colleague", companyA, "valuer", "0500000002"],
    ["outsider", companyB, "company_admin", "0500000003"], ["agent", null, "user", "0500000004"], ["admin", null, "super_admin", "support-test-admin"],
  ]) {
    const _id = new ObjectId(); const sid = randomUUID(); const identity = randomUUID(); const csrf = randomUUID();
    await db.collection("users").insertOne({ _id, username: name, usernameLower: name, phone, passwordHash: "unused", role, company, isBlocked: false, createdAt: now, updatedAt: now });
    if (company) await db.collection("user_company_memberships").insertOne({ userId: _id, companyId: company, role, productIds: ["machine-valuation", "real-estate-valuation"], createdAt: now, updatedAt: now });
    await db.collection("sessions").insertOne({ _id: sid, userId: _id, activeCompanyId: company, identityId: identity, isActive: true, endTime: null, lastSeenAt: now, startTime: now, firstVisitAt: now, durationMs: 0, device: { type: "desktop", os: "Windows", browser: "Chrome" }, geo: { ipAddress: "127.0.0.1" }, userAgent: "support-test" });
    const cookie = `sv_identity=${signToken({ id: identity, iat: Date.now() })}; sv_session=${signToken({ sid, id: identity, iat: Date.now() })}; sv_csrf=${csrf}`;
    users[name] = { id: String(_id), companyId: company && String(company), sid, csrf, cookie };
  }
  await db.collection("support_agents").insertOne({ userId: users.agent.id, enabled: true });
  const origin = await app.getUrl();
  const request = async (who, route, options = {}) => {
    const actor = users[who];
    const response = await fetch(`${origin}/api/support${route}`, { ...options, headers: { cookie: actor?.cookie ?? "", "x-csrf-token": actor?.csrf ?? "", ...(options.body && typeof options.body === "string" ? { "content-type": "application/json" } : {}), ...options.headers } });
    const data = await response.json().catch(() => null);
    return { status: response.status, data, headers: response.headers };
  };
  return { app, db, users, origin, request, async close() { await app.close(); await require("mongoose").disconnect(); await mongo.stop(); } };
}
module.exports = { createSupportFixture };

if (require.main === module) {
  createSupportFixture(5011).then(fixture => {
    const fs = require("node:fs");
    const target = process.env.SUPPORT_TEST_SESSION_FILE;
    if (target) fs.writeFileSync(target, JSON.stringify({ origin: fixture.origin, users: fixture.users }));
    process.stdout.write("Support test backend ready on 5011 (temporary database)\n");
    const close = async () => { await fixture.close(); process.exit(0); };
    process.on("SIGINT", close); process.on("SIGTERM", close);
  }).catch(error => { process.stderr.write(String(error.stack || error)); process.exit(1); });
}
