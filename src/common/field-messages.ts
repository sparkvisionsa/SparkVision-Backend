/**
 * أسماء عربية للحقول التي يكتبها المستخدم بنفسه، وصياغات مشتركة لرسائل
 * التحقّق. يستخدمها مُنسّق أخطاء Zod ومُنسّق أخطاء `ValidationPipe` حتى تكون
 * رسائل كل واجهات النظام بأسلوب واحد.
 */
const FIELD_LABELS: Record<string, string> = {
  // الدعم الفني وكن مطور
  subject: "عنوان الطلب",
  text: "نص الرسالة",
  question: "سؤالك",
  attachments: "المرفقات",
  priority: "الأولوية",
  product: "النظام",
  kind: "نوع الطلب",
  status: "حالة التذكرة",
  assigneeId: "موظف الدعم المسؤول",
  // الحساب والدخول
  username: "اسم المستخدم",
  phone: "رقم الجوال",
  password: "كلمة المرور",
  email: "البريد الإلكتروني",
  reason: "السبب",
  role: "الصلاحية",
  fullName: "الاسم الكامل",
  companyName: "اسم الشركة",
  commercialRegistration: "رقم السجل التجاري",
  logoDataUrl: "شعار الشركة",
  newPassword: "كلمة المرور الجديدة",
  adminEmail: "بريد مدير الشركة",
  adminPhone: "جوال مدير الشركة",
  adminNewPassword: "كلمة المرور الجديدة لمدير الشركة",
  productId: "المنتج",
  valueTechProductIds: "منتجات الشركة",
  valuationReportDisplayName: "اسم معدّ التقرير",
  valuationReportJobTitle: "المسمى الوظيفي",
  valuationReportMembershipNo: "رقم العضوية",
  valuationReportSignatureDataUrl: "صورة التوقيع",
  jobTitle: "المسمى الوظيفي",
  membershipNo: "رقم العضوية",
  // تقييم الآلات والمعدات وإعدادات التقرير
  name: "الاسم",
  title: "العنوان",
  label: "اسم الحقل",
  body: "النص",
  sectionNumber: "رقم القسم",
  groupTitle: "عنوان المجموعة",
  clientName: "اسم العميل",
  reportTitle: "عنوان التقرير",
  projectName: "اسم المشروع",
  variable: "المتغير",
  variableName: "اسم المتغير",
  placeholder: "العنصر البديل",
  sourceKey: "مصدر البيانات",
  staticValue: "القيمة الثابتة",
  fallbackValue: "القيمة الاحتياطية",
  fileName: "اسم الملف",
  description: "الوصف",
  analysisSummary: "ملخص التحليل",
  // الأصول والاستيراد
  projectId: "المشروع",
  importId: "ملف الاستيراد",
  assetName: "اسم الأصل",
  assetType: "نوع الأصل",
  assetIds: "الأصول المحددة",
  changes: "التعديلات",
  sheetName: "اسم الورقة",
  oldSheetName: "اسم الورقة الحالي",
  newSheetName: "اسم الورقة الجديد",
  columnName: "اسم العمود",
  columnType: "نوع العمود",
  newLabel: "الاسم الجديد للعمود",
  fieldKey: "حقل البيانات",
  sourceFileNameUtf8: "اسم ملف الاستيراد",
  valueType: "نوع بيانات الرقم المرجعي",
  prefixKind: "نوع البادئة",
  prefixLetters: "أحرف البادئة",
  referenceNumber: "الرقم المرجعي",
};

export const UNNAMED_FIELD = "هذا الحقل";

/** آخر مقطع نصي في المسار هو اسم الحقل؛ الأرقام تعني ترتيب عنصر داخل قائمة. */
export function fieldLabel(path: (string | number)[]) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const key = path[index];
    if (typeof key === "string" && FIELD_LABELS[key]) return FIELD_LABELS[key];
  }
  return "";
}

export function characters(count: number) {
  if (count === 1) return "حرف واحد";
  if (count === 2) return "حرفين";
  if (count <= 10) return `${count} أحرف`;
  return `${count} حرفاً`;
}

export function items(count: number) {
  if (count === 1) return "عنصر واحد";
  if (count === 2) return "عنصرين";
  if (count <= 10) return `${count} عناصر`;
  return `${count} عنصراً`;
}

export const GENERIC_INVALID_PAYLOAD = "تحقّق من البيانات المُدخلة ثم أعد المحاولة.";
