import assert from "node:assert/strict";
import test from "node:test";
import { catalogGrantKeys, PERMISSION_CATALOG } from "../src/permissions/permission-catalog";
import { permissionRequirementForRequest } from "../src/permissions/permissions.guard";
import { COMPANY_MEMBER_ROLES } from "../src/server/auth-tracking/types";

test("company roles keep the requested business order", () => {
  assert.deepEqual(COMPANY_MEMBER_ROLES, [
    "department_head",
    "valuer",
    "associate_valuer",
    "accredited_valuer",
    "data_entry",
    "inspector",
    "reviewer",
  ]);
});

test("permission catalogs contain unique stable grant keys", () => {
  for (const productId of ["machine-valuation", "real-estate-valuation"] as const) {
    const keys = catalogGrantKeys(productId);
    assert.ok((PERMISSION_CATALOG[productId] ?? []).length > 0);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((key) => /^[a-z_]+\.[a-z_]+$/.test(key)));
  }
});

test("permission page labels match the visible Arabic navigation", () => {
  const machine = new Map((PERMISSION_CATALOG["machine-valuation"] ?? []).map((page) => [page.key, page.label]));
  assert.equal(machine.get("project_workflow"), "بيانات التقرير");
  assert.equal(machine.get("asset_data"), "عرض بيانات الأصول");
  assert.equal(machine.get("valuation"), "القيمة");
  assert.equal(machine.get("reports"), "التقرير النهائي");
  assert.equal(machine.get("settings_reports"), "بيانات إعداد التقرير النهائي");
  assert.equal(machine.get("support"), "الدعم والتذاكر");

  const realEstate = new Map((PERMISSION_CATALOG["real-estate-valuation"] ?? []).map((page) => [page.key, page.label]));
  assert.equal(realEstate.get("transactions"), "لوحة المعاملات");
  assert.equal(realEstate.get("valuation"), "تفاصيل المعاملة");
  assert.equal(realEstate.get("reports"), "عرض التقرير النهائي");
  assert.equal(realEstate.get("settings_locations"), "المدن والأحياء");
});

test("protected API routes map to grants present in the default catalog", () => {
  const samples = [
    ["GET", "/api/mv/projects", ""],
    ["POST", "/api/mv/projects", ""],
    ["DELETE", "/api/mv/projects/507f1f77bcf86cd799439011", ""],
    ["POST", "/api/mv/projects/507f1f77bcf86cd799439011/word-template/merge", ""],
    ["POST", "/api/mv/data-extraction", ""],
    ["POST", "/api/assets/import", ""],
    ["PATCH", "/api/transactions/507f1f77bcf86cd799439011/inspectors", ""],
    ["GET", "/api/transactions/507f1f77bcf86cd799439011", ""],
    ["PATCH", "/api/transactions/507f1f77bcf86cd799439011/core", ""],
    ["PATCH", "/api/transactions/507f1f77bcf86cd799439011", ""],
    ["POST", "/api/transactions/507f1f77bcf86cd799439011/notes", ""],
    ["GET", "/api/transactions/507f1f77bcf86cd799439011/pdf", ""],
    ["POST", "/api/transactions/507f1f77bcf86cd799439011/images", ""],
    ["PATCH", "/api/clients/507f1f77bcf86cd799439011", "machine-valuation"],
  ] as const;

  for (const [method, path, productId] of samples) {
    const requirement = permissionRequirementForRequest({
      method,
      path,
      url: path,
      query: productId ? { productId } : {},
    } as never);
    assert.ok(requirement, `${method} ${path} must be protected`);
    assert.ok(
      catalogGrantKeys(requirement.productId).includes(requirement.grant),
      `${requirement.productId}:${requirement.grant} must exist in the catalog`,
    );
  }
});

test("transaction actions map to their precise UI grants", () => {
  const requirement = (method: string, path: string, query: Record<string, string> = {}) =>
    permissionRequirementForRequest({ method, path, url: path, query } as never)?.grant;

  assert.equal(requirement("PATCH", "/api/transactions/abc"), "valuation.edit");
  assert.equal(requirement("POST", "/api/transactions/abc/notes"), "transactions.edit");
  assert.equal(requirement("GET", "/api/transactions/abc/pdf", { disposition: "inline" }), "reports.access");
  assert.equal(requirement("GET", "/api/transactions/abc/pdf", { disposition: "attachment" }), "reports.download");
});

test("machine media and report-data actions map to their visible controls", () => {
  const requirement = (method: string, path: string, query: Record<string, string> = {}, body: object = {}) =>
    permissionRequirementForRequest({ method, path, url: path, query, body } as never)?.grant;

  assert.equal(requirement("GET", "/api/mv/projects/abc/inspectorFiles/a/download"), "asset_media.access");
  assert.equal(requirement("GET", "/api/mv/projects/abc/inspectorFiles/a/download", { attachment: "1" }), "asset_media.download");
  assert.equal(requirement("GET", "/api/mv/projects/abc/files/a/download"), "asset_media.download");
  assert.equal(requirement("PATCH", "/api/mv/projects/abc", {}, { reportData: {} }), "project_workflow.edit");
  assert.equal(requirement("PATCH", "/api/mv/projects/abc", { permissionScope: "reports" }, { reportData: {} }), "reports.edit");
  assert.equal(requirement("PATCH", "/api/mv/projects/abc", {}, { valuationAccountingWorkspace: {} }), "valuation.edit");
  assert.equal(requirement("PATCH", "/api/mv/projects/abc", { permissionScope: "reports" }, { valuationAccountingWorkspace: {} }), "reports.edit");
  assert.equal(requirement("PATCH", "/api/mv/projects/abc", {}, { clientDocumentsWorkspace: {} }), "asset_media.delete");
  assert.equal(requirement("POST", "/api/mv/projects/abc/files", { valuationAccounting: "1" }), "valuation.upload");
  assert.equal(requirement("POST", "/api/mv/projects/abc/attachment-jobs/job", { permissionScope: "valuation" }), "valuation.upload");
  assert.equal(
    requirement("POST", "/api/mv/projects/abc/attachment-jobs/job", { permissionScope: "valuation" }, { field: "clientDocumentsWorkspace" }),
    "asset_media.upload",
  );
});
