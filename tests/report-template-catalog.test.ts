import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyReportDefaults } from "@/server/auth-tracking/service";

const WORD_FILE_1 = "64b000000000000000000001";
const WORD_FILE_2 = "64b000000000000000000002";
const PPTX_FILE_1 = "64b000000000000000000003";

test("legacy singleton templates are exposed as named catalogue entries", () => {
  const resolved = resolveCompanyReportDefaults({
    wordTemplate: {
      fileName: "legacy-report.docx",
      gridFsFileId: WORD_FILE_1,
      bookmarkNames: ["clientName"],
      variableMappings: [
        { id: "client", variable: "clientName", sourceKey: "clientName" },
      ],
    },
  });

  assert.equal(resolved.wordTemplates?.length, 1);
  assert.equal(resolved.wordTemplates?.[0]?.id, "word-template-1");
  assert.equal(resolved.wordTemplates?.[0]?.name, "legacy-report");
  assert.deepEqual(resolved.wordTemplate, resolved.wordTemplates?.[0]);
  assert.equal(resolved.wordTemplates?.[0]?.variableMappings?.[0]?.sourceKey, "clientName");
});

test("catalogue templates retain independent mappings and receive unique names", () => {
  const resolved = resolveCompanyReportDefaults({
    wordTemplates: [
      {
        id: "word-a",
        name: "تقرير المشروع",
        fileName: "a.docx",
        gridFsFileId: WORD_FILE_1,
        variableMappings: [
          { id: "a-client", variable: "client", sourceKey: "clientName" },
        ],
      },
      {
        id: "word-b",
        name: "تقرير المشروع",
        fileName: "b.docx",
        gridFsFileId: WORD_FILE_2,
        variableMappings: [
          { id: "b-client", variable: "client", sourceKey: "static", staticValue: "ثابت" },
        ],
      },
    ],
    pptxTemplates: [
      {
        id: "pptx-a",
        name: "عرض مجلس الإدارة",
        fileName: "board.pptx",
        gridFsFileId: PPTX_FILE_1,
      },
    ],
  });

  assert.deepEqual(resolved.wordTemplates?.map((template) => template.name), [
    "تقرير المشروع",
    "تقرير المشروع 2",
  ]);
  assert.equal(resolved.wordTemplates?.[0]?.variableMappings?.[0]?.sourceKey, "clientName");
  assert.equal(resolved.wordTemplates?.[1]?.variableMappings?.[0]?.sourceKey, "static");
  assert.equal(resolved.wordTemplates?.[1]?.variableMappings?.[0]?.staticValue, "ثابت");
  assert.equal(resolved.pptxTemplates?.[0]?.name, "عرض مجلس الإدارة");
  assert.equal(resolved.pptxTemplate?.id, "pptx-a");
});

test("duplicate maximum-length names are numbered without exceeding storage limits", () => {
  const longName = "ق".repeat(160);
  const resolved = resolveCompanyReportDefaults({
    wordTemplates: [
      { id: "long-a", name: longName, fileName: "a.docx", gridFsFileId: WORD_FILE_1 },
      { id: "long-b", name: longName, fileName: "b.docx", gridFsFileId: WORD_FILE_2 },
    ],
  });

  const names = resolved.wordTemplates?.map((template) => template.name ?? "") ?? [];
  assert.equal(names.length, 2);
  assert.equal(names[0], longName);
  assert.notEqual(names[1], longName);
  assert.match(names[1], / 2$/);
  assert.ok(names[1].length <= 160);
});

test("report-data models keep safe company fields for template bindings", () => {
  const resolved = resolveCompanyReportDefaults({
    reportDataModels: [
      {
        id: "equipment-model",
        name: "نموذج المعدات",
        sections: [
          {
            id: "equipment",
            title: "بيانات المعدات",
            fields: [
              {
                id: "equipment-serial",
                sourceKey: "field:equipment-serial",
                label: "الرقم التسلسلي",
                type: "text",
                required: true,
              },
              {
                id: "unsafe-field",
                sourceKey: "reportData.serialNumber",
                label: "يجب استبعاده",
              },
            ],
          },
        ],
      },
    ],
  });

  const fields = resolved.reportDataModels?.[0]?.sections[0]?.fields ?? [];
  assert.deepEqual(fields.map((field) => field.sourceKey), ["field:equipment-serial"]);
  assert.equal(fields[0]?.required, true);
});
