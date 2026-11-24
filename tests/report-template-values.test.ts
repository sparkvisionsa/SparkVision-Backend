import assert from "node:assert/strict";
import test from "node:test";
import { buildTextValues } from "../src/machine-valuation/word-template-merge.service";
import { buildPptxTextValues } from "../src/machine-valuation/pptx-template-merge.service";

/** Every source key of the default report-data model (frontend catalogue). */
const MODEL_SOURCE_KEYS = [
  "displayNumber", "projectName", "reportTitle", "reportReference", "assetSingularPlural",
  "valuationMethod", "valuationPurpose", "valuePremise", "valuationBasis", "reportTypeLabel",
  "standardsVersion", "currencyLabel", "reportIssueDate", "inspectionDate", "valuationDate",
  "agreementDate", "inspectionLocation", "inspectionMapUrl", "clientId", "clientName",
  "clientEmail", "clientPhone", "clientLegalType", "clientActivity", "clientRepresentativeName",
  "clientRepresentativeRole", "intendedUsers", "intendedUse", "finalValue", "finalValueWords",
  "assetSubjectDescription", "assetDetailedDescription", "valuationBasisDefinition",
  "valuePremiseDefinition", "valuationTeam",
];

const reportData: Record<string, unknown> = {
  reportTitle: "تقرير خط الإنتاج",
  reportReference: "REF-77",
  clientName: "شركة الاختبار",
  clientPhone: "0500000000",
  intendedUse: "التمويل",
  reportIssueDate: "2026-08-02",
  valuationDate: "2026-07-30",
  finalValue: 1250000,
  valuationTeam: [{ id: "u1", name: "أحمد", role: "إعداد التقرير" }],
  customFields: [
    { id: "maker", sectionId: "machine", modelId: "m", label: "الشركة المصنعة", type: "text", required: false, value: "سيمنس" },
    { id: "made-on", sectionId: "machine", label: "تاريخ الصنع", type: "date", required: false, value: "2019-03-05" },
    { id: "hours", sectionId: "machine", label: "ساعات التشغيل", type: "number", required: false, value: "12500.5" },
  ],
  reportTextOverrides: { clientPhone: "0555555555" },
};
const identity = { companyName: "شركة التقييم المعتمدة", managerName: "خالد المدير", managerTitle: "مقيم معتمد", managerMembershipNo: "1210000" };

for (const [name, build] of [
  ["Word", buildTextValues],
  ["PowerPoint", buildPptxTextValues],
] as const) {
  test(`${name} template variables carry the report data`, () => {
    const values = build(reportData, "مشروع الاختبار", 42, identity);
    for (const key of MODEL_SOURCE_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(values, key), `${name} has no value for ${key}`);
    }
    assert.equal(values.reportTitle, "تقرير خط الإنتاج");
    assert.equal(values.clientName, "شركة الاختبار");
    assert.equal(values.reportReference, "REF-77");
    assert.equal(values.intendedUse, "التمويل");
    assert.equal(values.reportIssueDate, "02/08/2026");
    assert.equal(values.displayNumber, "42");
    assert.match(values.finalValue, /1,250,000/);
    assert.match(values.valuationTeam, /أحمد/);
    // Custom / report-data-model fields (`field:<id>`), formatted by type.
    assert.equal(values.maker, "سيمنس");
    assert.equal(values["made-on"], "05/03/2019");
    assert.equal(values.hours, "12500.5", "numbers print as typed");
    // Same fallbacks as the system report.
    assert.equal(values.valuationFirmName, "شركة التقييم المعتمدة");
    assert.equal(values.leadValuerName, "خالد المدير");
    assert.equal(values.leadValuerMembershipNo, "1210000");
    // Edits made on the final report win.
    assert.equal(values.clientPhone, "0555555555");
  });

  test(`${name} never replaces data typed in the report with a fallback`, () => {
    const values = build(
      { ...reportData, valuationFirmName: "منشأة أخرى", leadValuerName: "سارة", leadValuerMembershipNo: "" },
      "مشروع",
      1,
      identity,
    );
    assert.equal(values.valuationFirmName, "منشأة أخرى");
    assert.equal(values.leadValuerName, "سارة");
    assert.equal(values.leadValuerMembershipNo, "", "the manager's number is not attributed to another valuer");
  });
}
