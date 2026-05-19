"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOBASHER_FAST_SEARCH_STRING_PATHS = exports.HARAJ_FAST_SEARCH_STRING_PATHS = void 0;
exports.buildFieldRegexOrConditions = buildFieldRegexOrConditions;
exports.buildHarajBroadSearchOr = buildHarajBroadSearchOr;
exports.buildMobasherBroadSearchOr = buildMobasherBroadSearchOr;
function regexPattern(regex) {
    return regex.source;
}
function regexOptions(regex) {
    return regex.flags.includes("i") ? "i" : "";
}
function buildFieldRegexOrConditions(searchRegexes, fieldPaths) {
    const conditions = [];
    for (const regex of searchRegexes) {
        for (const path of fieldPaths) {
            conditions.push({ [path]: regex });
        }
    }
    return conditions;
}
exports.HARAJ_FAST_SEARCH_STRING_PATHS = [
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
exports.MOBASHER_FAST_SEARCH_STRING_PATHS = [
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
function buildHarajBroadSearchOr(searchRegexes) {
    return buildFieldRegexOrConditions(searchRegexes, exports.HARAJ_FAST_SEARCH_STRING_PATHS);
}
function buildMobasherBroadSearchOr(searchRegexes) {
    return buildFieldRegexOrConditions(searchRegexes, exports.MOBASHER_FAST_SEARCH_STRING_PATHS);
}
