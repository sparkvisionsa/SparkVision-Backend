import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { canonicalLabel } from "../src/machine-valuation/document-layout-ocr";
import {
  DataExtractionService,
  DATA_EXTRACTION_DEFAULT_MODEL,
  extractFieldsFromTextPages,
  isUsableNativePdfText,
  isCoherentExtractionField,
  mergeDataExtractionResults,
  normalizeDataExtractionResponse,
  sniffMimeType,
} from "../src/machine-valuation/data-extraction.service";

const mockImage = () => ({ originalname: "stamp.jpg", mimetype: "image/jpeg",
  buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3 } as Express.Multer.File);
const mockLocal = () => ({ documentType: "ختم", language: "العربية", fields: [
  { id: "local", label: "رقم السجل التجاري", value: "7051814510", category: "organization", confidence: "medium" },
], pages: [{ page: 1, text: "س.ت: 7051814510" }], pageCount: 1 });

test("AI rejection before slow OCR is handled without an unhandled rejection or leaking provider details", async () => {
  const service = new DataExtractionService();
  const internals = service as any;
  internals.apiKey = "test-only";
  internals.extractWithAi = async () => { throw Object.assign(new Error("provider URL containing secret-key"), { status: 404 }); };
  internals.extractLocally = async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    return mockLocal();
  };
  const result = await service.extract([mockImage()]);
  assert.equal(result.documents[0].engine, "local");
  assert.equal(result.documents[0].status, "completed");
  assert.equal(result.documents[0].needsReview, true);
  assert.match(result.documents[0].message!, /MV_DATA_EXTRACTION_AI_MODEL/);
  assert.doesNotMatch(JSON.stringify(result), /secret-key|provider URL/);
});

test("successful paid AI extraction skips local OCR and preserves stamp text and leading zeros", async () => {
  const service = new DataExtractionService();
  const internals = service as any;
  internals.apiKey = "test-only";
  let localCalls = 0;
  internals.extractLocally = async () => { localCalls++; throw new Error("OCR should not run"); };
  internals.extractWithAi = async () => [normalizeDataExtractionResponse(JSON.stringify({
    documentType: "ختم شركة", language: "العربية", fields: [
      { label: "اسم الشركة", value: "برو أوبشن للاستشارات المهنية", category: "organization", confidence: "high" },
      { label: "رقم السجل التجاري", value: "007051814510", category: "organization", inputType: "text", confidence: "high" },
    ],
  }))];
  const result = await service.extract([mockImage()]);
  assert.equal(localCalls, 0);
  assert.equal(result.documents[0].engine, "gemini");
  assert.equal(result.documents[0].pageCount, 1);
  assert.equal(result.documents[0].fields[1].value, "007051814510");
  assert.match(internals.extractionPrompt("stamp.jpg", [1]), /inside or beside logos and stamps/);
});

test("empty AI results use local OCR and a failed OCR does not stop later files", async () => {
  const service = new DataExtractionService();
  const internals = service as any;
  internals.apiKey = "test-only";
  internals.extractWithAi = async () => [{ documentType: "unknown", language: "unknown", fields: [] }];
  let localCalls = 0;
  internals.extractLocally = async () => {
    if (++localCalls === 1) throw new Error("private OCR details");
    return mockLocal();
  };
  const { documents } = await service.extract([mockImage(), mockImage()]);
  assert.equal(documents[0].status, "error");
  assert.doesNotMatch(documents[0].message!, /private OCR/);
  assert.equal(documents[1].status, "completed");
});

test("Gemini request retries transient errors once, uses a deadline, and never retries a 404", async () => {
  const internals = new DataExtractionService() as any;
  let calls = 0;
  const response = { response: { text: () => "{}" } };
  const model = { generateContent: async (_content: unknown, options: { timeout: number }) => {
    assert.ok(options.timeout >= 10_000 && options.timeout <= 120_000);
    if (++calls === 1) throw Object.assign(new Error("unavailable"), { status: 503 });
    return response;
  } };
  assert.equal(await internals.generateAiContent(model, ["test"]), response);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(internals.generateAiContent({ generateContent: async () => {
    calls++; throw Object.assign(new Error("not found"), { status: 404 });
  } }, ["test"]), /not found/);
  assert.equal(calls, 1);
});

