"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listHarajScrapes = listHarajScrapes;
exports.getHarajScrapeById = getHarajScrapeById;
const mongodb_1 = require("../mongodb");
const harajScrape_1 = require("../models/harajScrape");
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
const SEARCH_TEXT_CANDIDATE_LIMIT = 4_000;
const SEARCH_TEXT_CANDIDATE_MIN_LIMIT = 300;
const SEARCH_TEXT_DEFAULT_WINDOW_MULTIPLIER = 14;
const SEARCH_TEXT_DEEP_SORT_WINDOW_MULTIPLIER = 20;
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
function toEpochNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric))
            return numeric;
        const parsed = Date.parse(trimmed);
        if (!Number.isNaN(parsed))
            return parsed;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? null : time;
    }
    return null;
}
function toMileageNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const raw = String(value).trim();
    if (!raw)
        return null;
    const normalizedDigits = raw
        .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06F0))
        .replace(/[,\u060C\u066C]/g, "")
        .replace(/[\.\u066B]/g, "")
        .replace(/\u00A0/g, "")
        .replace(/\s+/g, "");
    const match = normalizedDigits.match(/\d+/);
    if (!match)
        return null;
    const parsed = Number(match[0]);
    return Number.isNaN(parsed) ? null : parsed;
}
function toNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? null : numeric;
    }
    if (typeof value === "object" &&
        value &&
        "toNumber" in value &&
        typeof value.toNumber === "function") {
        return value.toNumber();
    }
    return null;
}
function buildNormalizedDigitExpression(input) {
    const replacements = [
        ["\u0660", "0"],
        ["\u0661", "1"],
        ["\u0662", "2"],
        ["\u0663", "3"],
        ["\u0664", "4"],
        ["\u0665", "5"],
        ["\u0666", "6"],
        ["\u0667", "7"],
        ["\u0668", "8"],
        ["\u0669", "9"],
        ["\u06F0", "0"],
        ["\u06F1", "1"],
        ["\u06F2", "2"],
        ["\u06F3", "3"],
        ["\u06F4", "4"],
        ["\u06F5", "5"],
        ["\u06F6", "6"],
        ["\u06F7", "7"],
        ["\u06F8", "8"],
        ["\u06F9", "9"],
        ["\u060C", ""],
        ["\u066C", ""],
        ["\u066B", ""],
        [",", ""],
        [".", ""],
        [" ", ""],
        ["\u00A0", ""],
    ];
    let output = input;
    for (const [find, replacement] of replacements) {
        output = {
            $replaceAll: {
                input: output,
                find,
                replacement,
            },
        };
    }
    return output;
}
function buildMileageNumberExpression(input) {
    const normalized = buildNormalizedDigitExpression({
        $convert: {
            input: { $ifNull: [input, ""] },
            to: "string",
            onError: "",
            onNull: "",
        },
    });
    return {
        $let: {
            vars: {
                match: {
                    $regexFind: {
                        input: normalized,
                        regex: /[0-9][0-9]*/,
                    },
                },
            },
            in: {
                $cond: [
                    { $ne: ["$$match.match", null] },
                    {
                        $convert: {
                            input: "$$match.match",
                            to: "double",
                            onError: null,
                            onNull: null,
                        },
                    },
                    null,
                ],
            },
        },
    };
}
function buildCoalescedMileageExpression(inputs) {
    const expressions = inputs.map((input) => buildMileageNumberExpression(input));
    if (expressions.length === 0)
        return null;
    return expressions.slice(1).reduce((acc, expression) => ({
        $ifNull: [acc, expression],
    }), expressions[0]);
}
function canUseSearchCandidates(query) {
    return query.exactSearch !== true && Boolean(query.search?.trim());
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
async function resolveHarajSearchCandidateIds(collection, cachePrefix, query) {
    if (!canUseSearchCandidates(query)) {
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
    const candidateLimit = resolveSearchCandidateLimit(query);
    const cacheKey = `${cachePrefix}:search-candidates:${textSearchQuery}:${candidateLimit}`;
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
                    { "item.title": { $in: searchRegexes } },
                    { "item.bodyTEXT": { $in: searchRegexes } },
                    { "gql.posts.json.data.posts.items.title": { $in: searchRegexes } },
                    { "gql.posts.json.data.posts.items.bodyTEXT": { $in: searchRegexes } },
                    { "tags.1": { $in: searchRegexes } },
                    { "tags.2": { $in: searchRegexes } },
                    { "item.tags.1": { $in: searchRegexes } },
                    { "item.tags.2": { $in: searchRegexes } },
                    { "gql.posts.json.data.posts.items.tags.1": { $in: searchRegexes } },
                    { "gql.posts.json.data.posts.items.tags.2": { $in: searchRegexes } },
                ],
            });
        }
    }
    if (query.city) {
        const cityRegex = toRegex(query.city);
        andFilters.push({
            $or: [{ city: cityRegex }, { "item.city": cityRegex }, { "item.geoCity": cityRegex }],
        });
    }
    if (query.hasImage === true) {
        andFilters.push({
            $or: [
                { "item.imagesList.0": { $exists: true } },
                { "imagesList.0": { $exists: true } },
            ],
        });
    }
    if (query.hasPrice === true) {
        andFilters.push({
            $and: [
                { $or: [{ hasPrice: true }, { hasPrice: "true" }] },
                {
                    $or: [
                        { priceNumeric: { $exists: true, $gt: 0 } },
                        { "item.price.numeric": { $exists: true, $gt: 0 } },
                        { "item.price.formattedPrice": { $exists: true, $ne: "" } },
                    ],
                },
            ],
        });
    }
    if (query.hasComments === true) {
        andFilters.push({
            $or: [
                { "comments.0": { $exists: true } },
                { "gql.comments.json.data.comments.items.0": { $exists: true } },
            ],
        });
    }
    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
        const range = {};
        if (query.minPrice !== undefined)
            range.$gte = query.minPrice;
        if (query.maxPrice !== undefined)
            range.$lte = query.maxPrice;
        andFilters.push({
            $or: [{ priceNumeric: range }, { "item.price.numeric": range }],
        });
    }
    if (query.dateFrom || query.dateTo) {
        const range = {};
        if (query.dateFrom) {
            const start = new Date(query.dateFrom);
            if (!Number.isNaN(start.getTime())) {
                range.$gte = Math.floor(start.getTime() / 1000);
            }
        }
        if (query.dateTo) {
            const end = new Date(query.dateTo);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                range.$lte = Math.floor(end.getTime() / 1000);
            }
        }
        if (Object.keys(range).length > 0) {
            andFilters.push({
                $or: [{ postDate: range }, { "item.postDate": range }],
            });
        }
    }
    if (query.tag0) {
        andFilters.push({
            $or: [{ "tags.0": query.tag0 }, { "item.tags.0": query.tag0 }],
        });
    }
    if (query.tag1) {
        const tagRegexes = buildAliasRegexes(query.tag1);
        andFilters.push({
            $or: [{ "tags.1": { $in: tagRegexes } }, { "item.tags.1": { $in: tagRegexes } }],
        });
    }
    if (query.tag2) {
        const tagRegexes = buildAliasRegexes(query.tag2);
        andFilters.push({
            $or: [{ "tags.2": { $in: tagRegexes } }, { "item.tags.2": { $in: tagRegexes } }],
        });
    }
    const excludeTag1Values = normalizeList(query.excludeTag1);
    if (excludeTag1Values.length > 0) {
        andFilters.push({
            $nor: [
                { "tags.1": { $in: excludeTag1Values } },
                { "item.tags.1": { $in: excludeTag1Values } },
                { "gql.posts.json.data.posts.items.tags.1": { $in: excludeTag1Values } },
            ],
        });
    }
    if (query.carModelYear !== undefined) {
        const yearValues = [query.carModelYear, String(query.carModelYear)];
        andFilters.push({
            $or: [
                { "item.carInfo.model": { $in: yearValues } },
                { "carInfo.model": { $in: yearValues } },
                { "gql.posts.json.data.posts.items.0.carInfo.model": { $in: yearValues } },
                { "gql.posts.json.data.posts.items.carInfo.model": { $in: yearValues } },
            ],
        });
    }
    if (query.hasMileage === true ||
        query.mileage !== undefined ||
        query.mileageMin !== undefined ||
        query.mileageMax !== undefined) {
        const gqlItemsArrayMileageExpression = {
            $let: {
                vars: {
                    itemsArray: {
                        $cond: [
                            { $isArray: "$gql.posts.json.data.posts.items" },
                            "$gql.posts.json.data.posts.items",
                            [],
                        ],
                    },
                },
                in: {
                    $let: {
                        vars: {
                            firstItem: { $arrayElemAt: ["$$itemsArray", 0] },
                        },
                        in: "$$firstItem.carInfo.mileage",
                    },
                },
            },
        };
        const gqlItemsObjectMileageExpression = {
            $let: {
                vars: {
                    itemsValue: "$gql.posts.json.data.posts.items",
                },
                in: {
                    $cond: [
                        { $eq: [{ $type: "$$itemsValue" }, "object"] },
                        "$$itemsValue.carInfo.mileage",
                        null,
                    ],
                },
            },
        };
        const mileageExpression = buildCoalescedMileageExpression([
            "$item.carInfo.mileage",
            "$carInfo.mileage",
            gqlItemsArrayMileageExpression,
            gqlItemsObjectMileageExpression,
        ]);
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
            $expr: mileageConditions.length === 1
                ? mileageConditions[0]
                : { $and: mileageConditions },
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
            return { postDate: 1 };
        case "price-high":
            return { priceNumeric: -1, postDate: -1 };
        case "price-low":
            return { priceNumeric: 1, postDate: -1 };
        case "comments":
            return { commentsCount: -1, postDate: -1 };
        default:
            return { postDate: -1 };
    }
}
function buildListProjection(fields) {
    if (fields === "options") {
        return {
            _id: 1,
            postId: 1,
            postDate: 1,
            tags: 1,
            "item.postDate": 1,
            "item.tags": 1,
            "item.carInfo.model": 1,
            "item.carInfo.mileage": 1,
            "carInfo.model": 1,
            "carInfo.mileage": 1,
            "gql.posts.json.data.posts.items.carInfo.model": 1,
            "gql.posts.json.data.posts.items.carInfo.mileage": 1,
        };
    }
    return {
        _id: 1,
        postId: 1,
        title: 1,
        city: 1,
        priceNumeric: 1,
        postDate: 1,
        url: 1,
        phone: 1,
        tags: 1,
        commentsCount: 1,
        hasImage: 1,
        hasVideo: 1,
        imagesList: 1,
        "item.title": 1,
        "item.postDate": 1,
        "item.city": 1,
        "item.geoCity": 1,
        "item.tags": 1,
        "item.hasImage": 1,
        "item.hasVideo": 1,
        "item.commentCount": 1,
        "item.price": 1,
        "item.URL": 1,
        "item.imagesList": 1,
        "item.carInfo.model": 1,
        "item.carInfo.mileage": 1,
        "carInfo.model": 1,
        "carInfo.mileage": 1,
        "gql.posts.json.data.posts.items.carInfo.model": 1,
        "gql.posts.json.data.posts.items.carInfo.mileage": 1,
    };
}
function buildCombinedHarajPipeline(primaryFilter, carsFilter, stagesAfterMatch) {
    const primaryPipeline = [{ $match: primaryFilter }, ...stagesAfterMatch];
    const carsPipeline = [{ $match: carsFilter }, ...stagesAfterMatch];
    return [
        ...primaryPipeline,
        {
            $unionWith: {
                coll: harajScrape_1.CARS_HARAJ_COLLECTION,
                pipeline: carsPipeline,
            },
        },
    ];
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
        dateFrom: query.dateFrom ?? "",
        dateTo: query.dateTo ?? "",
        tag0: query.tag0 ?? "",
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
        hasVideo: false,
        commentsCount: 0,
        tags: [],
        carModelYear: year,
        mileage: null,
        phone: "",
        url: "",
        source: "haraj",
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
async function listHarajScrapes(query, options = {}) {
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
    const cacheKey = `haraj:list:${JSON.stringify({
        query,
        maxLimit,
        page,
        limit,
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        const db = await (0, mongodb_1.getMongoDb)();
        const primaryCollection = (0, harajScrape_1.getHarajScrapeCollection)(db);
        const carsCollection = (0, harajScrape_1.getCarsHarajCollection)(db);
        const [primarySearchCandidateIds, carsSearchCandidateIds] = await Promise.all([
            resolveHarajSearchCandidateIds(primaryCollection, "haraj", query),
            resolveHarajSearchCandidateIds(carsCollection, "cars-haraj", query),
        ]);
        const hasPrimaryNoHits = primarySearchCandidateIds?.supported === true && primarySearchCandidateIds.ids.length === 0;
        const hasCarsNoHits = carsSearchCandidateIds?.supported === true && carsSearchCandidateIds.ids.length === 0;
        if (query.search && hasPrimaryNoHits && hasCarsNoHits) {
            if (query.fields === "modelYears") {
                return {
                    items: [],
                    total: 0,
                    page: 1,
                    limit: 1,
                };
            }
            const countMode = query.countMode === "none" ? "none" : "exact";
            return {
                items: [],
                total: 0,
                page,
                limit,
                ...(countMode === "none" ? { hasNext: false } : {}),
            };
        }
        const primaryFilter = buildFilter(query, primarySearchCandidateIds);
        const carsFilter = buildFilter(query, carsSearchCandidateIds);
        if (query.fields === "modelYears") {
            const modelYearPrimaryFilter = buildFilter({
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            }, primarySearchCandidateIds);
            const modelYearCarsFilter = buildFilter({
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            }, carsSearchCandidateIds);
            const yearRows = await primaryCollection
                .aggregate([
                ...buildCombinedHarajPipeline(modelYearPrimaryFilter, modelYearCarsFilter, [
                    {
                        $project: {
                            carModelYear: {
                                $convert: {
                                    input: {
                                        $ifNull: [
                                            "$item.carInfo.model",
                                            {
                                                $ifNull: [
                                                    "$carInfo.model",
                                                    "$gql.posts.json.data.posts.items.0.carInfo.model",
                                                ],
                                            },
                                        ],
                                    },
                                    to: "int",
                                    onError: null,
                                    onNull: null,
                                },
                            },
                        },
                    },
                ]),
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
        const projection = buildListProjection(query.fields);
        const skip = (page - 1) * limit;
        const candidateWindow = Math.max(skip + fetchLimit, fetchLimit);
        const itemsPromise = primaryCollection
            .aggregate([
            ...buildCombinedHarajPipeline(primaryFilter, carsFilter, [
                { $sort: sort },
                { $limit: candidateWindow },
            ]),
            { $sort: sort },
            { $skip: skip },
            { $limit: fetchLimit },
            { $project: projection },
        ])
            .toArray();
        const rawItems = await itemsPromise;
        const hasNext = countMode === "none" ? rawItems.length > limit : undefined;
        const items = countMode === "none" ? rawItems.slice(0, limit) : rawItems;
        const total = countMode === "none"
            ? -1
            : await (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(`haraj:count:${JSON.stringify(buildCountSignature(query))}`, COUNT_CACHE_TTL_MS, COUNT_CACHE_STALE_TTL_MS, async () => {
                if (isFilterEmpty(primaryFilter) && isFilterEmpty(carsFilter)) {
                    const [primaryCount, carsCount] = await Promise.all([
                        primaryCollection.estimatedDocumentCount(),
                        carsCollection.estimatedDocumentCount(),
                    ]);
                    return primaryCount + carsCount;
                }
                const [primaryCount, carsCount] = await Promise.all([
                    primaryCollection.countDocuments(primaryFilter),
                    carsCollection.countDocuments(carsFilter),
                ]);
                return primaryCount + carsCount;
            });
        const normalized = items.map((doc) => {
            const priceNumeric = doc.priceNumeric ?? doc.item?.price?.numeric ?? null;
            const imageCount = doc.item?.imagesList?.length ??
                doc.imagesList?.length ??
                0;
            const hasImages = imageCount > 0;
            const carModelYear = doc.item?.carInfo?.model ??
                doc?.carInfo?.model ??
                doc?.gql?.posts?.json?.data?.posts?.items?.[0]?.carInfo?.model ??
                null;
            const mileage = toMileageNumber(doc.item?.carInfo?.mileage) ??
                toMileageNumber(doc?.carInfo?.mileage) ??
                toMileageNumber(doc?.gql?.posts?.json?.data?.posts?.items?.[0]?.carInfo?.mileage) ??
                null;
            const commentsCount = doc.commentsCount ?? doc.item?.commentCount ?? 0;
            const postDate = toEpochNumber(doc.item?.postDate) ??
                toEpochNumber(doc.postDate) ??
                null;
            if (query.fields === "options") {
                return {
                    id: doc.postId ?? doc._id,
                    title: "Untitled",
                    city: "",
                    postDate,
                    priceNumeric: null,
                    priceFormatted: null,
                    hasImage: false,
                    imagesCount: 0,
                    hasVideo: false,
                    commentsCount: 0,
                    tags: doc.tags ?? doc.item?.tags ?? [],
                    carModelYear,
                    mileage,
                    phone: "",
                    url: "",
                    source: "haraj",
                };
            }
            return {
                id: doc.postId ?? doc._id,
                title: doc.title ?? doc.item?.title ?? "Untitled",
                city: doc.city ?? doc.item?.city ?? doc.item?.geoCity ?? "",
                postDate,
                priceNumeric,
                priceFormatted: doc.item?.price?.formattedPrice ?? (priceNumeric ? priceNumeric.toLocaleString("en-US") : null),
                hasImage: hasImages,
                imagesCount: imageCount,
                hasVideo: doc.item?.hasVideo ?? doc.hasVideo ?? false,
                commentsCount,
                tags: doc.tags ?? doc.item?.tags ?? [],
                carModelYear,
                mileage,
                phone: doc.phone ?? "",
                url: doc.url ?? (doc.item?.URL ? `https://haraj.com.sa/${doc.item.URL}` : ""),
                source: "haraj",
            };
        });
        return {
            items: normalized,
            total,
            page,
            limit,
            ...(hasNext !== undefined ? { hasNext } : {}),
        };
    });
}
async function getHarajScrapeById(id) {
    return (0, runtime_cache_1.getOrSetRuntimeCache)(`haraj:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
        const db = await (0, mongodb_1.getMongoDb)();
        const primaryCollection = (0, harajScrape_1.getHarajScrapeCollection)(db);
        const carsCollection = (0, harajScrape_1.getCarsHarajCollection)(db);
        const numericId = Number(id);
        const filter = {
            $or: [
                { _id: id },
                { postId: id },
                Number.isNaN(numericId) ? undefined : { "item.id": numericId },
                { "item.URL": id },
            ].filter(Boolean),
        };
        const [primaryDoc, carsDoc] = await Promise.all([
            primaryCollection.findOne(filter),
            carsCollection.findOne(filter),
        ]);
        return primaryDoc ?? carsDoc;
    });
}
