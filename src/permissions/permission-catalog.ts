import type { ValueTechProductId } from "@/server/auth-tracking/types";

export type PermissionCatalogAction = { key: string; label: string };
export type PermissionCatalogPage = {
  key: string;
  label: string;
  description: string;
  actions: PermissionCatalogAction[];
};

const commonActions = {
  access: { key: "access", label: "الوصول للصفحة" },
  create: { key: "create", label: "إنشاء" },
  edit: { key: "edit", label: "تعديل" },
  delete: { key: "delete", label: "حذف" },
};

export const PERMISSION_CATALOG: Partial<Record<ValueTechProductId, PermissionCatalogPage[]>> = {
  "machine-valuation": [
    { key: "projects", label: "المشاريع", description: "قائمة مشاريع تقييم الآلات والمعدات", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete, { key: "archive", label: "أرشفة واستعادة" }, { key: "duplicate", label: "تكرار المشروع" }] },
    { key: "project_workflow", label: "بيانات التقرير", description: "صفحة بيانات التقرير والمواقع والمعاينين داخل المشروع", actions: [commonActions.access, commonActions.edit, { key: "assign", label: "تعيين المعاينين" }] },
    { key: "asset_data", label: "عرض بيانات الأصول", description: "صفحة جدول بيانات الأصول والاستيراد", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete, { key: "import", label: "استيراد البيانات" }] },
    { key: "asset_media", label: "الأصول والمرفقات وملفات المشروع", description: "شاشات الأصول، المرفقات، ملفات العميل، ملفات المعاين وملفات المشروع", actions: [commonActions.access, { key: "upload", label: "رفع ملفات" }, commonActions.edit, commonActions.delete, { key: "download", label: "تنزيل" }] },
    { key: "valuation", label: "القيمة", description: "صفحة حسابات القيمة وملفاتها داخل المشروع", actions: [commonActions.access, commonActions.edit, { key: "upload", label: "رفع ملف تقييم" }, { key: "download", label: "تنزيل" }] },
    { key: "reports", label: "التقرير النهائي", description: "صفحة التقرير النهائي وإصداره وتنزيله", actions: [commonActions.access, commonActions.edit, { key: "generate", label: "توليد التقرير" }, { key: "download", label: "تنزيل التقرير" }] },
    { key: "data_extraction", label: "استخراج البيانات", description: "استخراج البيانات وسجل العمليات", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "clients", label: "العملاء", description: "عملاء نظام تقييم الآلات والمعدات", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "settings_company", label: "بيانات الشركة", description: "هوية وبيانات الشركة", actions: [commonActions.access, commonActions.edit] },
    { key: "settings_users", label: "مستخدمو الشركة", description: "إنشاء وتعديل وحذف مستخدمي النظام", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "settings_permissions", label: "الصلاحيات", description: "قوالب الصلاحيات وتعيينها للمستخدمين", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete, { key: "assign", label: "إسناد للمستخدمين" }] },
    { key: "settings_assets", label: "تصنيفات الأصول", description: "تصنيفات وأنواع ومسميات الأصول", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "settings_reports", label: "بيانات إعداد التقرير النهائي", description: "نماذج بيانات التقرير وقوالب Word وPowerPoint وقوالب النظام والكليشيه", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "settings_serial", label: "إعدادات الترقيم المتسلسل", description: "صفحة إعداد صيغة الرقم المرجعي للمشاريع", actions: [commonActions.access, commonActions.edit] },
    { key: "support", label: "الدعم والتذاكر", description: "صفحة التواصل مع الدعم ومتابعة التذاكر", actions: [commonActions.access, commonActions.create] },
  ],
  "real-estate-valuation": [
    { key: "transactions", label: "لوحة المعاملات", description: "الصفحة الرئيسية لمعاملات تقييم العقارات", actions: [commonActions.access, commonActions.create, { key: "status", label: "تغيير الحالة" }, { key: "assign", label: "تعيين المعاينين" }] },
    { key: "valuation", label: "تفاصيل المعاملة", description: "صفحة بيانات العقار وطرق التقييم ورأي المقيم", actions: [commonActions.access, commonActions.edit] },
    { key: "property_media", label: "الصور والمرفقات", description: "شاشتا الصور والمرفقات داخل المعاملة", actions: [commonActions.access, { key: "upload", label: "رفع ملفات" }, commonActions.edit, commonActions.delete, { key: "download", label: "تنزيل" }] },
    { key: "reports", label: "عرض التقرير النهائي", description: "صفحة إعداد وعرض وإصدار التقرير النهائي", actions: [commonActions.access, commonActions.edit, { key: "generate", label: "توليد التقرير" }, { key: "download", label: "تنزيل التقرير" }] },
    { key: "clients", label: "العملاء", description: "عملاء نظام التقييم العقاري", actions: [commonActions.access, commonActions.create, commonActions.edit, commonActions.delete] },
    { key: "support", label: "الدعم والتذاكر", description: "صفحة التواصل مع الدعم ومتابعة التذاكر", actions: [commonActions.access, commonActions.create] },
  ],
};

export function catalogGrantKeys(productId: ValueTechProductId): string[] {
  return (PERMISSION_CATALOG[productId] ?? []).flatMap((page) =>
    page.actions.map((action) => `${page.key}.${action.key}`),
  );
}
