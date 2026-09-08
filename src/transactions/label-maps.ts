// ─── label-maps.ts ──────────────────────────────────────────────────────────
// Same maps that used to live in transactions.pdf.service.ts (and were passed
// into the Python worker as `labelMaps`). Kept here so build-report-data.ts
// can resolve IDs without a second source of truth.

export const VALUATION_PURPOSES: Record<string, string> = {
  "1": "التمويل", "2": "الشراء", "3": "البيع", "4": "الرهن", "5": "محاسبة",
  "6": "إفلاس", "7": "استحواذ", "8": "التقرير المالي", "9": "الضرائب",
  "10": "الأغراض التأمينية", "11": "تقاضي", "12": "أغراض داخلية",
  "13": "نزع الملكية", "14": "نقل", "15": "ورث", "16": "اخرى",
  "17": "توزيع تركه", "18": "البيع القسري", "19": "معرفة القيمة السوقية",
  "20": "معرفة القيمة الإيجارية", "21": "التصفية", "50": "أغراض إستثمارية",
  "54": "التعويض",
};

export const VALUATION_BASES: Record<string, string> = {
  "1": "القيمة السوقية", "2": "القيمة الاستثمارية", "3": "القيمة المنصفة",
  "4": "قيمة التصفية", "5": "القيمة التكاملية", "6": "الايجار السوقي",
  "7": "القيمة السوقية / قيمة الايجار السوقي", "8": "القيمة العادلة",
  "10": "الإدراج في القوائم المالية",
};

export const OWNERSHIP_TYPES: Record<string, string> = {
  "1": "الملكية المطلقة", "2": "الملكية المشروطة", "3": "الملكية المقيدة",
  "4": "ملكية مدى الحياة", "5": "منفعة", "6": "مشاع", "7": "ملكية مرهونة",
};

export const VALUATION_HYPOTHESES: Record<string, string> = {
  "1": "الاستخدام الحالي", "2": "الاستخدام الأعلى والأفضل",
  "3": "التصفية المنظمة", "4": "البيع القسري",
};

// NB: kept in sync with the fuller PROPERTY_TYPES list in the frontend file;
// duplicated here (server-side) rather than imported, since the two live in
// different deployables. Extend as needed.
export const PROPERTY_TYPES: Record<string, string> = {
  "1": "أرض", "2": "شقة", "3": "فيلا سكنية", "4": "عمارة", "5": "إستراحة",
  "6": "مزرعة", "7": "مستودع", "9": "محل تجاري", "10": "دور",
  "21": "أرض سكنية", "22": "أرض تجارية", "24": "فندق", "28": "مبنى تجاري",
  "67": "عمارة سكنية",
};

export const BUILDING_STATES: Record<string, string> = {
  "10001": "جديد", "10002": "مستخدم", "10003": "تحت الإنشاء", "10004": "اخرى",
};

export const FINISH_LEVELS: Record<string, string> = {
  "23": "تشطيب فاخر", "24": "تشطيب متوسط", "25": "تشطيب عادي", "10006": "بدون تشطيب",
};

export const BUILD_QUALITY: Record<string, string> = {
  "44": "ممتاز", "45": "جيد جداً", "46": "ردئ", "10058": "جيد",
};

export const SURROUNDING_ENV_LABELS: Record<string, string> = {
  mosque: "مسجد",
  commercialMarket: "سوق تجاري",
  park: "حديقة",
  governmentFacility: "مرفق حكومي",
  highSpeedRoad: "طريق سريع",
  otherServices: "خدمات أخرى",
  educationalFacility: "مرفق تعليمي",
  securityFacility: "مرفق أمني",
  medicalFacility: "مرفق طبي",
};

export function resolve(map: Record<string, string>, id: string | undefined | null): string {
  if (!id) return "—";
  return map[id] ?? id;
}
