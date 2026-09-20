import { BadRequestException, type ValidationError } from "@nestjs/common";
import {
  GENERIC_INVALID_PAYLOAD,
  UNNAMED_FIELD,
  characters,
  fieldLabel,
  items,
} from "./field-messages";

/** أرقام القيود التي يرسلها class-validator داخل نص الرسالة الإنجليزية. */
function constraintNumber(message: string) {
  const match = /(\d+)/.exec(message);
  return match ? Number(match[1]) : 0;
}

function constraintMessage(constraint: string, english: string, subject: string) {
  switch (constraint) {
    case "isNotEmpty":
    case "isDefined":
    case "isNotEmptyObject":
      return `أدخل ${subject}.`;
    case "maxLength":
      return `اختصر ${subject} إلى ${characters(constraintNumber(english))} كحد أقصى.`;
    case "minLength":
      return `اكتب ${characters(constraintNumber(english))} على الأقل في ${subject}.`;
    case "max":
      return `أدخل قيمة لا تزيد عن ${constraintNumber(english)} في ${subject}.`;
    case "min":
      return `أدخل قيمة لا تقل عن ${constraintNumber(english)} في ${subject}.`;
    case "arrayMaxSize":
      return `الحد الأقصى في ${subject} هو ${items(constraintNumber(english))}.`;
    case "arrayMinSize":
      return `أضف ${items(constraintNumber(english))} على الأقل في ${subject}.`;
    case "isEmail":
      return "صيغة البريد الإلكتروني غير صحيحة.";
    case "isIn":
    case "isEnum":
      return `قيمة ${subject} غير مدعومة.`;
    case "isInt":
    case "isNumber":
    case "isPositive":
      return `أدخل رقماً صحيحاً في ${subject}.`;
    case "isBoolean":
      return `قيمة ${subject} غير مدعومة.`;
    case "isMongoId":
      return `معرّف ${subject} غير صالح.`;
    case "isDateString":
      return `تاريخ ${subject} غير صالح.`;
    case "whitelistValidation":
      return `الطلب يحتوي حقلاً غير معروف: ${subject}.`;
    default:
      return `تحقّق من ${subject}؛ القيمة غير صالحة.`;
  }
}

function collect(errors: ValidationError[], path: (string | number)[] = []): string[] {
  return errors.flatMap((error) => {
    const currentPath = [...path, error.property];
    const nested = error.children?.length ? collect(error.children, currentPath) : [];
    const label = fieldLabel(currentPath);
    const subject = label || UNNAMED_FIELD;
    const hint = label ? "" : ` (${currentPath.join(".")})`;
    const own = Object.entries(error.constraints ?? {}).map(
      ([constraint, english]) => `${constraintMessage(constraint, english, subject)}${hint}`,
    );
    return [...own, ...nested];
  });
}

/**
 * يحوّل أخطاء `ValidationPipe` الإنجليزية إلى رسالة عربية واحدة تشرح الحقل
 * والقاعدة، بالأسلوب نفسه المستخدم مع أخطاء Zod.
 */
export function arabicValidationExceptionFactory(errors: ValidationError[]) {
  const messages = [...new Set(collect(errors))].slice(0, 3);
  return new BadRequestException({
    error: "invalid_payload",
    message: messages.length ? messages.join(" ") : GENERIC_INVALID_PAYLOAD,
  });
}
