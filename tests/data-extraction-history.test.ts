import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import sharp from "sharp";
import { DataExtractionHistoryService } from "../src/machine-valuation/data-extraction-history.service";
import type { MvAccessContext } from "../src/machine-valuation/types";
import type { DataExtractionDocument } from "../src/machine-valuation/data-extraction.service";

test("history persists source, cover, Arabic fields and edits and isolates owners and companies", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const priorUri = process.env.MONGO_URL_SCRAPPING, priorName = process.env.MONGO_DBNAME_SCRAPPING;
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "extraction_history_test";
  const owner: MvAccessContext = { userId: "owner", companyId: "company-a", isSuperAdmin: false, userRole: "valuer" };
  try {
    const service = new DataExtractionHistoryService();
    const buffer = await sharp({ create: { width: 80, height: 120, channels: 3, background: "white" } }).png().toBuffer();
    const document: DataExtractionDocument = { id: "temp", fileName: "صك.png", mimeType: "image/png", status: "completed", documentType: "وثيقة تملك عقار", language: "العربية", fields: [{ id: "one", label: "رقم الوثيقة", value: "123456", category: "document", confidence: "medium", section: "البيانات الأساسية", source: { x: 0.2, y: 0.1, width: 0.2, height: 0.1 } }], pages: [{ page: 1, text: "النص الكامل" }] };
    const [saved] = await service.save([{ buffer, size: buffer.length } as Express.Multer.File], [document], owner);
    assert.ok(saved?.sourceUrl);
    assert.ok(saved.thumbnailUrl);
    assert.equal(saved.fileName, "صك.png");
    const listed = await service.list(owner);
    assert.equal(listed.items[0]?.fieldCount, 1);
    assert.equal("fields" in listed.items[0]!, false);
    const reopened = await new DataExtractionHistoryService().get(saved.id, owner);
    assert.equal(reopened.fields[0]?.value, "123456");
    assert.equal(reopened.pages?.[0]?.text, "النص الكامل");
    const file = await service.file(saved.id, "original", owner);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), buffer);
    const cover = await service.file(saved.id, "thumbnail", owner);
    assert.equal(cover.mimeType, "image/webp");
    cover.stream.destroy();
    for (const stranger of [{ ...owner, userId: "someone-else" }, { ...owner, companyId: "company-b" }]) {
      assert.equal((await service.list(stranger)).items.length, 0);
      await assert.rejects(service.get(saved.id, stranger), /غير موجود/);
      await assert.rejects(service.file(saved.id, "original", stranger), /غير موجود/);
      await assert.rejects(service.update(saved.id, { fields: [] }, stranger), /غير موجود/);
      await assert.rejects(service.remove(saved.id, stranger), /غير موجود/);
    }
    await assert.rejects(service.list({ ...owner, userId: null }), /تسجيل الدخول/);
    const updated = await service.update(saved.id, { fields: [{ ...reopened.fields[0], value: "654321", source: { x: 99 } }] }, owner);
    assert.equal(updated.fields[0]?.value, "654321");
    assert.equal(updated.fields[0]?.reviewed, true);
    assert.deepEqual(updated.fields[0]?.source, reopened.fields[0]?.source);
    await service.remove(saved.id, owner);
    assert.equal((await service.list(owner)).items.length, 0);
    const db = mongoose.connection.db!;
    assert.equal(await db.collection("mv_extraction_sources.files").countDocuments(), 0);
    assert.equal(await db.collection("mv_extraction_sources.chunks").countDocuments(), 0);
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    if (priorUri === undefined) delete process.env.MONGO_URL_SCRAPPING; else process.env.MONGO_URL_SCRAPPING = priorUri;
    if (priorName === undefined) delete process.env.MONGO_DBNAME_SCRAPPING; else process.env.MONGO_DBNAME_SCRAPPING = priorName;
  }
});
