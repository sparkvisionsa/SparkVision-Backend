import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deletePendingPdfExport,
  getPendingPdfExport,
  storePendingPdfExport,
} from "../src/machine-valuation/pending-pdf-export";

test("a pending PDF export survives a retry until it expires or is deleted", async (t) => {
  const sourcePath = path.join(os.tmpdir(), `pending-pdf-source-${Date.now()}.pdf`);
  await fs.writeFile(sourcePath, "%PDF-1.4\nretry-safe\n");

  const token = storePendingPdfExport({
    projectId: "project-1",
    sourcePdfPath: sourcePath,
    fileName: "report.pdf",
  });
  t.after(async () => {
    deletePendingPdfExport("project-1", token);
    await fs.rm(sourcePath, { force: true });
  });

  const first = getPendingPdfExport("project-1", token);
  const retry = getPendingPdfExport("project-1", token);
  assert.ok(first);
  assert.deepEqual(retry, first);
  assert.equal(await fs.readFile(first.filePath, "utf8"), "%PDF-1.4\nretry-safe\n");
  assert.equal(getPendingPdfExport("other-project", token), null);
});
