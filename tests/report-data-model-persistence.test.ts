import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";

const snapshot = {
  id: "model-equipment",
  name: "نموذج المعدات",
  sections: [
    { id: "basic", title: "البيانات الأساسية", fields: [{ id: "reportTitle", label: "عنوان التقرير", sourceKey: "reportTitle", type: "text", required: true, system: true }] },
    { id: "machine", title: "بيانات الآلة", fields: [{ id: "maker", label: "الشركة المصنعة", sourceKey: "field:maker", type: "text", required: false }] },
  ],
};

test("report data keeps its model, copy and fields when a screen saves only part of it", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const previous = [process.env.MONGO_URL_SCRAPPING, process.env.MONGO_DBNAME_SCRAPPING];
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "report_data_model_test";
  try {
    const db = await getMongoDb();
    const projectId = new ObjectId();
    await db.collection("mv_projects").insertOne({
      _id: projectId,
      name: "Project",
      companyId: "company",
      userId: "owner",
      reportType: "simple",
      referenceNumber: "MV-0001",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      reportData: {},
    });
    const service = new MachineValuationService({ isReady: () => false } as any);
    (service as any).loadProjectForAccess = async () => db.collection("mv_projects").findOne({ _id: projectId });
    (service as any).assertProjectInScope = () => undefined;
    const ctx = { userId: "owner", companyId: "company", isSuperAdmin: false, userRole: "valuer" as const };
    const stored = async () => (await db.collection("mv_projects").findOne({ _id: projectId }))!.reportData;

    // 1. The report-data page saves the full data with the model and its copy.
    await service.updateProject(projectId.toString(), ctx, {
      name: "Project",
      reportData: {
        reportTitle: "تقرير خط الإنتاج",
        reportDataModelId: "model-equipment",
        reportDataModelSnapshot: snapshot,
        customSections: [{ id: "machine", modelId: "model-equipment", title: "بيانات الآلة" }],
        customFields: [{ id: "maker", sectionId: "machine", modelId: "model-equipment", label: "الشركة المصنعة", type: "text", required: false, value: "سيمنس" }],
      },
    });
    let data = await stored();
    assert.equal(data.reportDataModelId, "model-equipment");
    assert.equal(data.reportDataModelSnapshot.id, "model-equipment");
    assert.deepEqual(data.reportDataModelSnapshot.sections.map((section: { id: string }) => section.id), ["basic", "machine"]);
    assert.equal(data.customFields[0].value, "سيمنس");

    // 2. Another screen saves a single setting from a light copy (no fields, no model).
    await service.updateProject(projectId.toString(), ctx, { reportData: { includeAssetImages: false } });
    data = await stored();
    assert.equal(data.includeAssetImages, false, "the setting itself is saved");
    assert.equal(data.reportDataModelId, "model-equipment", "model kept");
    assert.equal(data.reportDataModelSnapshot?.id, "model-equipment", "model copy kept");
    assert.equal(data.reportTitle, "تقرير خط الإنتاج", "typed data kept");
    assert.equal(data.customFields.length, 1, "custom fields kept");
    assert.equal(data.customFields[0].value, "سيمنس");
    assert.equal(data.customSections.length, 1);

    // 3. Clearing stays possible when the payload says so explicitly.
    await service.updateProject(projectId.toString(), ctx, { reportData: { reportTitle: "", customFields: [] } });
    data = await stored();
    assert.equal(data.reportTitle, "");
    assert.deepEqual(data.customFields, []);
    assert.equal(data.reportDataModelId, "model-equipment");
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    for (const [index, key] of ["MONGO_URL_SCRAPPING", "MONGO_DBNAME_SCRAPPING"].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
});
