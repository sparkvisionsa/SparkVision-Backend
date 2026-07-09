"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listMobasherAuctions = listMobasherAuctions;
exports.getMobasherAuctionById = getMobasherAuctionById;
const mongodb_ind_1 = require("../mongodb-ind");
const mobasherAuctions_1 = require("../models/mobasherAuctions");
const broad_mongo_search_1 = require("../../lib/broad-mongo-search");
const vehicle_name_match_1 = require("../../lib/vehicle-name-match");
const smart_search_1 = require("../../lib/smart-search");
const runtime_cache_1 = require("../lib/runtime-cache");
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_MODEL_YEAR_SPAN = 300;
const LIST_CACHE_TTL_MS = 20_000;
const OPTIONS_CACHE_TTL_MS = 45_000;
const MODEL_YEARS_CACHE_TTL_MS = 120_000;
const DETAIL_CACHE_TTL_MS = 60_000;
const COUNT_CACHE_TTL_MS = 90_000;
const LIST_CACHE_STALE_TTL_MS = 120_000;
const OPTIONS_CACHE_STALE_TTL_MS = 300_000;
const MODEL_YEARS_CACHE_STALE_TTL_MS = 900_000;
const COUNT_CACHE_STALE_TTL_MS = 300_000;
const SEARCH_CANDIDATE_CACHE_TTL_MS = 45_000;
const SEARCH_CANDIDATE_CACHE_STALE_TTL_MS = 180_000;
const SEARCH_TEXT_CANDIDATE_LIMIT = 2_500;
const SEARCH_TEXT_CANDIDATE_MIN_LIMIT = 200;
const SEARCH_TEXT_DEFAULT_WINDOW_MULTIPLIER = 12;
const SEARCH_TEXT_DEEP_SORT_WINDOW_MULTIPLIER = 16;
const PRODUCT_BRAND = "productData.نوع المركبة";
const PRODUCT_MODEL = "productData.موديل المركبة";
const PRODUCT_YEAR = "productData.سنة الصنع";
const PRODUCT_MILEAGE = "productData.عداد الكيلومترات";
function toRegex(value, options) {
    return (0, smart_search_1.buildSearchRegex)(value, {
        exact: options?.exact,
        fuzzyArabic: options?.fuzzyArabic === true,
    });
}
function buildAliasRegexes(value) {
    const aliases = [value, ...(0, vehicle_name_match_1.buildVehicleAliases)(value)];
    const uniqueAliases = Array.from(new Set(aliases.map((item) => item.trim()).filter(Boolean)));
    return uniqueAliases.map((item) => toRegex(item));
}
function toEpochMillis(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }
    return null;
}
function parsePriceAmount(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return value;
    }
    const raw = String(value).trim();
    if (!raw)
        return null;
    const digits = raw
        .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
        .replace(/[^\d]/g, "");
    if (!digits)
        return null;
    const parsed = Number(digits);
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}
function toMileageNumber(value) {
    return parsePriceAmount(value);
}
function toModelYear(value) {
    const parsed = parsePriceAmount(value);
    if (parsed === null)
        return null;
    if (parsed >= 1950 && parsed <= 2100)
        return Math.trunc(parsed);
    return null;
}
function resolveMobasherCity(doc) {
    const description = doc.description;
    if (description && typeof description === "object" && !Array.isArray(description)) {
        const city = description["المدينة"];
        if (typeof city === "string" && city.trim())
            return city.trim();
    }
    const address = typeof doc.address === "string" ? doc.address.trim() : "";
    if (!address)
        return "";
    const commaParts = address
        .split(/[,،]/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (commaParts.length > 0) {
        return commaParts[commaParts.length - 1];
    }
    return address;
}
function resolveMobasherPrice(doc) {
    const fromHighest = parsePriceAmount(doc.highestOnlineBid?.number ?? doc.highestOnlineBid?.raw);
    if (fromHighest)
        return fromHighest;
    if (!Array.isArray(doc.bidHistory) || doc.bidHistory.length === 0) {
        return null;
    }
    let best = null;
    for (const bid of doc.bidHistory) {
        const amount = parsePriceAmount(bid?.amount);
        if (amount !== null && (best === null || amount > best)) {
            best = amount;
        }
    }
    return best;
}
function buildMobasherTags(doc) {
    const brand = doc.productData?.["نوع المركبة"]?.trim() ?? "";
    const model = doc.productData?.["موديل المركبة"]?.trim() ?? "";
    return ["مباشر", brand, model].filter((tag) => Boolean(tag));
}
function compareMobasherItemsBySort(a, b, sort) {
    const getDate = (item) => typeof item.postDate === "number" ? item.postDate : 0;
    const getPrice = (item) => typeof item.priceNumeric === "number" ? item.priceNumeric : null;
    const getComments = (item) => typeof item.commentsCount === "number" ? item.commentsCount : 0;
    switch (sort) {
        case "oldest":
            return getDate(a) - getDate(b);
        case "price-high": {
            const aPrice = getPrice(a);
            const bPrice = getPrice(b);
            if (aPrice === null && bPrice === null)
                return getDate(b) - getDate(a);
            if (aPrice === null)
                return 1;
            if (bPrice === null)
                return -1;
            return bPrice - aPrice || getDate(b) - getDate(a);
        }
        case "price-low": {
            const aPrice = getPrice(a);
            const bPrice = getPrice(b);
            if (aPrice === null && bPrice === null)
                return getDate(b) - getDate(a);
            if (aPrice === null)
                return 1;
            if (bPrice === null)
                return -1;
            return aPrice - bPrice || getDate(b) - getDate(a);
        }
        case "comments":
            return getComments(b) - getComments(a) || getDate(b) - getDate(a);
        default:
            return getDate(b) - getDate(a);
    }
}
function normalizeMobasherItem(doc, fields) {
    const priceNumeric = resolveMobasherPrice(doc);
    const images = Array.isArray(doc.images) ? doc.images.filter(Boolean) : [];
    const carModelYear = toModelYear(doc.productData?.["سنة الصنع"]);
    const mileage = toMileageNumber(doc.productData?.["عداد الكيلومترات"]);
    const postDate = toEpochMillis(doc.scrapedAt);
    const tags = buildMobasherTags(doc);
    const commentsCount = Array.isArray(doc.bidHistory) ? doc.bidHistory.length : 0;
    const city = resolveMobasherCity(doc);
    if (fields === "options") {
        return {
            id: String(doc._id),
            title: "Untitled",
            city: "",
            postDate,
            priceNumeric: null,
            priceFormatted: null,
            hasImage: false,
            imagesCount: 0,
            hasVideo: false,
            commentsCount: 0,
            tags,
            carModelYear,
            mileage,
            phone: "",
            url: "",
            source: "mobasher",
        };
    }
    return {
        id: String(doc._id),
        title: doc.title ?? doc.auctionTitle ?? doc.auctionName ?? "Untitled",
        city,
        postDate,
        priceNumeric,
        priceFormatted: priceNumeric ? priceNumeric.toLocaleString("en-US") : null,
        hasImage: images.length > 0,
        imagesCount: images.length,
        hasVideo: false,
        commentsCount,
        tags,
        carModelYear,
        mileage,
        phone: "",
        url: doc.url ?? doc.auctionUrl ?? "",
        source: "mobasher",
    };
}
function canUseMobasherSearchCandidates(query) {
    return Boolean(query.search?.trim()) && query.exactSearch !== true;
}
function resolveMobasherSearchCandidateLimit(query) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.max(query.limit ?? DEFAULT_LIMIT, 1);
    const pageWindow = page * limit;
    const usesDeepSort = query.sort === "price-high" || query.sort === "price-low" || query.sort === "comments";
    const multiplier = usesDeepSort
        ? SEARCH_TEXT_DEEP_SORT_WINDOW_MULTIPLIER
        : SEARCH_TEXT_DEFAULT_WINDOW_MULTIPLIER;
    const computedLimit = pageWindow * multiplier;
    return Math.max(SEARCH_TEXT_CANDIDATE_MIN_LIMIT, Math.min(computedLimit, SEARCH_TEXT_CANDIDATE_LIMIT));
}
async function resolveMobasherSearchCandidateIds(collection, query) {
    if (!canUseMobasherSearchCandidates(query)) {
        return null;
    }
    const textSearchQuery = (0, smart_search_1.buildSmartTextSearchQuery)(query.search, {
        exact: false,
        maxTerms: 8,
        maxAliasesPerTerm: 8,
        maxOutputTerms: 20,
    });
    if (!textSearchQuery) {
        return null;
    }
    const candidateLimit = resolveMobasherSearchCandidateLimit(query);
    const cacheKey = `cars-ind:mobasher:search-candidates:${textSearchQuery}:${candidateLimit}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, SEARCH_CANDIDATE_CACHE_TTL_MS, SEARCH_CANDIDATE_CACHE_STALE_TTL_MS, async () => {
        try {
            const rows = await collection
                .find({
                $text: {
                    $search: textSearchQuery,
                    $caseSensitive: false,
                    $diacriticSensitive: false,
                },
            }, {
                projection: { _id: 1 },
                limit: candidateLimit,
            })
                .toArray();
            if (candidateLimit >= SEARCH_TEXT_CANDIDATE_LIMIT && rows.length >= candidateLimit) {
                return null;
            }
            return {
                supported: true,
                ids: rows.map((doc) => doc._id),
            };
        }
        catch {
            return null;
        }
    });
}
function buildFilter(query, searchCandidateIds) {
    const filter = {};
    const andFilters = [];
    const shouldApplyRegexSearch = !searchCandidateIds?.supported || query.exactSearch === true;
    if (searchCandidateIds?.supported) {
        andFilters.push({
            _id: { $in: [...searchCandidateIds.ids] },
        });
    }
    if (query.search && shouldApplyRegexSearch) {
        if ((0, smart_search_1.isDocumentContainsMatchQuery)(query)) {
            const containsRegex = (0, smart_search_1.buildDocumentContainsRegex)(query.search);
            andFilters.push({
                $or: (0, broad_mongo_search_1.buildMobasherBroadSearchOr)([containsRegex]),
            });
        }
        else {
            const termGroups = (0, smart_search_1.buildSmartSearchTermGroups)(query.search, {
                exact: query.exactSearch === true,
            });
            for (const group of termGroups) {
                const searchRegexes = group.map((term) => toRegex(term, {
                    exact: query.exactSearch === true,
                    fuzzyArabic: query.exactSearch !== true,
                }));
                const searchOr = query.broadSearch
                    ? (0, broad_mongo_search_1.buildMobasherBroadSearchOr)(searchRegexes)
                    : [
                        { title: { $in: searchRegexes } },
                        { auctionTitle: { $in: searchRegexes } },
                        { auctionName: { $in: searchRegexes } },
                        { auctionCode: { $in: searchRegexes } },
                        { address: { $in: searchRegexes } },
                        { breadcrumbs: { $in: searchRegexes } },
                        { "description.كود المزاد": { $in: searchRegexes } },
                        { "description.المدينة": { $in: searchRegexes } },
                        { "description.التصنيف": { $in: searchRegexes } },
                        { "productNotes.notes": { $in: searchRegexes } },
                        { "productNotes.warning": { $in: searchRegexes } },
                        { "bidHistory.bidder": { $in: searchRegexes } },
                        { "bidHistory.amount": { $in: searchRegexes } },
                        { [PRODUCT_BRAND]: { $in: searchRegexes } },
                        { [PRODUCT_MODEL]: { $in: searchRegexes } },
                        { [PRODUCT_YEAR]: { $in: searchRegexes } },
                        { [PRODUCT_MILEAGE]: { $in: searchRegexes } },
                    ];
                andFilters.push({
                    $or: searchOr,
                });
            }
        }
    }
    if (query.city) {
        andFilters.push({ address: toRegex(query.city) });
    }
    if (query.hasImage === true) {
        andFilters.push({ "images.0": { $exists: true } });
    }
    if (query.hasPrice === true) {
        andFilters.push({
            $or: [
                { "highestOnlineBid.number": { $gt: 0 } },
                { "bidHistory.0.amount": { $exists: true, $ne: "" } },
            ],
        });
    }
    if (query.hasComments === true) {
        andFilters.push({ "bidHistory.0": { $exists: true } });
    }
    if (query.hasMileage === true) {
        andFilters.push({ [PRODUCT_MILEAGE]: { $exists: true, $ne: "" } });
    }
    if (query.dateFrom || query.dateTo) {
        const range = {};
        if (query.dateFrom) {
            const start = new Date(query.dateFrom);
            if (!Number.isNaN(start.getTime()))
                range.$gte = start;
        }
        if (query.dateTo) {
            const end = new Date(query.dateTo);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                range.$lte = end;
            }
        }
        if (Object.keys(range).length > 0) {
            andFilters.push({ scrapedAt: range });
        }
    }
    if (query.tag1) {
        const tagRegexes = buildAliasRegexes(query.tag1);
        andFilters.push({ [PRODUCT_BRAND]: { $in: tagRegexes } });
    }
    if (query.tag2) {
        const tagRegexes = buildAliasRegexes(query.tag2);
        andFilters.push({ [PRODUCT_MODEL]: { $in: tagRegexes } });
    }
    if (query.carModelYear !== undefined) {
        const yearValues = [String(query.carModelYear), query.carModelYear];
        andFilters.push({ [PRODUCT_YEAR]: { $in: yearValues } });
    }
    if (query.mileage !== undefined ||
        query.mileageMin !== undefined ||
        query.mileageMax !== undefined) {
        const mileageValues = [];
        if (query.mileage !== undefined) {
            mileageValues.push(String(query.mileage));
        }
        if (mileageValues.length > 0) {
            andFilters.push({ [PRODUCT_MILEAGE]: { $in: mileageValues } });
        }
    }
    if (andFilters.length > 0) {
        filter.$and = andFilters;
    }
    return filter;
}
function buildSort(sort) {
    switch (sort) {
        case "oldest":
            return { scrapedAt: 1 };
        case "price-high":
            return { "highestOnlineBid.number": -1, scrapedAt: -1 };
        case "price-low":
            return { "highestOnlineBid.number": 1, scrapedAt: -1 };
        case "comments":
            return { "bidHistory.0": -1, scrapedAt: -1 };
        default:
            return { scrapedAt: -1 };
    }
}
function buildListProjection(fields) {
    if (fields === "options") {
        return {
            _id: 1,
            scrapedAt: 1,
            breadcrumbs: 1,
            productData: 1,
            bidHistory: 1,
        };
    }
    return {
        _id: 1,
        title: 1,
        auctionTitle: 1,
        auctionName: 1,
        address: 1,
        scrapedAt: 1,
        url: 1,
        auctionUrl: 1,
        images: 1,
        breadcrumbs: 1,
        productData: 1,
        bidHistory: 1,
        highestOnlineBid: 1,
    };
}
function buildDescendingYearRange(years) {
    const uniqueSortedYears = Array.from(new Set(years.map((year) => Math.trunc(year)).filter((year) => Number.isFinite(year)))).sort((a, b) => b - a);
    if (uniqueSortedYears.length === 0)
        return [];
    const newestYear = uniqueSortedYears[0];
    const oldestYear = uniqueSortedYears[uniqueSortedYears.length - 1];
    if (newestYear - oldestYear > MAX_MODEL_YEAR_SPAN) {
        return uniqueSortedYears;
    }
    const fullRange = [];
    for (let year = newestYear; year >= oldestYear; year -= 1) {
        fullRange.push(year);
    }
    return fullRange;
}
function buildYearOnlyItems(years) {
    return years.map((year) => ({
        id: `model-year-${year}`,
        title: "Untitled",
        city: "",
        postDate: null,
        priceNumeric: null,
        priceFormatted: null,
        hasImage: false,
        imagesCount: 0,
        commentsCount: 0,
        tags: [],
        carModelYear: year,
        mileage: null,
        phone: "",
        url: "",
        source: "mobasher",
        priceCompare: null,
    }));
}
function isFilterEmpty(filter) {
    return !Array.isArray(filter.$and) || filter.$and.length === 0;
}
async function listMobasherAuctions(query, options = {}) {
    const maxLimit = options.maxLimit ?? MAX_LIMIT;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, maxLimit);
    const page = Math.max(query.page ?? 1, 1);
    const cacheTtlMs = query.fields === "modelYears"
        ? MODEL_YEARS_CACHE_TTL_MS
        : query.fields === "options"
            ? OPTIONS_CACHE_TTL_MS
            : LIST_CACHE_TTL_MS;
    const cacheStaleTtlMs = query.fields === "modelYears"
        ? MODEL_YEARS_CACHE_STALE_TTL_MS
        : query.fields === "options"
            ? OPTIONS_CACHE_STALE_TTL_MS
            : LIST_CACHE_STALE_TTL_MS;
    const cacheKey = `cars-ind:mobasher:list:${JSON.stringify({ query, maxLimit, page, limit })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        const db = await (0, mongodb_ind_1.getMongoIndDb)();
        const collection = (0, mobasherAuctions_1.getMobasherAuctionsCollection)(db);
        const searchCandidateIds = await resolveMobasherSearchCandidateIds(collection, query);
        if (searchCandidateIds?.supported === true && searchCandidateIds.ids.length === 0) {
            return {
                items: [],
                total: 0,
                page,
                limit,
                ...(query.countMode === "none" ? { hasNext: false } : {}),
            };
        }
        const filter = buildFilter(query, searchCandidateIds);
        if (query.fields === "modelYears") {
            const modelYearFilter = buildFilter({
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            });
            const yearRows = await collection
                .aggregate([
                { $match: modelYearFilter },
                {
                    $project: {
                        carModelYear: {
                            $convert: {
                                input: "$productData.سنة الصنع",
                                to: "int",
                                onError: null,
                                onNull: null,
                            },
                        },
                    },
                },
                { $match: { carModelYear: { $ne: null } } },
                { $group: { _id: "$carModelYear" } },
                { $sort: { _id: -1 } },
            ])
                .toArray();
            const years = yearRows
                .map((row) => (typeof row?._id === "number" ? row._id : null))
                .filter((value) => value !== null);
            const items = buildYearOnlyItems(buildDescendingYearRange(years));
            return { items, total: items.length, page: 1, limit: items.length || 1 };
        }
        const countMode = query.countMode === "none" ? "none" : "exact";
        const fetchLimit = countMode === "none" ? limit + 1 : limit;
        const projection = buildListProjection(query.fields);
        const skip = (page - 1) * limit;
        const usesInMemorySort = query.sort === "price-high" ||
            query.sort === "price-low" ||
            query.sort === "comments";
        let rawItems;
        const hasSearch = Boolean(query.search?.trim());
        if (usesInMemorySort) {
            const candidateWindow = Math.min(Math.max(skip + fetchLimit, fetchLimit) * (hasSearch ? 3 : 8), hasSearch ? 900 : 4_000);
            rawItems = await collection
                .find(filter, { projection })
                .sort({ scrapedAt: -1 })
                .limit(candidateWindow)
                .toArray();
        }
        else {
            rawItems = await collection
                .find(filter, { projection })
                .sort(buildSort(query.sort))
                .skip(skip)
                .limit(fetchLimit)
                .toArray();
        }
        let normalizedItems = rawItems.map((doc) => normalizeMobasherItem(doc, query.fields));
        if (usesInMemorySort) {
            normalizedItems = normalizedItems
                .sort((left, right) => compareMobasherItemsBySort(left, right, query.sort))
                .slice(skip, skip + fetchLimit);
        }
        const hasNext = countMode === "none" ? normalizedItems.length > limit : undefined;
        const items = (countMode === "none" ? normalizedItems.slice(0, limit) : normalizedItems);
        const total = countMode === "none"
            ? -1
            : await (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(`cars-ind:mobasher:count:${JSON.stringify(filter)}`, COUNT_CACHE_TTL_MS, COUNT_CACHE_STALE_TTL_MS, async () => {
                if (isFilterEmpty(filter)) {
                    return collection.estimatedDocumentCount();
                }
                return collection.countDocuments(filter);
            });
        return {
            items,
            total,
            page,
            limit,
            ...(hasNext !== undefined ? { hasNext } : {}),
        };
    });
}
async function getMobasherAuctionById(id) {
    return (0, runtime_cache_1.getOrSetRuntimeCache)(`cars-ind:mobasher:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
        const db = await (0, mongodb_ind_1.getMongoIndDb)();
        const collection = (0, mobasherAuctions_1.getMobasherAuctionsCollection)(db);
        const byId = await collection.findOne({ _id: id });
        if (byId)
            return byId;
        const numericId = Number(id);
        if (!Number.isNaN(numericId)) {
            const byItemId = await collection.findOne({ itemId: String(numericId) });
            if (byItemId)
                return byItemId;
        }
        return collection.findOne({ auctionCode: id });
    });
}
