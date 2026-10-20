import assert from "node:assert/strict";
import test from "node:test";
import { catalogGrantKeys, PERMISSION_CATALOG } from "../src/permissions/permission-catalog";
import { permissionRequirementForRequest } from "../src/permissions/permissions.guard";
import { COMPANY_MEMBER_ROLES } from "../src/server/auth-tracking/types";

// ─── helpers ────────────────────────────────────────────────────────────────

type Query = Record<string, string>;

const requirementFor = (
  method: string,
  path: string,
  query: Query = {},
  body: object = {},
) => permissionRequirementForRequest({ method, path, url: path, query, body } as never);

/** The grant key, or undefined when the route is unprotected or admin-gated. */
const grantFor = (method: string, path: string, query: Query = {}, body: object = {}) => {
  const r = requirementFor(method, path, query, body);
  return r && "grant" in r ? r.grant : undefined;
};

const RE = "real-estate-valuation" as const;
const MV = "machine-valuation" as const;
const ID = "507f1f77bcf86cd799439011";

// ─── catalog ────────────────────────────────────────────────────────────────

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
  for (const productId of [MV, RE] as const) {
    const keys = catalogGrantKeys(productId);
    assert.ok((PERMISSION_CATALOG[productId] ?? []).length > 0);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((key) => /^[a-z_]+\.[a-z_]+$/.test(key)));
  }
});

test("permission page labels match the visible Arabic navigation", () => {
  const machine = new Map((PERMISSION_CATALOG[MV] ?? []).map((page) => [page.key, page.label]));
  assert.equal(machine.get("project_workflow"), "بيانات التقرير");
  assert.equal(machine.get("asset_data"), "عرض بيانات الأصول");
  assert.equal(machine.get("valuation"), "القيمة");
  assert.equal(machine.get("reports"), "التقرير النهائي");
  assert.equal(machine.get("settings_reports"), "بيانات إعداد التقرير النهائي");
  assert.equal(machine.get("support"), "الدعم والتذاكر");

  const realEstate = new Map((PERMISSION_CATALOG[RE] ?? []).map((page) => [page.key, page.label]));
  assert.equal(realEstate.get("transactions"), "لوحة المعاملات");
  assert.equal(realEstate.get("valuation"), "تفاصيل المعاملة");
  assert.equal(realEstate.get("reports"), "عرض التقرير النهائي");
});

test("real estate catalog exposes only delegable pages", () => {
  const pages = (PERMISSION_CATALOG[RE] ?? []).map((page) => page.key);
  assert.deepEqual(pages, ["transactions", "valuation", "property_media", "reports", "clients", "support"]);
  assert.ok(pages.every((key) => !key.startsWith("settings_")));

  const keys = catalogGrantKeys(RE);
  assert.ok(!keys.includes("transactions.delete"), "delete is admin-only, not a grant");
  for (const required of ["transactions.status", "transactions.assign", "transactions.edit", "transactions.create"]) {
    assert.ok(keys.includes(required), `${required} must exist`);
  }
});

// ─── every protected grant route resolves to a catalog entry ────────────────

test("protected API routes map to grants present in the default catalog", () => {
  const samples: Array<[string, string, Query]> = [
    ["GET", "/api/mv/projects", {}],
    ["POST", "/api/mv/projects", {}],
    ["DELETE", `/api/mv/projects/${ID}`, {}],
    ["POST", `/api/mv/projects/${ID}/word-template/merge`, {}],
    ["POST", "/api/mv/data-extraction", {}],
    ["POST", "/api/assets/import", {}],
    ["PATCH", `/api/transactions/${ID}/inspectors`, {}],
    ["GET", `/api/transactions/${ID}`, {}],
    ["PATCH", `/api/transactions/${ID}/core`, {}],
    ["PATCH", `/api/transactions/${ID}`, {}],
    ["PATCH", `/api/transactions/${ID}/status`, {}],
    ["PATCH", `/api/transactions/${ID}/completed`, {}],
    ["POST", `/api/transactions/${ID}/notes`, {}],
    ["GET", `/api/transactions/${ID}/pdf`, {}],
    ["POST", `/api/transactions/${ID}/images`, {}],
    ["GET", "/api/transactions/freelance-inspectors", {}],
    ["GET", "/api/transactions/company-inspectors", {}],
    ["PATCH", `/api/clients/${ID}`, { productId: MV }],
    ["POST", "/api/transactions", {}],
  ];

  for (const [method, path, query] of samples) {
    const requirement = requirementFor(method, path, query);
    assert.ok(requirement, `${method} ${path} must be protected`);
    assert.ok("grant" in requirement, `${method} ${path} should be grant-based`);
    assert.ok(
      catalogGrantKeys(requirement.productId).includes(requirement.grant),
      `${requirement.productId}:${requirement.grant} must exist in the catalog`,
    );
  }
});

