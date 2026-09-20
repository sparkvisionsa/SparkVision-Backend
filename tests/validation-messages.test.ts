import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { zodRequestMessage } from "@/common/zod-request-message";
import { arabicValidationExceptionFactory } from "@/common/validation-error-message";
import { createTicketSchema, messageSchema } from "@/support/support.types";
import { assistantSchema } from "@/support/support-assistant.service";
import { RenameImportSheetDto } from "@/assets/dto/assets.dto";

const CLIENT_ID = "client-000000001";

function messageFor(schema: z.ZodTypeAny, input: unknown) {
  const parsed = schema.safeParse(input);
  assert.equal(parsed.success, false, "expected the payload to be rejected");
  return zodRequestMessage((parsed as z.SafeParseError<unknown>).error);
}

test("a too-short ticket subject explains the minimum length in Arabic", () => {
  const message = messageFor(createTicketSchema, { subject: "1", clientId: CLIENT_ID });
  assert.equal(message, "اكتب 3 أحرف على الأقل في عنوان الطلب.");
});

test("a missing ticket subject asks the user to fill it", () => {
  const message = messageFor(createTicketSchema, { clientId: CLIENT_ID });
  assert.equal(message, "أدخل عنوان الطلب.");
});

test("an over-long ticket subject states the maximum length", () => {
  const message = messageFor(createTicketSchema, { subject: "ع".repeat(161), clientId: CLIENT_ID });
  assert.equal(message, "اختصر عنوان الطلب إلى 160 حرفاً كحد أقصى.");
});

test("an unsupported product value is reported by name", () => {
  const message = messageFor(createTicketSchema, {
    subject: "عنوان صالح",
    product: "unknown-product",
    clientId: CLIENT_ID,
  });
  assert.equal(message, "قيمة النظام غير مدعومة.");
});

test("an empty message keeps the schema's own Arabic guidance", () => {
  const message = messageFor(messageSchema, { text: "", attachments: [], clientId: CLIENT_ID });
  assert.equal(message, "اكتب رسالة أو أرفق ملفاً");
});

test("too many attachments state the allowed count", () => {
  const message = messageFor(messageSchema, {
    text: "شرح",
    attachments: Array.from({ length: 5 }, () => "64b000000000000000000001"),
    clientId: CLIENT_ID,
  });
  assert.equal(message, "الحد الأقصى في المرفقات هو 4 عناصر.");
});

test("a missing client id tells the user to refresh instead of naming the field", () => {
  const message = messageFor(createTicketSchema, { subject: "عنوان صالح" });
  assert.match(message, /حدّث الصفحة/);
});

test("an unsafe page value keeps its own guidance without a technical label", () => {
  const message = messageFor(createTicketSchema, {
    subject: "عنوان صالح",
    page: "https://example.com",
    clientId: CLIENT_ID,
  });
  assert.equal(message, "تعذّر تحديد الصفحة الحالية. حدّث الصفحة ثم أعد المحاولة");
});

test("an empty assistant question asks for the question itself", () => {
  const message = messageFor(assistantSchema, { question: "" });
  assert.equal(message, "أدخل سؤالك.");
});

test("fields without an Arabic label keep their path as a hint", () => {
  const schema = z.object({ scope: z.object({ complianceStatement: z.string().max(10) }) });
  const message = messageFor(schema, { scope: { complianceStatement: "ع".repeat(11) } });
  assert.equal(message, "اختصر هذا الحقل إلى 10 أحرف كحد أقصى. (scope.complianceStatement)");
});

test("report model fields are named in Arabic wherever they appear in the payload", () => {
  const schema = z.object({
    reportDataModels: z.array(z.object({ name: z.string().max(160) })),
  });
  const message = messageFor(schema, { reportDataModels: [{ name: "ن".repeat(161) }] });
  assert.equal(message, "اختصر الاسم إلى 160 حرفاً كحد أقصى.");
});

test("union rejections describe the failing field instead of the union itself", () => {
  const schema = z.union([
    z.object({ userId: z.string().uuid(), enabled: z.boolean() }),
    z.object({ phone: z.string().trim().min(3), enabled: z.boolean() }),
  ]);
  const message = messageFor(schema, { phone: "1", enabled: true });
  assert.match(message, /رقم الجوال/);
});

test("asset request validation names the empty sheet field in Arabic", () => {
  const dto = plainToInstance(RenameImportSheetDto, {
    projectId: "64b000000000000000000001",
    importId: "64b000000000000000000002",
    oldSheetName: "",
    newSheetName: "الورقة الأولى",
  });
  const response = arabicValidationExceptionFactory(validateSync(dto)).getResponse() as {
    message: string;
  };
  assert.equal(response.message, "أدخل اسم الورقة الحالي.");
});

test("asset request validation reports an invalid project id in Arabic", () => {
  const dto = plainToInstance(RenameImportSheetDto, {
    projectId: "not-an-id",
    importId: "64b000000000000000000002",
    oldSheetName: "الورقة",
    newSheetName: "الورقة الأولى",
  });
  const response = arabicValidationExceptionFactory(validateSync(dto)).getResponse() as {
    message: string;
  };
  assert.equal(response.message, "معرّف المشروع غير صالح.");
});

test("at most three problems are reported at once", () => {
  const schema = z.object({
    subject: z.string().min(3),
    text: z.string().min(3),
    name: z.string().min(3),
    title: z.string().min(3),
  });
  const message = messageFor(schema, {});
  assert.equal(message.split(".").filter((part) => part.trim()).length, 3);
});
