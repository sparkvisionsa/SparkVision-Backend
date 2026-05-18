"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSyarahs = listSyarahs;
exports.getSyarahById = getSyarahById;
const mongodb_1 = require("../mongodb");
const syarah_1 = require("../models/syarah");
const vehicle_name_match_1 = require("../../lib/vehicle-name-match");
const smart_search_1 = require("../../lib/smart-search");
const runtime_cache_1 = require("../lib/runtime-cache");
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_INTERNAL_LIMIT = 3000;
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
const SEARCH_TEXT_CANDIDATE_LIMIT = 4_000;
const SEARCH_TEXT_CANDIDATE_MIN_LIMIT = 300;
const SEARCH_TEXT_DEFAULT_WINDOW_MULTIPLIER = 14;
const SEARCH_TEXT_DEEP_SORT_WINDOW_MULTIPLIER = 20;
const SYARAH_PRIMARY_COLLECTION_CONFIG = {
    cacheKeyPrefix: "syarah-primary",
    forceMileageZero: false,
    getCollection: syarah_1.getSyarahCollection,
};
const SYARAH_NEW_COLLECTION_CONFIG = {
    cacheKeyPrefix: "syarah-new",
    forceMileageZero: true,
    getCollection: syarah_1.getSyarahNewCollection,
};
function toRegex(value, options) {
    return (0, smart_search_1.buildSearchRegex)(value, {
        exact: options?.exact,
        fuzzyArabic: options?.fuzzyArabic === true,
    });
}
function normalizeList(value) {
    if (!value)
        return [];
    const values = Array.isArray(value) ? value : value.split(",");
    return values.map((item) => item.trim()).filter(Boolean);
}
function buildAliasRegexes(value) {
    const aliases = [value, ...(0, vehicle_name_match_1.buildVehicleAliases)(value)];
    const uniqueAliases = Array.from(new Set(aliases.map((item) => item.trim()).filter(Boolean)));
    return uniqueAliases.map((item) => toRegex(item));
}
function toNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const parsed = Number(value.trim());
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}
function toEpochMillis(value) {
    if (value === null || value === undefined)
        return null;
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isNaN(timestamp) ? null : timestamp;
    }
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return null;
        return value > 1_000_000_000_000 ? value : value * 1000;
    }
    const text = String(value).trim();
    if (!text)
        return null;
    const numericCandidate = Number(text);
    if (!Number.isNaN(numericCandidate)) {
        return numericCandidate > 1_000_000_000_000
            ? numericCandidate
            : numericCandidate * 1000;
    }
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
}
function toCleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function toStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
}
function buildNumericExpression(fieldPath) {
    return {
        $convert: {
            input: `$${fieldPath}`,
            to: "double",
            onError: null,
            onNull: null,
        },
    };
}
function canUseSearchCandidates(query) {
    return Boolean(query.search?.trim());
}
function resolveSearchCandidateLimit(query) {
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
async function resolveSyarahSearchCandidateIds(collection, query, cacheKeyPrefix) {
    if (!canUseSearchCandidates(query)) {
        return null;
    }
    const textSearchQuery = (0, smart_search_1.buildSmartTextSearchQuery)(query.search, {
        exact: query.exactSearch === true,
        maxTerms: 10,
        maxAliasesPerTerm: 12,
        maxOutputTerms: 28,
    });
    if (!textSearchQuery) {
        return null;
    }
    const candidateLimit = resolveSearchCandidateLimit(query);
    const cacheKey = `${cacheKeyPrefix}:search-candidates:${textSearchQuery}:${candidateLimit}`;
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
function buildFilter(query, searchCandidateIds, options) {
    const filter = {};
    const andFilters = [];
    const shouldApplyRegexSearch = !searchCandidateIds?.supported || query.exactSearch === true;
    if (searchCandidateIds?.supported) {
        andFilters.push({
            _id: { $in: [...searchCandidateIds.ids] },
        });
    }
    if (query.search && shouldApplyRegexSearch) {
        const termGroups = (0, smart_search_1.buildSmartSearchTermGroups)(query.search, {
            exact: query.exactSearch === true,
        });
        for (const group of termGroups) {
            const searchRegexes = group.map((term) => toRegex(term, {
                exact: query.exactSearch === true,
                fuzzyArabic: query.exactSearch !== true,
            }));
            andFilters.push({
                $or: [
                    { title: { $in: searchRegexes } },
                    { brand: { $in: searchRegexes } },
                    { model: { $in: searchRegexes } },
                    { trim: { $in: searchRegexes } },
                    { city: { $in: searchRegexes } },
                    { origin: { $in: searchRegexes } },
                    { fuel_type: { $in: searchRegexes } },
                    { transmission: { $in: searchRegexes } },
                    { share_link: { $in: searchRegexes } },
                    { phone: { $in: searchRegexes } },
                    { year: { $in: searchRegexes } },
                    { mileage_km: { $in: searchRegexes } },
                    { price_cash: { $in: searchRegexes } },
                    { price_monthly: { $in: searchRegexes } },
                    { id: { $in: searchRegexes } },
                    { post_id: { $in: searchRegexes } },
                    { tags: { $in: searchRegexes } },
                ],
            });
        }
    }
    if (query.city) {
        andFilters.push({ city: toRegex(query.city) });
    }
    if (query.tag1) {
        andFilters.push({ brand: { $in: buildAliasRegexes(query.tag1) } });
    }
    if (query.tag2) {
        andFilters.push({ model: { $in: buildAliasRegexes(query.tag2) } });
    }
    if (query.carModelYear !== undefined) {
        andFilters.push({
            year: {
                $in: [query.carModelYear, String(query.carModelYear)],
            },
        });
    }
    if (query.hasImage === true) {
        andFilters.push({
            $or: [{ "images.0": { $exists: true } }, { featured_image: { $regex: /\S/ } }],
        });
    }
    const effectivePriceExpression = {
        $ifNull: [buildNumericExpression("price_cash"), buildNumericExpression("price_monthly")],
    };
    if (query.hasPrice === true) {
        andFilters.push({
            $expr: {
                $gt: [effectivePriceExpression, 0],
            },
        });
    }
    if (query.hasComments === true) {
        andFilters.push({
            $or: [{ "comments.0": { $exists: true } }, { commentsCount: { $gt: 0 } }],
        });
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        const priceConditions = [{ $ne: [effectivePriceExpression, null] }];
        if (query.minPrice !== undefined) {
            priceConditions.push({ $gte: [effectivePriceExpression, query.minPrice] });
        }
        if (query.maxPrice !== undefined) {
            priceConditions.push({ $lte: [effectivePriceExpression, query.maxPrice] });
        }
        andFilters.push({
            $expr: {
                $and: priceConditions,
            },
        });
    }
    if (query.dateFrom || query.dateTo) {
        const fetchedAtExpression = {
            $convert: {
                input: "$fetchedAt",
                to: "date",
                onError: null,
                onNull: null,
            },
        };
        const dateConditions = [{ $ne: [fetchedAtExpression, null] }];
        if (query.dateFrom) {
            const start = new Date(query.dateFrom);
            if (!Number.isNaN(start.getTime())) {
                dateConditions.push({ $gte: [fetchedAtExpression, start] });
            }
        }
        if (query.dateTo) {
            const end = new Date(query.dateTo);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                dateConditions.push({ $lte: [fetchedAtExpression, end] });
            }
        }
        if (dateConditions.length > 1) {
            andFilters.push({
                $expr: {
                    $and: dateConditions,
                },
            });
        }
    }
    const excludeTag1Values = normalizeList(query.excludeTag1);
    if (excludeTag1Values.length > 0) {
        andFilters.push({
            brand: {
                $nin: excludeTag1Values,
            },
        });
    }
    if (query.hasMileage === true ||
        query.mileage !== undefined ||
        query.mileageMin !== undefined ||
        query.mileageMax !== undefined) {
        const mileageExpression = options?.forceMileageZero
            ? {
                $ifNull: [buildNumericExpression("mileage_km"), 0],
            }
            : buildNumericExpression("mileage_km");
        const mileageConditions = [{ $ne: [mileageExpression, null] }];
        if (query.mileage !== undefined) {
            mileageConditions.push({ $eq: [mileageExpression, query.mileage] });
        }
        if (query.mileageMin !== undefined) {
            mileageConditions.push({ $gte: [mileageExpression, query.mileageMin] });
        }
        if (query.mileageMax !== undefined) {
            mileageConditions.push({ $lte: [mileageExpression, query.mileageMax] });
        }
        andFilters.push({
            $expr: {
                $and: mileageConditions,
            },
        });
    }
    if (andFilters.length > 0) {
        filter.$and = andFilters;
    }
    return filter;
}
function buildSort(sort) {
    switch (sort) {
        case "oldest":
            return { fetchedAt: 1, post_id: 1 };
        case "price-high":
            return { price_cash: -1, fetchedAt: -1 };
        case "price-low":
            return { price_cash: 1, fetchedAt: -1 };
        case "comments":
            return { commentsCount: -1, fetchedAt: -1 };
        default:
            return { fetchedAt: -1 };
    }
}
function buildListProjection(fields) {
    if (fields === "options") {
        return {
            _id: 1,
            id: 1,
            post_id: 1,
            brand: 1,
            model: 1,
            year: 1,
            mileage_km: 1,
        };
    }
    return {
        _id: 1,
        id: 1,
        post_id: 1,
        fetchedAt: 1,
        title: 1,
        brand: 1,
        model: 1,
        trim: 1,
        year: 1,
        mileage_km: 1,
        city: 1,
        price_cash: 1,
        price_monthly: 1,
        images: 1,
        featured_image: 1,
        share_link: 1,
        phone: 1,
        tags: 1,
    };
}
function buildCountSignature(query) {
    return {
        search: query.search ?? "",
        exactSearch: query.exactSearch === true,
        city: query.city ?? "",
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        hasImage: query.hasImage,
        hasPrice: query.hasPrice,
        hasComments: query.hasComments,
        hasMileage: query.hasMileage,
        dateFrom: query.dateFrom ?? "",
        dateTo: query.dateTo ?? "",
        tag1: query.tag1 ?? "",
        tag2: query.tag2 ?? "",
        carModelYear: query.carModelYear,
        mileage: query.mileage,
        mileageMin: query.mileageMin,
        mileageMax: query.mileageMax,
        excludeTag1: query.excludeTag1 ?? "",
        fields: query.fields === "modelYears" ? "modelYears" : "default",
    };
}
function isFilterEmpty(filter) {
    return !Array.isArray(filter.$and) || filter.$and.length === 0;
}
function normalizeSyarahListItem(doc, fields, options) {
    const brand = toCleanString(doc.brand);
    const model = toCleanString(doc.model);
    const trim = toCleanString(doc.trim);
    const year = toNumber(doc.year);
    const mileage = options?.forceMileageZero ? 0 : toNumber(doc.mileage_km);
    const postDate = toEpochMillis(doc.fetchedAt);
    const priceNumeric = toNumber(doc.price_cash);
    const docImages = toStringArray(doc.images);
    const featuredImage = toCleanString(doc.featured_image);
    const images = [...docImages];
    if (featuredImage && !images.includes(featuredImage)) {
        images.unshift(featuredImage);
    }
    const tag0 = "syarah";
    const extraTags = toStringArray(doc.tags);
    const normalizedTags = [tag0, brand, model];
    for (const tag of extraTags) {
        if (!normalizedTags.includes(tag)) {
            normalizedTags.push(tag);
        }
    }
    const id = String(doc.id ?? doc.post_id ?? doc._id ?? "");
    if (fields === "options") {
        return {
            id,
            title: "Untitled",
            city: "",
            postDate,
            priceNumeric: null,
            priceFormatted: null,
            hasImage: false,
            imagesCount: 0,
            commentsCount: 0,
            tags: normalizedTags,
            carModelYear: year,
            mileage,
            phone: "",
            url: "",
            source: "syarah",
            priceCompare: null,
        };
    }
    const titleParts = [brand, model, trim, year ? String(year) : ""].filter(Boolean);
    const normalizedTitle = toCleanString(doc.title) || titleParts.join(" ") || "Untitled";
    return {
        id,
        title: normalizedTitle,
        city: toCleanString(doc.city),
        postDate,
        priceNumeric,
        priceFormatted: null,
        hasImage: images.length > 0,
        imagesCount: images.length,
        commentsCount: 0,
        tags: normalizedTags,
        carModelYear: year,
        mileage,
        phone: toCleanString(doc.phone),
        url: toCleanString(doc.share_link),
        source: "syarah",
        priceCompare: null,
    };
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
        source: "syarah",
        priceCompare: null,
    }));
}
function buildDescendingYearRange(years) {
    const uniqueSortedYears = Array.from(new Set(years
        .map((year) => Math.trunc(year))
        .filter((year) => Number.isFinite(year)))).sort((a, b) => b - a);
    if (uniqueSortedYears.length === 0) {
        return [];
    }
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
function resolveListCacheTtlMs(fields) {
    if (fields === "modelYears")
        return MODEL_YEARS_CACHE_TTL_MS;
    if (fields === "options")
        return OPTIONS_CACHE_TTL_MS;
    return LIST_CACHE_TTL_MS;
}
function resolveListCacheStaleTtlMs(fields) {
    if (fields === "modelYears")
        return MODEL_YEARS_CACHE_STALE_TTL_MS;
    if (fields === "options")
        return OPTIONS_CACHE_STALE_TTL_MS;
    return LIST_CACHE_STALE_TTL_MS;
}
function sortSyarahItems(items, sort) {
    const getDate = (item) => toEpochMillis(item.postDate ?? null) ?? 0;
    const getPrice = (item) => typeof item.priceNumeric === "number" ? item.priceNumeric : null;
    const getComments = (item) => typeof item.commentsCount === "number" ? item.commentsCount : 0;
    const compare = (a, b) => {
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
    };
    return [...items].sort(compare);
}
async function listSyarahsFromCollection(query, options, config) {
    const maxLimit = options.maxLimit ?? MAX_LIMIT;
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), maxLimit);
    const page = Math.max(query.page ?? 1, 1);
    const cacheTtlMs = resolveListCacheTtlMs(query.fields);
    const cacheStaleTtlMs = resolveListCacheStaleTtlMs(query.fields);
    const cacheKey = `${config.cacheKeyPrefix}:list:${JSON.stringify({
        query,
        maxLimit,
        page,
        limit,
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        const db = await (0, mongodb_1.getMongoDb)();
        const collection = config.getCollection(db);
        const searchCandidateIds = await resolveSyarahSearchCandidateIds(collection, query, config.cacheKeyPrefix);
        const hasNoHits = searchCandidateIds?.supported === true && searchCandidateIds.ids.length === 0;
        const effectiveSearchCandidateIds = query.search && hasNoHits ? null : searchCandidateIds;
        const filter = buildFilter(query, effectiveSearchCandidateIds, {
            forceMileageZero: config.forceMileageZero,
        });
        if (query.fields === "modelYears") {
            const modelYearFilter = buildFilter({
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            }, effectiveSearchCandidateIds, {
                forceMileageZero: config.forceMileageZero,
            });
            const yearRows = await collection
                .aggregate([
                { $match: modelYearFilter },
                {
                    $project: {
                        carModelYear: {
                            $convert: {
                                input: "$year",
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
            return {
                items,
                total: items.length,
                page: 1,
                limit: items.length || 1,
            };
        }
        const sort = buildSort(query.sort);
        const countMode = query.countMode === "none" ? "none" : "exact";
        const fetchLimit = countMode === "none" ? limit + 1 : limit;
        const skip = (page - 1) * limit;
        const projection = buildListProjection(query.fields);
        const rawItems = await collection
            .find(filter, { projection })
            .sort(sort)
            .skip(skip)
            .limit(fetchLimit)
            .toArray();
        const hasNext = countMode === "none" ? rawItems.length > limit : undefined;
        const items = (countMode === "none" ? rawItems.slice(0, limit) : rawItems).map((doc) => normalizeSyarahListItem(doc, query.fields, {
            forceMileageZero: config.forceMileageZero,
        }));
        const total = countMode === "none"
            ? -1
            : await (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(`${config.cacheKeyPrefix}:count:${JSON.stringify(buildCountSignature(query))}`, COUNT_CACHE_TTL_MS, COUNT_CACHE_STALE_TTL_MS, async () => {
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
async function listSyarahs(query, options = {}) {
    const maxLimit = options.maxLimit ?? MAX_LIMIT;
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), maxLimit);
    const page = Math.max(query.page ?? 1, 1);
    const cacheTtlMs = resolveListCacheTtlMs(query.fields);
    const cacheStaleTtlMs = resolveListCacheStaleTtlMs(query.fields);
    const cacheKey = `syarah:list:${JSON.stringify({
        query,
        maxLimit,
        page,
        limit,
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        if (query.fields === "modelYears") {
            const modelYearsQuery = {
                ...query,
                page: 1,
                limit: MAX_INTERNAL_LIMIT,
                fields: "modelYears",
            };
            const [primaryData, newCarsData] = await Promise.all([
                listSyarahsFromCollection(modelYearsQuery, { maxLimit: MAX_INTERNAL_LIMIT }, SYARAH_PRIMARY_COLLECTION_CONFIG),
                listSyarahsFromCollection(modelYearsQuery, { maxLimit: MAX_INTERNAL_LIMIT }, SYARAH_NEW_COLLECTION_CONFIG),
            ]);
            const years = [...primaryData.items, ...newCarsData.items]
                .map((item) => toNumber(item.carModelYear))
                .filter((value) => value !== null);
            const items = buildYearOnlyItems(buildDescendingYearRange(years));
            return {
                items,
                total: items.length,
                page: 1,
                limit: items.length || 1,
            };
        }
        const countMode = query.countMode === "none" ? "none" : "exact";
        const perCollectionLimit = Math.min(limit * page + (countMode === "none" ? 1 : 0), MAX_INTERNAL_LIMIT);
        const baseQuery = {
            ...query,
            page: 1,
            limit: perCollectionLimit,
            countMode,
        };
        const [primaryData, newCarsData] = await Promise.all([
            listSyarahsFromCollection(baseQuery, { maxLimit: perCollectionLimit }, SYARAH_PRIMARY_COLLECTION_CONFIG),
            listSyarahsFromCollection(baseQuery, { maxLimit: perCollectionLimit }, SYARAH_NEW_COLLECTION_CONFIG),
        ]);
        const combinedItems = sortSyarahItems([
            ...primaryData.items,
            ...newCarsData.items,
        ], query.sort);
        const start = (page - 1) * limit;
        const pageWindowSize = limit + (countMode === "none" ? 1 : 0);
        const pageWindow = combinedItems.slice(start, start + pageWindowSize);
        const hasNext = countMode === "none" ? pageWindow.length > limit : undefined;
        const items = countMode === "none" ? pageWindow.slice(0, limit) : pageWindow;
        const total = countMode === "none" ? -1 : primaryData.total + newCarsData.total;
        return {
            items,
            total,
            page,
            limit,
            ...(hasNext !== undefined ? { hasNext } : {}),
        };
    });
}
async function getSyarahById(id) {
    return (0, runtime_cache_1.getOrSetRuntimeCache)(`syarah:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
        const db = await (0, mongodb_1.getMongoDb)();
        const primaryCollection = (0, syarah_1.getSyarahCollection)(db);
        const newCarsCollection = (0, syarah_1.getSyarahNewCollection)(db);
        const [primaryById, newCarsById] = await Promise.all([
            primaryCollection.findOne({ _id: id }),
            newCarsCollection.findOne({ _id: id }),
        ]);
        if (primaryById || newCarsById) {
            const found = primaryById ?? newCarsById;
            if (found === newCarsById && found) {
                return {
                    ...found,
                    mileage_km: 0,
                };
            }
            return found;
        }
        const numericId = Number(id);
        const [primaryByStringIds, newCarsByStringIds] = await Promise.all([
            primaryCollection.findOne({
                $or: [{ id }, { post_id: id }, { share_link: id }],
            }),
            newCarsCollection.findOne({
                $or: [{ id }, { post_id: id }, { share_link: id }],
            }),
        ]);
        if (primaryByStringIds || newCarsByStringIds) {
            const found = primaryByStringIds ?? newCarsByStringIds;
            if (found === newCarsByStringIds && found) {
                return {
                    ...found,
                    mileage_km: 0,
                };
            }
            return found;
        }
        if (Number.isNaN(numericId)) {
            return null;
        }
        const [primaryByNumericIds, newCarsByNumericIds] = await Promise.all([
            primaryCollection.findOne({ $or: [{ id: numericId }, { post_id: numericId }] }),
            newCarsCollection.findOne({ $or: [{ id: numericId }, { post_id: numericId }] }),
        ]);
        if (primaryByNumericIds)
            return primaryByNumericIds;
        if (newCarsByNumericIds) {
            return {
                ...newCarsByNumericIds,
                mileage_km: 0,
            };
        }
        return null;
    });
}
