import type { Document } from "mongodb";

function regexPattern(regex: RegExp) {
  return regex.source;
}

function regexOptions(regex: RegExp) {
  return regex.flags.includes("i") ? "i" : "";
}

/** مطابقة regex على مسارات نصية مباشرة في find(). */
export function buildFieldRegexOrConditions(
  searchRegexes: RegExp[],
  fieldPaths: string[]
): Document[] {
  const conditions: Document[] = [];
  for (const regex of searchRegexes) {
    for (const path of fieldPaths) {
      conditions.push({ [path]: regex });
    }
  }
  return conditions;
}

/** مسارات نصية أساسية — أسرع من $expr على كل الحقول. */
export const HARAJ_FAST_SEARCH_STRING_PATHS = [
  "title",
  "city",
  "phone",
  "url",
  "postId",
  "author",
  "contact",
  "tags",
  "item.title",
  "item.bodyTEXT",
  "item.city",
  "item.geoCity",
  "item.geoNeighborhood",
  "item.URL",
  "item.authorUsername",
  "item.tags",
  "item.carInfo.fuel",
  "item.carInfo.gear",
  "item.carInfo.sellOrWaiver",
  "item.price.formattedPrice",
  "comments.body",
  "comments.authorUsername",
];

export const MOBASHER_FAST_SEARCH_STRING_PATHS = [
  "title",
  "auctionTitle",
  "auctionName",
  "auctionCode",
  "auctionId",
  "itemId",
  "address",
  "url",
  "auctionUrl",
  "breadcrumbs",
  "productNotes.warning",
  "productNotes.notes",
  "bidHistory.bidder",
  "bidHistory.amount",
  "bidHistory.method",
  "bidHistory.time",
  "productData.نوع المركبة",
  "productData.موديل المركبة",
  "productData.سنة الصنع",
  "productData.عداد الكيلومترات",
  "productData.رقم الهيكل",
  "productData.رقم اللوحة",
  "description.كود المزاد",
  "description.المدينة",
  "description.التصنيف",
  "auctionDetails.حالة المزاد",
  "auctionDetails.أعلى مزايدة اونلاين",
];

export function buildHarajBroadSearchOr(searchRegexes: RegExp[]): Document[] {
  return buildFieldRegexOrConditions(searchRegexes, HARAJ_FAST_SEARCH_STRING_PATHS);
}

export function buildMobasherBroadSearchOr(searchRegexes: RegExp[]): Document[] {
  return buildFieldRegexOrConditions(searchRegexes, MOBASHER_FAST_SEARCH_STRING_PATHS);
}
