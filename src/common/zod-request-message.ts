import { ZodError, type ZodIssue } from "zod";
import {
  GENERIC_INVALID_PAYLOAD,
  UNNAMED_FIELD,
  characters,
  fieldLabel,
  items,
} from "./field-messages";

const ARABIC_TEXT = /[\u0600-\u06FF]/;

function issueMessage(issue: ZodIssue): string {
  const label = fieldLabel(issue.path);
  const subject = label || UNNAMED_FIELD;
  // مسار الحقل يساعد الدعم الفني على تحديد الموضع حين لا يوجد اسم عربي له.
  const hint = !label && issue.path.length ? ` (${issue.path.join(".")})` : "";
  const describe = (message: string) => `${message}${hint}`;

  // رسائل المخططات المكتوبة بالعربية جاهزة للعرض كما هي.
  if (ARABIC_TEXT.test(issue.message)) {
    return label && !issue.message.includes(label) ? `${label}: ${issue.message}` : issue.message;
  }

  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null"
        ? describe(label ? `أدخل ${subject}.` : "هذا الحقل مطلوب.")
        : describe(`تحقّق من ${subject}؛ القيمة غير صالحة.`);
    case "too_small": {
      const minimum = Number(issue.minimum);
      if (issue.type === "string") {
        return minimum <= 1
          ? describe(label ? `أدخل ${subject}.` : "هذا الحقل مطلوب.")
          : describe(`اكتب ${characters(minimum)} على الأقل في ${subject}.`);
      }
      if (issue.type === "array" || issue.type === "set") {
        return describe(
          minimum <= 1
            ? `أضف ${items(1)} على الأقل في ${subject}.`
            : `أضف ${items(minimum)} على الأقل في ${subject}.`,
        );
      }
      return describe(`أدخل قيمة لا تقل عن ${minimum} في ${subject}.`);
    }
    case "too_big": {
      const maximum = Number(issue.maximum);
      if (issue.type === "string") {
        return describe(`اختصر ${subject} إلى ${characters(maximum)} كحد أقصى.`);
      }
      if (issue.type === "array" || issue.type === "set") {
        return describe(`الحد الأقصى في ${subject} هو ${items(maximum)}.`);
      }
      return describe(`أدخل قيمة لا تزيد عن ${maximum} في ${subject}.`);
    }
    case "invalid_string":
      if (issue.validation === "email") return "صيغة البريد الإلكتروني غير صحيحة.";
      if (issue.validation === "url") return describe(`أدخل رابطاً صحيحاً في ${subject}.`);
      if (issue.validation === "uuid" || issue.validation === "cuid") {
        return describe(`معرّف ${subject} غير صالح.`);
      }
      return describe(`احذف الرموز غير المسموحة من ${subject}.`);
    case "invalid_enum_value":
      return describe(`قيمة ${subject} غير مدعومة.`);
    case "invalid_date":
      return describe(`تاريخ ${subject} غير صالح.`);
    case "unrecognized_keys":
      return `الطلب يحتوي حقولاً غير معروفة: ${issue.keys.join("، ")}.`;
    default:
      return describe(`تحقّق من ${subject}؛ القيمة غير صالحة.`);
  }
}

/** اتحاد المخططات يخفي سببه داخل أخطاء فرعية؛ نستخرجها لنصف الحقل نفسه. */
function flattenIssues(issues: ZodIssue[]): ZodIssue[] {
  return issues.flatMap((issue) =>
    issue.code === "invalid_union"
      ? flattenIssues(issue.unionErrors.flatMap((error) => error.issues))
      : [issue],
  );
}

/**
 * رسالة عربية واحدة تشرح أول ثلاث مشاكل في الطلب. تُستخدم بدلاً من
 * «Invalid request payload.» فتظهر في كل واجهة تعرض `message` القادم من الخادم.
 */
export function zodRequestMessage(error: ZodError): string {
  const messages = new Set<string>();
  for (const issue of flattenIssues(error.issues)) {
    const message = issueMessage(issue);
    if (message) messages.add(message);
    if (messages.size >= 3) break;
  }
  return messages.size ? [...messages].join(" ") : GENERIC_INVALID_PAYLOAD;
}