// ─── real estate transactions ───────────────────────────────────────────────

test("transaction actions map to their precise UI grants", () => {
  assert.equal(grantFor("PATCH", "/api/transactions/abc"), "valuation.edit");
  assert.equal(grantFor("GET", "/api/transactions/abc"), "valuation.access");
  assert.equal(grantFor("PATCH", "/api/transactions/abc/core"), "valuation.edit");
  assert.equal(grantFor("POST", "/api/transactions"), "transactions.create");
  assert.equal(grantFor("GET", "/api/transactions"), "transactions.access");
  assert.equal(grantFor("POST", "/api/transactions/abc/notes"), "transactions.edit");
  assert.equal(grantFor("GET", "/api/transactions/abc/notes"), "transactions.access");
  assert.equal(grantFor("PATCH", "/api/transactions/abc/inspectors"), "transactions.assign");
});

test("status and completed use their own grant, independent of valuation.edit", () => {
  assert.equal(grantFor("PATCH", "/api/transactions/abc/status"), "transactions.status");
  assert.equal(grantFor("PATCH", "/api/transactions/abc/completed"), "transactions.status");
});

test("pdf defaults to download; only an explicit inline view needs access", () => {
  assert.equal(grantFor("GET", "/api/transactions/abc/pdf"), "reports.download");
  assert.equal(grantFor("GET", "/api/transactions/abc/pdf", { disposition: "attachment" }), "reports.download");
  assert.equal(grantFor("GET", "/api/transactions/abc/pdf", { disposition: "inline" }), "reports.access");
});

test("inspector pickers are gated by transactions.assign, not by opening a transaction", () => {
  assert.equal(grantFor("GET", "/api/transactions/freelance-inspectors"), "transactions.assign");
  assert.equal(grantFor("GET", "/api/transactions/company-inspectors"), "transactions.assign");
});

test("property media actions map to their grants", () => {
  assert.equal(grantFor("GET", "/api/transactions/abc/images"), "property_media.access");
  assert.equal(grantFor("POST", "/api/transactions/abc/images"), "property_media.upload");
  assert.equal(grantFor("PATCH", "/api/transactions/abc/images/reorder"), "property_media.edit");
  assert.equal(grantFor("PATCH", "/api/transactions/abc/images/img1"), "property_media.edit");
  assert.equal(grantFor("DELETE", "/api/transactions/abc/images/img1"), "property_media.delete");
  assert.equal(grantFor("DELETE", "/api/transactions/abc/attachments"), "property_media.delete");
  assert.equal(grantFor("POST", "/api/transactions/abc/attachments"), "property_media.upload");
});

// ─── admin-only / super-admin-only ──────────────────────────────────────────

test("deleting a transaction is admin-only, while deleting its media is not", () => {
  assert.deepEqual(requirementFor("DELETE", "/api/transactions/abc"), { adminOnly: true });
  assert.equal(grantFor("DELETE", "/api/transactions/abc/images/img1"), "property_media.delete");
});

test("real estate report settings: reads open, writes admin-only", () => {
  for (const path of ["/api/company/real-estate-report-template", "/api/company/admin/report-defaults"]) {
    const query = { productId: RE };
    assert.equal(requirementFor("GET", path, query), null, `GET ${path}`);
    assert.deepEqual(requirementFor("PATCH", path, query), { adminOnly: true }, `PATCH ${path}`);
  }
  assert.deepEqual(requirementFor("PATCH", "/api/company/real-estate-report-template"), { adminOnly: true });
});

