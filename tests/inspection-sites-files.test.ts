import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MachineValuationService } from "../src/machine-valuation/machine-valuation.service";
import { getMongoDb } from "../src/server/mongodb";

const file = (id: string, locationIds?: string[]) => ({
  id,
  name: `${id}.jpg`,
  type: "image",
  url: `/x/${id}`,
  uploadedBy: "owner",
  createdAt: new Date("2026-01-01"),
  storage: "digitalocean",
  spacesKey: `k/${id}`,
  ...(locationIds ? { locationIds } : {}),
});

test("inspection sites autosave without losing or misfiling attached files", { timeout: 120_000 }, async () => {
  const mongo = await MongoMemoryServer.create();
  const previous = [process.env.MONGO_URL_SCRAPPING, process.env.MONGO_DBNAME_SCRAPPING];
  process.env.MONGO_URL_SCRAPPING = mongo.getUri();
  process.env.MONGO_DBNAME_SCRAPPING = "inspection_sites_test";
  try {
    const db = await getMongoDb();
    const projectId = new ObjectId();
    const companyId = new ObjectId();
    await db.collection("mv_projects").insertOne({
      _id: projectId,
      name: "Project",
      companyId,
      userId: "owner",
      reportData: { reportTitle: "تقرير" },
      locations: [
        { id: "site-a", name: "المصنع", region: "", city: "", latitude: null, longitude: null },
        { id: "site-b", name: "المستودع", region: "", city: "", latitude: null, longitude: null },
      ],
      inspectorFiles: [file("f1", ["site-a"]), file("f2", ["site-b"]), file("f3", ["site-a", "site-b"]), file("f4")],
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    });
    const service = new MachineValuationService({ isReady: () => false } as any);
    const ctx = { userId: "owner", companyId: companyId.toString(), isSuperAdmin: false, userRole: "valuer" as const };
    const id = projectId.toString();

    // 1. Autosave edits a site and adds an empty one (kept because a file goes to it).
    const saved = await service.saveProjectLocations(id, ctx, {
      locations: [
        { id: "site-a", name: "المصنع", city: "الرياض", region: "", latitude: null, longitude: null, primaryPhone: "0500000000" },
        { id: "site-b", name: "المستودع", region: "", city: "", latitude: null, longitude: null },
        { id: "new-site", name: "الموقع الثالث", region: "", city: "", latitude: null, longitude: null },
      ],
    });
    assert.deepEqual(saved.locations.map((l) => l.id), ["site-a", "site-b", "new-site"]);
    assert.equal(saved.locations[0]!.city, "الرياض");
    assert.equal(saved.contacts[0]!.phone, "0500000000");
    assert.equal(saved.inspectorFiles.length, 4, "no file touched");
    const stored = await db.collection("mv_projects").findOne({ _id: projectId });
    assert.equal(stored!.reportData.reportTitle, "تقرير", "report data untouched");
    assert.equal(stored!.name, "Project");

    // 2. Removing a site keeps its files as general project files.
    const removed = await service.saveProjectLocations(id, ctx, {
      locations: [
        { id: "site-b", name: "المستودع", region: "", city: "", latitude: null, longitude: null },
        { id: "new-site", name: "الموقع الثالث", region: "", city: "", latitude: null, longitude: null },
      ],
    });
    const byId = new Map(removed.inspectorFiles.map((f) => [f.id, f]));
    assert.equal(removed.inspectorFiles.length, 4, "files are never deleted with a site");
    assert.deepEqual(byId.get("f1")!.locationIds ?? [], [], "f1 becomes a general file");
    assert.deepEqual(byId.get("f2")!.locationIds, ["site-b"]);
    assert.deepEqual(byId.get("f3")!.locationIds, ["site-b"], "still linked to the remaining site");
    assert.deepEqual(byId.get("f4")!.locationIds ?? [], [], "general file stays general");

    // 3. Uploading to a site that is not saved is refused, never filed under "all sites".
    const upload = (locationIds: string[]) =>
      service.uploadInspectorFile(
        id,
        { buffer: Buffer.from("x"), originalname: "a.jpg", mimetype: "image/jpeg" } as Express.Multer.File,
        ctx,
        JSON.stringify(locationIds),
      );
    await assert.rejects(upload(["unknown-site"]), /غير محفوظ/);
    // A known site passes validation (then stops on the storage, not configured in tests).
    await assert.rejects(upload(["new-site"]), /DigitalOcean Spaces is not configured/);
    await assert.rejects(upload([]), /DigitalOcean Spaces is not configured/);

    // 4. Another company cannot touch the sites.
    await assert.rejects(
      service.saveProjectLocations(id, { ...ctx, companyId: new ObjectId().toString() }, { locations: [] }),
      /not found/i,
    );
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
    for (const [index, key] of ["MONGO_URL_SCRAPPING", "MONGO_DBNAME_SCRAPPING"].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
});
