export const ASSET_SOURCE_CLIENT = "عميل";
export const ASSET_SOURCE_SYSTEM = "نظام";
export const ASSET_SOURCE_APP = "تطبيق";

export const ASSET_SOURCES = [ASSET_SOURCE_CLIENT, ASSET_SOURCE_SYSTEM, ASSET_SOURCE_APP] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

/**
 * أصول أنشأها التطبيق تضع ‎asset_source = تطبيق‎ عند الإنشاء.
 * لا يُعاد التحقق من هيكلها ولا تُستبدل قيمتها.
 */
export function isAppAssetSource(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  return raw === ASSET_SOURCE_APP || raw.toLowerCase() === "app";
}

/**
 * مصدر الأصل (للعميل والنظام فقط):
 * - إن كانت القيمة الحالية ‎تطبيق‎ تُترك كما هي.
 * - ‎عميل‎ إذا وُجد ‎sheetName‎ بقيمة (استيراد Excel).
 * - ‎نظام‎ في غير ذلك (وجود ‎rawData‎ عادةً ‎{}‎).
 */
export function resolveAssetSource(doc: {
  sheetName?: unknown;
  rawData?: unknown;
  asset_source?: unknown;
}): AssetSource {
  if (isAppAssetSource(doc.asset_source)) return ASSET_SOURCE_APP;
  const sheetName = typeof doc.sheetName === "string" ? doc.sheetName.trim() : "";
  if (sheetName) return ASSET_SOURCE_CLIENT;
  return ASSET_SOURCE_SYSTEM;
}