test("extraction model defaults independently of the legacy support model", () => {
  const old = process.env.MV_DATA_EXTRACTION_AI_MODEL, support = process.env.SUPPORT_AI_MODEL;
  try {
    delete process.env.MV_DATA_EXTRACTION_AI_MODEL;
    process.env.SUPPORT_AI_MODEL = "gemini-2.5-flash";
    assert.equal((new DataExtractionService() as any).modelName, DATA_EXTRACTION_DEFAULT_MODEL);
    process.env.MV_DATA_EXTRACTION_AI_MODEL = "configured-model";
    assert.equal((new DataExtractionService() as any).modelName, "configured-model");
  } finally {
    if (old === undefined) delete process.env.MV_DATA_EXTRACTION_AI_MODEL; else process.env.MV_DATA_EXTRACTION_AI_MODEL = old;
    if (support === undefined) delete process.env.SUPPORT_AI_MODEL; else process.env.SUPPORT_AI_MODEL = support;
  }
});

test("PDF model errors are not amplified into per-page calls, but incomplete JSON is split safely", async () => {
  const document = await PDFDocument.create();
  document.addPage([120, 120]); document.addPage([120, 120]);
  const buffer = Buffer.from(await document.save());
  const file = { originalname: "two-pages.pdf", mimetype: "application/pdf", buffer, size: buffer.length } as Express.Multer.File;
  const internals = new DataExtractionService() as any;
  internals.apiKey = "test-only";
  let calls = 0;
  internals.extractAiImageBatch = async () => { calls++; throw Object.assign(new Error("not available"), { status: 404 }); };
  await assert.rejects(internals.extractWithAi(file, file.mimetype, file.originalname, 2), /not available/);
  assert.equal(calls, 1);
  internals.extractAiImageBatch = async (_model: unknown, _name: string, pages: { page: number }[]) => {
    if (pages.length > 1) throw new SyntaxError("Truncated JSON");
    return { documentType: "document", language: "English", fields: [{ id: "page", label: "Page", value: String(pages[0].page), page: pages[0].page }] };
  };
  const result = await internals.extractWithAi(file, file.mimetype, file.originalname, 2);
  assert.deepEqual(result.flatMap((row: any) => row.fields.map((field: any) => field.page)), [1, 2]);
});

test("normalizes dynamic fields and removes empty or duplicate values", () => {
  const result = normalizeDataExtractionResponse(`\`\`\`json
  {
    "documentType": "رخصة قيادة",
    "language": "Arabic",
    "fields": [
      {"label":"رقم الرخصة","value":"123456","category":"license","confidence":"high","page":1},
      {"label":"رقم الرخصة","value":"123456","category":"license","confidence":"high","page":1},
      {"label":"الاسم","value":"  أحمد   محمد  ","category":"identity","confidence":"unexpected"},
      {"label":"صورة شخصية","value":"غير موجود","category":"other","confidence":"low"},
      {"label":"","value":"ignored"}
    ]
  }
  \`\`\``);

  assert.equal(result.documentType, "رخصة قيادة");
  assert.equal(result.fields.length, 2);
  assert.deepEqual(result.fields[0], {
    id: "field-1",
    label: "رقم الرخصة",
    value: "123456",
    category: "license",
    confidence: "high",
    page: 1,
  });
  assert.equal(result.fields[1]?.value, "أحمد محمد");
  assert.equal(result.fields[1]?.confidence, "medium");
});

test("sanitizes unsupported categories and invalid page numbers", () => {
  const result = normalizeDataExtractionResponse(JSON.stringify({
    documentType: "Invoice",
    language: "English",
    fields: [
      { label: "Total", value: "SAR 100", category: "unknown", confidence: "low", page: -3 },
    ],
  }));

  assert.equal(result.fields[0]?.category, "other");
  assert.equal(result.fields[0]?.confidence, "low");
  assert.equal(result.fields[0]?.page, undefined);
});

test("rejects fragmented Arabic glyph pairs while preserving compact valid fields", () => {
  assert.equal(isCoherentExtractionField("ة ا", "ي"), false);
  assert.equal(isCoherentExtractionField("ود ا", "ق"), false);
  assert.equal(isCoherentExtractionField("رقم الطلب", "264531"), true);
  assert.equal(isCoherentExtractionField("الحالة", "0"), true);
  assert.equal(isCoherentExtractionField("ID", "A7"), true);
  assert.equal(isCoherentExtractionField("س . ت", "7051814510"), true);
  const stamp = normalizeDataExtractionResponse(JSON.stringify({ fields: [{ label: "س.ت", value: "7051814510" }] }));
  assert.equal(stamp.fields[0]?.value, "7051814510");
});