test("machine report settings still use the settings_reports grants", () => {
  const query = { productId: MV };
  assert.equal(grantFor("GET", "/api/company/admin/report-defaults", query), "settings_reports.access");
  assert.equal(grantFor("PATCH", "/api/company/admin/report-defaults", query), "settings_reports.edit");
});

test("location writes are super-admin-only; reads stay open for dropdowns", () => {
  for (const path of ["/api/locations/regions", "/api/locations/cities", "/api/locations/neighborhoods"]) {
    assert.equal(requirementFor("GET", path), null, `GET ${path}`);
    for (const method of ["POST", "PATCH", "DELETE"]) {
      assert.deepEqual(requirementFor(method, `${path}/x`), { superAdminOnly: true }, `${method} ${path}`);
    }
  }
});

test("the permissions API itself is not grant-gated (the service checks admin + CSRF)", () => {
  assert.equal(requirementFor("GET", "/api/company/permissions/effective"), null);
  assert.equal(requirementFor("PUT", "/api/company/permissions/users/abc"), null);
});

// ─── clients: product comes from query OR body ──────────────────────────────

test("client writes read the product from the body when the query has none", () => {
  for (const path of ["/api/clients", "/api/client-types", "/api/form-templates"]) {
    assert.deepEqual(
      requirementFor("POST", path, {}, { productId: MV }),
      { productId: MV, grant: "clients.create" },
      `${path} (machine body)`,
    );
    assert.deepEqual(
      requirementFor("POST", path, {}, { productId: RE }),
      { productId: RE, grant: "clients.create" },
      `${path} (real estate body)`,
    );
  }
});

test("client product resolution prefers the query and falls back to real estate", () => {
  assert.deepEqual(
    requirementFor("PATCH", `/api/clients/${ID}`, { productId: MV }),
    { productId: MV, grant: "clients.edit" },
  );
  assert.deepEqual(
    requirementFor("DELETE", `/api/clients/${ID}`, { productId: MV }, { productId: RE }),
    { productId: MV, grant: "clients.delete" },
  );
  assert.deepEqual(requirementFor("POST", "/api/clients"), { productId: RE, grant: "clients.create" });
  assert.deepEqual(
    requirementFor("POST", "/api/clients", {}, { productId: "bogus" }),
    { productId: RE, grant: "clients.create" },
  );
});

// ─── machine valuation ──────────────────────────────────────────────────────

test("machine media and report-data actions map to their visible controls", () => {
  assert.equal(grantFor("GET", "/api/mv/projects/abc/inspectorFiles/a/download"), "asset_media.access");
  assert.equal(grantFor("GET", "/api/mv/projects/abc/inspectorFiles/a/download", { attachment: "1" }), "asset_media.download");
  assert.equal(grantFor("GET", "/api/mv/projects/abc/files/a/download"), "asset_media.download");
  assert.equal(grantFor("PATCH", "/api/mv/projects/abc", {}, { reportData: {} }), "project_workflow.edit");
  assert.equal(grantFor("PATCH", "/api/mv/projects/abc", { permissionScope: "reports" }, { reportData: {} }), "reports.edit");
  assert.equal(grantFor("PATCH", "/api/mv/projects/abc", {}, { valuationAccountingWorkspace: {} }), "valuation.edit");
  assert.equal(grantFor("PATCH", "/api/mv/projects/abc", { permissionScope: "reports" }, { valuationAccountingWorkspace: {} }), "reports.edit");
  assert.equal(grantFor("PATCH", "/api/mv/projects/abc", {}, { clientDocumentsWorkspace: {} }), "asset_media.delete");
  assert.equal(grantFor("POST", "/api/mv/projects/abc/files", { valuationAccounting: "1" }), "valuation.upload");
  assert.equal(grantFor("POST", "/api/mv/projects/abc/attachment-jobs/job", { permissionScope: "valuation" }), "valuation.upload");
  assert.equal(
    grantFor("POST", "/api/mv/projects/abc/attachment-jobs/job", { permissionScope: "valuation" }, { field: "clientDocumentsWorkspace" }),
    "asset_media.upload",
  );
});
