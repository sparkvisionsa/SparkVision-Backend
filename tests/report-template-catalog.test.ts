import test from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyReportDefaults } from "@/server/auth-tracking/service";
import { formatReportTemplateTeam } from "@/machine-valuation/report-template-team";

const WORD_FILE_1 = "64b000000000000000000001";
const WORD_FILE_2 = "64b000000000000000000002";
const PPTX_FILE_1 = "64b000000000000000000003";

test("removed custom report branding falls back to the built-in system template", () => {
  const resolved = resolveCompanyReportDefaults({
    letterhead: {
      templateId: "removed-custom-template",
      outputFormat: "pptx",
      enabled: true,
      coverImageDataUrl: "data:image/png;base64,legacy",
      pageImageDataUrl: "/uploads/company-report-templates/legacy/page.png",
    },
  } as never);

  assert.deepEqual(resolved.letterhead, {
    templateId: "default-report-template",
    outputFormat: "pdf",
    customTemplates: [],
  });
});

test("only the Value Tech official built-in template remains available", () => {
  const resolved = resolveCompanyReportDefaults({
    letterhead: {
      templateId: "powerpoint-deck",
      outputFormat: "pdf",
      companyName: "شركة فاليو تك للتقييم",
      headerLine: "مقيم معتمد",
      footerText: "الرياض، المملكة العربية السعودية",
      logoPosition: "center",
      showOnAllPages: false,
      dataModelId: "individual",
    },
  });

  assert.deepEqual(resolved.letterhead, {
    templateId: "default-report-template",
    outputFormat: "pdf",
    customTemplates: [],
    companyName: "شركة فاليو تك للتقييم",
    headerLine: "مقيم معتمد",
    footerText: "الرياض، المملكة العربية السعودية",
    logoPosition: "center",
    showOnAllPages: false,
    dataModelId: "individual",
  });
});

test("custom system templates retain their design and can become the company default", () => {
  const resolved = resolveCompanyReportDefaults({
    letterhead: {
      templateId: "system-template-premium",
      outputFormat: "pptx",
      customTemplates: [{
        id: "system-template-premium",
        name: "قالب الشركة التنفيذي",
        description: "هوية خاصة للشركة",
        summaryTable: {
          enabled: true,
          title: "ملخص التقييم",
          labelColumnPct: 95,
          fields: [
            { id: "row-client", sourceKey: "clientName", label: "اسم العميل" },
            { id: "row-date", sourceKey: "valuationDate", label: "تاريخ التقييم", type: "date" },
            { id: "row-custom", sourceKey: "field:deed", label: "رقم الصك", type: "unknown" },
            { id: "row-client", sourceKey: "duplicate", label: "مكرر" },
            { id: "row-empty", sourceKey: "", label: "بلا مصدر" },
            { id: "row-own", sourceKey: "custom", label: "الجهة", valueTemplate: "{{clientName}} - فرع الرياض" },
          ],
        },
        colors: {
          primary: "#123456",
          secondary: "#07111F",
          accent: "#D4AF37",
          coverText: "#FFFFFF",
          text: "#111827",
          mutedText: "#64748B",
          pageBackground: "#FAFAFA",
          headerBackground: "#FFFFFF",
          footerBackground: "#F1F5F9",
          closingPrimary: "#5B2133",
          closingSecondary: "#240A12",
          closingText: "#FFF7ED",
        },
        typography: {
          fontFamily: "Arial, sans-serif",
          headingFontFamily: "Tahoma, sans-serif",
          baseFontSize: 13,
          headingScale: 1.15,
          lineHeight: 1.8,
          fontWeight: 500,
          googleFontUrl: "https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap",
        },
        assets: {
          coverBackgroundImage: "data:image/png;base64,YWJj",
          closingBackgroundImage: "data:image/webp;base64,YWJj",
        },
        layout: {
          backgroundFit: "cover",
          contentAlign: "center",
          logoPosition: "left",
          pageMarginMm: 14,
          headerHeightMm: 24,
          footerHeightMm: 18,
          coverOverlayOpacity: 0.25,
          borderRadiusPx: 8,
          showHeader: true,
          showFooter: true,
          showLogo: true,
          showWatermark: true,
          coverColorMode: "gradient",
          coverGradientAngle: 120,
          closingColorMode: "solid",
          closingGradientAngle: 210,
          closingOverlayOpacity: 0.35,
        },
        canvasElements: [{
          id: "cover-title",
          name: "Cover title",
          page: "cover",
          kind: "binding",
          binding: "companyName",
          x: 12.5,
          y: 23,
          width: 75,
          height: 9,
          rotation: -2,
          zIndex: 30,
          opacity: 0.9,
          color: "#FFFFFF",
          fontSize: 22,
          fontWeight: 800,
          textAlign: "center",
        }, {
          id: "cover-shape",
          name: "Cover star",
          page: "cover",
          kind: "shape",
          shapeType: "star",
          x: 5,
          y: 5,
          width: 12,
          height: 12,
          rotation: 0,
          zIndex: 5,
          opacity: 1,
          backgroundColor: "#D4AF37",
        }],
      }],
    },
  });

  assert.equal(resolved.letterhead?.templateId, "system-template-premium");
  assert.equal(resolved.letterhead?.outputFormat, "pdf");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.name, "قالب الشركة التنفيذي");
  assert.deepEqual(resolved.letterhead?.customTemplates?.[0]?.summaryTable, {
    enabled: true,
    title: "ملخص التقييم",
    labelColumnPct: 70,
    fields: [
      { id: "row-client", sourceKey: "clientName", label: "اسم العميل", type: "text" },
      { id: "row-date", sourceKey: "valuationDate", label: "تاريخ التقييم", type: "date" },
      { id: "row-custom", sourceKey: "field:deed", label: "رقم الصك", type: "text" },
      { id: "row-own", sourceKey: "custom", label: "الجهة", type: "text", valueTemplate: "{{clientName}} - فرع الرياض" },
    ],
  });
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.colors.primary, "#123456");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.typography.headingScale, 1.15);
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.layout.showWatermark, true);
  assert.match(resolved.letterhead?.customTemplates?.[0]?.assets.coverBackgroundImage ?? "", /^data:image\/png/);
  const canvasElement = resolved.letterhead?.customTemplates?.[0]?.canvasElements?.[0];
  assert.equal(canvasElement?.id, "cover-title");
  assert.equal(canvasElement?.binding, "companyName");
  assert.equal(canvasElement?.x, 12.5);
  assert.equal(canvasElement?.rotation, -2);
  assert.equal(canvasElement?.fontSize, 22);
  assert.equal(canvasElement?.color, "#FFFFFF");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.canvasElements?.[1]?.shapeType, "star");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.typography.googleFontUrl, "https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.layout.coverGradientAngle, 120);
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.colors.closingPrimary, "#5B2133");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.colors.closingText, "#FFF7ED");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.layout.closingColorMode, "solid");
  assert.equal(resolved.letterhead?.customTemplates?.[0]?.layout.closingOverlayOpacity, 0.35);
});

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