test("drops interface labels and pairs that only repeat the same visible text", () => {
  const result = normalizeDataExtractionResponse(JSON.stringify({
    fields: [
      { label: "نص زر", value: "إرسال", category: "other", confidence: "high" },
      { label: "إرسال", value: "إرسال", category: "other", confidence: "high" },
      { label: "رقم الطلب", value: "264531", category: "document", confidence: "high" },
    ],
  }));
  assert.deepEqual(result.fields.map((field) => field.label), ["رقم الطلب"]);
});

test("preserves the AI-recommended report input type for each extracted field", () => {
  const result = normalizeDataExtractionResponse(JSON.stringify({
    fields: [
      { label: "تاريخ التكليف", value: "1448/04/06", category: "date", inputType: "date", confidence: "high" },
      { label: "وصف الأصل", value: "وصف تفصيلي طويل للأصل محل التقييم", category: "document", inputType: "textarea", confidence: "high" },
      { label: "القيمة التقديرية", value: "250000", category: "financial", inputType: "number", confidence: "high" },
      { label: "رقم الرخصة", value: "001245", category: "license", inputType: "text", confidence: "high" },
    ],
  }));

  assert.deepEqual(result.fields.map((field) => [field.label, field.inputType]), [
    ["تاريخ التكليف", "date"],
    ["وصف الأصل", "textarea"],
    ["القيمة التقديرية", "number"],
    ["رقم الرخصة", "text"],
  ]);
});

test("rejects non-object model output", () => {
  assert.throws(() => normalizeDataExtractionResponse("[]"), /not a JSON object/);
});

test("retains every table row, printed absence values and fields beyond the old 120-field cutoff", () => {
  const fields = Array.from({ length: 150 }, (_, index) => ({ label: "رقم الأصل", value: "42", section: "الأصول", row: index + 1, page: 1 }));
  const result = normalizeDataExtractionResponse(JSON.stringify({ fields: [...fields, { label: "الموقع", value: "لا يوجد", section: "العقار" }] }));
  assert.equal(result.fields.length, 151);
  assert.equal(result.fields[149]?.row, 150);
  assert.equal(result.fields[150]?.value, "لا يوجد");
});

test("repairs Arabic label spacing without adding identifiers to labels", () => {
  assert.equal(canonicalLabel("رقمالوثيقة"), "رقم الوثيقة");
  assert.equal(canonicalLabel("قمالهوية\n2"), "رقم الهوية");
  const result = extractFieldsFromTextPages([{ page: 1, text: "472109000136 الرقم: abc\n2022/03/28 التاريخ: nonsense", confidence: 50 }]);
  assert.equal(result.fields.some(f => /472109000136|2022/.test(f.label)), false);
});

test("keeps identical printed fields on separate pages", () => {
  const result = extractFieldsFromTextPages([{ page: 1, text: "Name: Jane" }, { page: 2, text: "Name: Jane" }]);
  assert.deepEqual(result.fields.map(f => f.page), [1, 2]);
});

test("extracts Arabic identity and license fields locally without an AI key", () => {
  const result = extractFieldsFromTextPages([{ page: 1, text: [
    "المملكة العربية السعودية",
    "رخصة قيادة",
    "الاسم: أحمد محمد علي",
    "رقم الهوية ١٠٢٣٤٥٦٧٨٩",
    "رقم الرخصة: 987654321",
    "تاريخ الإصدار: 1445/01/10",
    "تاريخ الانتهاء",
    "1450/01/10",
    "الصورة الشخصية",
  ].join("\n"), confidence: 88 }]);

  assert.equal(result.documentType, "رخصة قيادة");
  assert.equal(result.language, "العربية");
  assert.deepEqual(
    result.fields.map((field) => [field.label, field.value, field.category]),
    [
      ["الاسم", "أحمد محمد علي", "identity"],
      ["رقم الهوية", "١٠٢٣٤٥٦٧٨٩", "identity"],
      ["رقم الرخصة", "987654321", "license"],
      ["تاريخ الإصدار", "1445/01/10", "date"],
      ["تاريخ الانتهاء", "1450/01/10", "date"],
    ],
  );
});

test("extracts generic English key-value fields and excludes visual-only fields", () => {
  const result = extractFieldsFromTextPages([{ page: 2, text: [
    "Invoice",
    "Invoice Number: INV-2048",
    "Company Name: Spark Vision",
    "Total Amount: SAR 2,500.00",
    "Logo: blue square",
  ].join("\n") }]);

  assert.equal(result.documentType, "فاتورة");
  assert.equal(result.language, "English");
  assert.equal(result.fields.some((field) => /logo/i.test(field.label)), false);
  assert.equal(result.fields.some((field) => field.value === "INV-2048"), true);
  assert.equal(result.fields.some((field) => field.category === "financial"), true);
});

