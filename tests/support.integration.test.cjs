const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { io } = require("socket.io-client");
const { createSupportFixture } = require("./support-fixture.cjs");
let fixture;
before(async () => { fixture = await createSupportFixture(); }, { timeout: 180_000 });
after(async () => { if (fixture) await fixture.close(); });
const create = async (who = "owner", body = {}) => fixture.request(who, "/tickets", { method: "POST", body: JSON.stringify({ subject: "اختبار محادثة الدعم", text: "أحتاج مساعدة في التقرير", clientId: randomUUID(), ...body }) });
const connect = who => new Promise((resolve, reject) => {
  const socket = io(fixture.origin, { path: "/api/realtime/socket.io", addTrailingSlash: false, transports: ["websocket"], extraHeaders: { cookie: fixture.users[who].cookie }, reconnection: false });
  socket.once("connect", () => resolve(socket)); socket.once("connect_error", error => { socket.close(); reject(error); });
});

test("Socket.IO accepts the canonical path without a trailing slash", async () => {
  const response = await fetch(`${fixture.origin}/api/realtime/socket.io?EIO=4&transport=polling`, { headers: { cookie: fixture.users.owner.cookie } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /"sid"/);
});

test("authentication and CSRF are required, and users cannot impersonate staff", async () => {
  assert.equal((await fixture.request(null, "/tickets")).status, 401);
  const denied = await fixture.request("owner", "/tickets", { method: "POST", headers: { "x-csrf-token": "wrong" }, body: JSON.stringify({ subject: "invalid" }) });
  assert.equal(denied.status, 403);
  assert.equal((await fixture.request("owner", "/agents")).status, 403);
  assert.equal((await fixture.request("agent", "/agents", { method: "PATCH", body: JSON.stringify({ phone: "0500000002", enabled: true }) })).status, 403);
});

test("tickets are private to the owner and active company; staff sees the inbox", async () => {
  const result = await create(); assert.equal(result.status, 201);
  const id = result.data.ticket._id;
  assert.equal(result.data.ticket.companyName, "شركة الاختبار الأولى");
  assert.equal(result.data.ticket.ownerPhone, "0500000001");
  assert.equal((await fixture.request("colleague", `/tickets/${id}`)).status, 404);
  assert.equal((await fixture.request("outsider", `/tickets/${id}`)).status, 404);
  assert.equal((await fixture.request("agent", `/tickets/${id}`)).status, 200);
  assert.equal((await fixture.request("outsider", "/tickets")).data.total, 0);
  const { SupportService } = require("../dist/support/support.service");
  const { SupportAuthService } = require("../dist/support/support-auth.service");
  const actor = await fixture.app.get(SupportAuthService).resolve({ headers: { cookie: fixture.users.owner.cookie } });
  await assert.rejects(fixture.app.get(SupportService).ticket({ ...actor, companyId: fixture.users.outsider.companyId }, id));
});

test("retrying ticket creation or message sending does not duplicate persisted data", async () => {
  const clientId = randomUUID();
  const a = await create("owner", { clientId }); const b = await create("owner", { clientId });
  assert.equal(a.data.ticket._id, b.data.ticket._id);
  const id = a.data.ticket._id; const messageId = randomUUID();
  const body = JSON.stringify({ text: "رسالة واحدة", clientId: messageId });
  const results = await Promise.all([1, 2].map(() => fixture.request("owner", `/tickets/${id}/messages`, { method: "POST", body })));
  assert.ok(results.every(r => r.status === 201));
  assert.equal(results[0].data.message._id, results[1].data.message._id);
  assert.equal((await fixture.request("owner", `/tickets/${id}`)).data.messages.length, 2);
});

test("status changes enforce permissions, optimistic revisions, and reopening", async () => {
  const created = await create(); const id = created.data.ticket._id;
  const patch = (who, body) => fixture.request(who, `/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  assert.equal((await patch("owner", { revision: 0, status: "resolved" })).status, 403);
  assert.equal((await patch("owner", { revision: 0, assigneeId: fixture.users.owner.id })).status, 403);
  const assigned = await patch("agent", { revision: "0", status: "in_progress", assigneeId: fixture.users.agent.id });
  assert.equal(assigned.status, 200); assert.equal(assigned.data.ticket.assigneeName, "agent");
  assert.equal((await patch("agent", { revision: 0, status: "resolved" })).status, 409);
  assert.equal((await patch("agent", { revision: 1, status: "waiting_user" })).status, 200);
  await fixture.request("owner", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "تم الرد", clientId: randomUUID() }) });
  const detail = await fixture.request("owner", `/tickets/${id}`);
  assert.equal(detail.data.ticket.status, "in_progress");
  const closed = await patch("owner", { revision: detail.data.ticket.revision, status: "closed" });
  assert.equal(closed.status, 200);
  assert.equal((await fixture.request("owner", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "closed", clientId: randomUUID() }) })).status, 409);
  assert.equal((await patch("owner", { revision: closed.data.ticket.revision, status: "open" })).status, 200);
  assert.ok((await fixture.request("owner", `/tickets/${id}`)).data.ticket.history.length >= 5);
});

test("developer requests stay out of the support inbox and create private notification updates", async () => {
  const created = await create("owner", { kind: "bug", subject: "تسجيل مشكلة في التقرير" });
  const id = created.data.ticket._id;
  const developerList = await fixture.request("owner", "/tickets?kind=developer");
  assert.ok(developerList.data.tickets.some(ticket => ticket._id === id));
  const supportList = await fixture.request("owner", "/tickets?kind=ticket");
  assert.ok(!supportList.data.tickets.some(ticket => ticket._id === id));
  const agentNotifications = await fixture.request("agent", "/notifications");
  assert.ok(agentNotifications.data.notifications.some(item => item.ticketId === id && item.channel === "developer" && item.event === "message"));
  await fixture.request("agent", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "وصل التسجيل وسنتابعه", clientId: randomUUID() }) });
  const ownerNotifications = await fixture.request("owner", "/notifications");
  const reply = ownerNotifications.data.notifications.find(item => item.ticketId === id && item.event === "message");
  assert.ok(reply && !reply.readAt);
  assert.equal((await fixture.request("owner", "/notifications/read", { method: "POST", body: JSON.stringify({ ids: [reply._id] }) })).status, 201);
  const summary = await fixture.request("owner", "/summary");
  assert.equal(typeof summary.data.notificationUnread, "number");
});

test("read receipts only mark the specific delivered messages, including concurrent new replies", async () => {
  const created = await create(); const id = created.data.ticket._id;
  const first = await fixture.request("agent", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "أول رد", clientId: randomUUID() }) });
  const second = await fixture.request("agent", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "رد جديد", clientId: randomUUID() }) });
  await fixture.request("owner", `/tickets/${id}/read`, { method: "POST", body: JSON.stringify({ ids: [first.data.message._id] }) });
  const detail = await fixture.request("owner", `/tickets/${id}`);
  assert.equal(detail.data.messages.find(m => m._id === first.data.message._id).readByOwner, true);
  assert.equal(detail.data.messages.find(m => m._id === second.data.message._id).readByOwner, false);
  const list = await fixture.request("owner", "/tickets");
  assert.equal(list.data.tickets.find(t => t._id === id).unread, 1);
});

test("uploads reject spoofed files, protect recordings, and implement byte ranges", async () => {
  const created = await create(); const id = created.data.ticket._id;
  const bad = new FormData(); bad.append("file", new Blob(["<script>bad</script>"], { type: "video/webm" }), "fake.webm");
  assert.equal((await fixture.request("owner", `/tickets/${id}/files`, { method: "POST", body: bad })).status, 400);
  const data = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...Array(96).fill(0)]);
  const form = new FormData(); form.append("file", new Blob([data], { type: "video/webm" }), "recording.webm");
  const upload = await fixture.request("owner", `/tickets/${id}/files`, { method: "POST", body: form });
  assert.equal(upload.status, 201);
  const fileId = upload.data.file.id;
  await fixture.request("owner", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ attachments: [fileId], clientId: randomUUID() }) });
  assert.equal((await fixture.request("outsider", `/files/${fileId}`)).status, 404);
  const ranged = await fetch(`${fixture.origin}/api/support/files/${fileId}`, { headers: { cookie: fixture.users.agent.cookie, range: "bytes=3-12" } });
  assert.equal(ranged.status, 206); assert.equal(ranged.headers.get("content-range"), "bytes 3-12/100"); assert.equal((await ranged.arrayBuffer()).byteLength, 10);
  const invalid = await fetch(`${fixture.origin}/api/support/files/${fileId}`, { headers: { cookie: fixture.users.owner.cookie, range: "bytes=200-300" } });
  assert.equal(invalid.status, 416);
  const another = await create("outsider");
  assert.equal((await fixture.request("outsider", `/tickets/${another.data.ticket._id}/messages`, { method: "POST", body: JSON.stringify({ attachments: [fileId], clientId: randomUUID() }) })).status, 400);
});

test("chunked uploads assemble recordings without a large proxy request", async () => {
  const created = await create(); const id = created.data.ticket._id;
  const bytes = new Uint8Array(4 * 1024 * 1024 + 17); bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  const started = await fixture.request("owner", `/tickets/${id}/files/uploads`, { method: "POST", body: JSON.stringify({ name: "large.webm", size: bytes.length }) });
  assert.equal(started.status, 201);
  const { uploadId, chunkSize } = started.data;
  let offset = 0;
  while (offset < bytes.length) {
    const chunk = bytes.slice(offset, Math.min(offset + chunkSize, bytes.length));
    const response = await fixture.request("owner", `/tickets/${id}/files/uploads/${uploadId}`, { method: "PATCH", headers: { "content-type": "application/octet-stream", "x-upload-length": String(chunk.length), "x-upload-offset": String(offset) }, body: chunk });
    assert.equal(response.status, 200); offset = response.data.offset;
  }
  const completed = await fixture.request("owner", `/tickets/${id}/files/uploads/${uploadId}/complete`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(completed.status, 201); assert.equal(completed.data.file.size, bytes.length);
});

test("sockets authenticate, reject unauthorized subscriptions, and deliver real-time messages", async () => {
  const created = await create(); const id = created.data.ticket._id;
  const owner = await connect("owner"); const agent = await connect("agent"); const outsider = await connect("outsider");
  try {
    const ack = await new Promise(resolve => outsider.emit("support:watch", id, resolve)); assert.equal(ack.ok, false);
    assert.equal((await new Promise(resolve => owner.emit("support:watch", id, resolve))).ok, true);
    const received = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error("No message event")), 5000); owner.on("support:changed", event => { if (event.ticketId === id && event.reason === "message") { clearTimeout(timeout); resolve(event); } }); });
    let leaked = false; outsider.on("support:changed", event => { if (event.ticketId === id) leaked = true; });
    await fixture.request("agent", `/tickets/${id}/messages`, { method: "POST", body: JSON.stringify({ text: "رد لحظي", clientId: randomUUID() }) });
    assert.equal((await received).ticketId, id); assert.equal(leaked, false);
    await new Promise(resolve => agent.emit("support:watch", id, resolve));
    const typing = new Promise(resolve => owner.once("support:typing", resolve));
    agent.emit("support:typing", { ticketId: id, typing: true });
    assert.equal((await typing).name, "agent");
  } finally { owner.close(); agent.close(); outsider.close(); }
});

test("Arabic assistant retrieves real procedures and labels guide-only replies honestly", async () => {
  const { findSupportArticles } = require("../dist/support/support-knowledge");
  assert.equal(findSupportArticles("كيف أنشئ مشروع تقييم آلات؟", "machine-valuation")[0].article.id, "mv-create");
  assert.equal(findSupportArticles("كيف أنزل التقرير النهائي؟", "machine-valuation")[0].article.id, "mv-export");
  assert.equal(findSupportArticles("تفقيط مبلغ بالريال السعودي", "helper-tools")[0].article.id, "tools-words");
  const answer = await fixture.request("owner", "/assistant", { method: "POST", body: JSON.stringify({ question: "كيف أنشئ مشروع آلات؟", product: "machine-valuation" }) });
  assert.equal(answer.status, 201); assert.equal(answer.data.mode, "guide"); assert.ok(answer.data.steps.length > 0);
  const unknown = await fixture.request("owner", "/assistant", { method: "POST", body: JSON.stringify({ question: "أخبرني عن كوكب زحل" }) });
  assert.equal(unknown.data.handoff, true); assert.equal(unknown.data.steps.length, 0);
});

test("a signed-out session cannot reconnect or read private support data", async () => {
  const socket = await connect("colleague");
  const disconnected = new Promise(resolve => socket.once("disconnect", resolve));
  const response = await fetch(`${fixture.origin}/api/auth/logout`, { method: "POST", headers: { cookie: fixture.users.colleague.cookie, "x-csrf-token": fixture.users.colleague.csrf } });
  assert.equal(response.status, 201); await disconnected; socket.close();
  assert.equal((await fixture.request("colleague", "/tickets")).status, 401);
  await assert.rejects(connect("colleague"));
});