test("Word and PowerPoint templates retain their selected report-data model independently", () => {
  const resolved = resolveCompanyReportDefaults({
    wordTemplates: [{ id: "word-model", fileName: "model.docx", gridFsFileId: WORD_FILE_1, reportDataModelId: "individual" }],
    pptxTemplates: [{ id: "pptx-model", fileName: "model.pptx", gridFsFileId: PPTX_FILE_1, reportDataModelId: "equipment" }],
  });
  assert.equal(resolved.wordTemplates?.[0]?.reportDataModelId, "individual");
  assert.equal(resolved.pptxTemplates?.[0]?.reportDataModelId, "equipment");
});

test("report-section models preserve sidebar order, visibility, and edited item content", () => {
  const resolved = resolveCompanyReportDefaults({
    reportSectionModels: [
      {
        id: "custom-report-sections",
        name: "نموذج تقرير مخصص",
        isDefault: true,
        visibleInReport: true,
        sections: [
          {
            id: "section-two",
            title: "القسم الثاني",
            sectionNumber: "2",
            visibleInReport: false,
            items: [
              {
                id: "item-two",
                title: "البند الثاني",
                body: "محتوى البند المعدل",
                visibleInReport: true,
                overrideSystemContent: true,
              },
            ],
          },
          {
            id: "section-one",
            title: "القسم الأول",
            sectionNumber: "1",
            visibleInReport: true,
            items: [
              {
                id: "item-one",
                title: "البند الأول",
                body: "محتوى مخفي",
                visibleInReport: false,
              },
            ],
          },
        ],
      },
    ],
  });

  const model = resolved.reportSectionModels?.[0];
  assert.equal(model?.id, "custom-report-sections");
  assert.equal(model?.isDefault, true);
  assert.deepEqual(model?.sections.map((section) => section.id), ["section-two", "section-one"]);
  assert.equal(model?.sections[0]?.visibleInReport, false);
  assert.equal(model?.sections[0]?.items[0]?.body, "محتوى البند المعدل");
  assert.equal(model?.sections[0]?.items[0]?.overrideSystemContent, true);
  assert.equal(model?.sections[1]?.items[0]?.visibleInReport, false);
});

test("the report-team source resolves structured members to readable template text", () => {
  assert.equal(formatReportTemplateTeam([
    { name: "أحمد", title: "مقيم", membershipNo: "123", role: "إعداد التقرير" },
    { name: "سارة", role: "مراجعة" },
    null,
  ]), "أحمد — مقيم — 123 — إعداد التقرير\nسارة — مراجعة");
  assert.equal(formatReportTemplateTeam(undefined), "");
});