test("normalizes Arabic presentation forms and extracts facts from a legal letter", () => {
  const result = extractFieldsFromTextPages([{ page: 1, confidence: 100, text: [
    "1448/04/07",
    "ﻭﺯﺍﺭﺓ ﺍﻟﻌﺪﻝ\tﺍﻟﻤﻮﺿﻮﻉ: ﺧﻄﺎﺏ ﺗﻜﻠﻴﻒ",
    "سعادة شركة المثال للاستشارات المهنية سلمه",
    "تم تكليفكم للقيام بإعداد تقرير الخبرة للقضية خلال المدة الموضحة.",
    "وكالة الوزارة للشؤون",
    "بوابة خبرة 1448 هـ",
  ].join("\n") }]);

  const values = new Map(result.fields.map(field => [field.label, field.value]));
  assert.equal(result.documentType, "خطاب تكليف");
  assert.equal(values.get("الموضوع"), "خطاب تكليف");
  assert.equal(values.get("الشركة"), "شركة المثال للاستشارات المهنية سلمه");
  assert.equal(values.get("نوع التكليف"), "إعداد تقرير الخبرة للقضية");
  assert.equal(values.get("المنصة"), "بوابة خبرة");
  assert.equal(values.get("السنة الهجرية"), "1448 هـ");
});

test("pairs right-to-left table labels with values by their PDF coordinates", () => {
  const cell = (text: string, x: number, y: number, width: number) => ({ text, x, y, width, height: 12, direction: "rtl" });
  const result = extractFieldsFromTextPages([{
    page: 1,
    confidence: 100,
    text: "بيانات القضية\nرقم القضية\tتاريخ القضية\n1448/03/17 4870385439",
    rows: [
      [cell("بيانات القضية", 250, 560, 80)],
      [cell("رقم القضية", 375, 490, 60), cell("تاريخ القضية", 150, 490, 64)],
      [cell("4870385439", 367, 465, 76), cell("1448/03/17", 148, 465, 72)],
    ],
  }]);

  assert.equal(result.fields.find(field => field.label === "رقم القضية")?.value, "4870385439");
  assert.equal(result.fields.find(field => field.label === "تاريخ القضية")?.value, "1448/03/17");
  assert.equal(result.fields.every(field => field.value !== "رقم القضية" && field.value !== "تاريخ القضية"), true);
});

test("rejects corrupt Arabic PDF text maps and accepts readable native text", () => {
  assert.equal(isUsableNativePdfText("رقم الطلب: 4870385439\nالمحكمة التجارية بالرياض\nتاريخ الطلب: 1448/04/07"), true);
  assert.equal(isUsableNativePdfText("Invoice number: INV-2048\nCompany: Spark Vision\nTotal amount: SAR 2,500"), true);
  assert.equal(isUsableNativePdfText("ȻǷɱư ɗɢǶɀǘȹư ЕЎЎЎЖЕ̩ Ͳ̷௛̺͙ \u0003Ͳ̺̯̺͙̗͙̓͂ͩͣ ǣɣǬƱnjȹư"), false);
});

test("detects common image formats by file signature instead of trusting the upload name", () => {
  const file = (bytes: number[] | Buffer) => ({ buffer: Buffer.from(bytes) } as Express.Multer.File);
  assert.equal(sniffMimeType(file(Buffer.from("GIF89a", "ascii"))), "image/gif");
  assert.equal(sniffMimeType(file(Buffer.from("BM", "ascii"))), "image/bmp");
  assert.equal(sniffMimeType(file([0x49, 0x49, 0x2a, 0x00])), "image/tiff");
  assert.equal(sniffMimeType(file(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif", "ascii")]))), "image/avif");
});

test("discovers previously unknown table headers from page coordinates", () => {
  const cell = (text: string, x: number, y: number, width = 100) => ({ text, x, y, width, height: 12 });
  const result = extractFieldsFromTextPages([{
    page: 1,
    confidence: 96,
    text: "لون المعدة\tسنة الصنع\nأصفر\t2024",
    rows: [
      [cell("لون المعدة", 310, 500), cell("سنة الصنع", 100, 500)],
      [cell("أصفر", 310, 475), cell("2024", 100, 475)],
    ],
  }]);

  assert.equal(result.fields.find(field => field.label === "لون المعدة")?.value, "أصفر");
  assert.equal(result.fields.find(field => field.label === "سنة الصنع")?.value, "2024");
});

test("creates contextual variables for identifiers, dates and amounts inside unseen prose", () => {
  const result = extractFieldsFromTextPages([{
    page: 1,
    confidence: 91,
    text: "تم اعتماد أمر الشراء رقم PO-77821 بتاريخ الاعتماد 2026/09/26 وبقيمة إجمالية 15,750 ريال",
  }]);
  const values = result.fields.map(field => field.value);
  assert.equal(values.includes("PO-77821"), true);
  assert.equal(values.includes("2026/09/26"), true);
  assert.equal(values.includes("15,750 ريال"), true);
  assert.equal(result.fields.every(field => field.label !== field.value), true);
});

test("merges page batches with local fields and removes the whole-page fallback", () => {
  const first = normalizeDataExtractionResponse(JSON.stringify({
    documentType: "قرار إسناد",
    language: "Arabic",
    fields: [{ label: "رقم الطلب", value: "400454800051999", category: "document", confidence: "high", page: 1 }],
  }));
  const second = normalizeDataExtractionResponse(JSON.stringify({
    documentType: "قرار إسناد",
    language: "Arabic",
    fields: [{ label: "اسم الخبير", value: "شركة المثال", category: "organization", confidence: "high", page: 2 }],
  }));
  const local = {
    documentType: "مستند نصي",
    language: "العربية",
    fields: [{ id: "fallback", label: "النص المستخرج", value: "نص الصفحة بالكامل", category: "document", confidence: "low" as const, page: 1 }],
    pages: [{ page: 1, text: "نص الصفحة بالكامل" }],
    pageCount: 2,
  };
  const result = mergeDataExtractionResults([first, second], local);

  assert.equal(result.documentType, "قرار إسناد");
  assert.deepEqual(result.fields.map(field => field.label), ["رقم الطلب", "اسم الخبير"]);
  assert.equal(result.pageCount, 2);
});

test("prefers an Arabic OCR label over a duplicate English AI label in Arabic documents", () => {
  const ai = normalizeDataExtractionResponse(JSON.stringify({
    documentType: "خطاب تكليف",
    language: "Arabic",
    fields: [{ label: "Case Number", value: "4870385439", category: "document", confidence: "high", page: 1 }],
  }));
  const local = {
    documentType: "خطاب تكليف",
    language: "العربية",
    fields: [{ id: "local", label: "رقم القضية", value: "4870385439", category: "document", confidence: "medium" as const, page: 1 }],
  };
  const result = mergeDataExtractionResults([ai], local);

  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0]?.label, "رقم القضية");
  assert.equal(result.fields[0]?.confidence, "high");
});

test("does not append a second Arabic OCR field when AI already extracted the same page value", () => {
  const ai = normalizeDataExtractionResponse(JSON.stringify({
    documentType: "خطاب",
    language: "Arabic",
    fields: [{ label: "الجهة المصدرة", value: "وزارة العدل", category: "organization", confidence: "high", page: 1 }],
  }));
  const local = {
    documentType: "خطاب",
    language: "العربية",
    fields: [{ id: "local", label: "الجهة", value: "وزارة العدل", category: "organization", confidence: "medium" as const, page: 1 }],
  };
  const result = mergeDataExtractionResults([ai], local);

  assert.deepEqual(result.fields.map(field => field.label), ["الجهة المصدرة"]);
});

test("processes a text PDF with local extraction when no AI key is configured", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  [
    "DRIVING LICENSE",
    "Name: JANE DOE",
    "ID Number: 1023456789",
    "License Number: DL-445566",
  ].forEach((line, index) => page.drawText(line, { x: 60, y: 700 - index * 60, size: 22, font }));
  const bytes = Buffer.from(await document.save());

  const names = ["MV_DATA_EXTRACTION_AI_KEY", "GEMINI_API_KEY", "SUPPORT_AI_API_KEY"] as const;
  const saved = names.map((name) => process.env[name]);
  names.forEach((name) => delete process.env[name]);
  try {
    const service = new DataExtractionService();
    const result = await service.extract([{
      fieldname: "files",
      originalname: "license.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: bytes.length,
      buffer: bytes,
    } as Express.Multer.File]);

    assert.equal(result.documents[0]?.status, "completed");
    assert.equal(result.documents[0]?.documentType, "رخصة قيادة");
    assert.equal(result.documents[0]?.fields.some((field) => field.value === "DL-445566"), true);
  } finally {
    names.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
});
