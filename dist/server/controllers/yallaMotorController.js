"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listYallaMotors = listYallaMotors;
exports.getYallaMotorById = getYallaMotorById;
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../mongodb");
const yallaMotor_1 = require("../models/yallaMotor");
const vehicle_name_match_1 = require("../../lib/vehicle-name-match");
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
const FAST_PATH_MAX_CANDIDATES = 2_500;
const FAST_YALLA_PROJECTION = {
    _id: 1,
    adId: 1,
    breadcrumbs: 1,
    location: 1,
    cardTitle: 1,
    title: 1,
    cardPriceText: 1,
    price: 1,
    fetchedAt: 1,
    scrapedAt: 1,
    detailScrapedAt: 1,
    url: 1,
    phone: 1,
    images: 1,
    highlights: 1,
    priceComparison: 1,
    "detail.breadcrumb": 1,
    "detail.overview.h1": 1,
    "detail.overview.h4": 1,
    "detail.importantSpecs": 1,
    "detail.images": 1,
    "detail.url": 1,
    "detail.priceCompare": 1,
};
const FAST_YALLA_CANDIDATE_PROJECTION = {
    _id: 1,
    fetchedAt: 1,
    scrapedAt: 1,
    detailScrapedAt: 1,
};
const YALLA_MILEAGE_KEY_AR = "\u0639\u062f\u062f \u0627\u0644\u0643\u064a\u0644\u0648\u0645\u062a\u0631\u0627\u062a";
const YALLA_DISTANCE_KEY_AR = "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629";
const YALLA_KILOMETER_TOKEN_AR = "\u0643\u064a\u0644\u0648\u0645\u062a\u0631";
const YALLA_KILOMETERS_TOKEN_AR = "\u0627\u0644\u0643\u064a\u0644\u0648\u0645\u062a\u0631\u0627\u062a";
function toRegex(value, options) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = options?.exact ? `^${escaped}$` : escaped;
    return new RegExp(pattern, "i");
}
function buildAliasRegexes(value) {
    const aliases = [value, ...(0, vehicle_name_match_1.buildVehicleAliases)(value)];
    const uniqueAliases = Array.from(new Set(aliases.map((item) => item.trim()).filter(Boolean)));
    return uniqueAliases.map((item) => toRegex(item));
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
function normalizeArabicDigits(input) {
    return input.replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
}
function parsePriceNumericValue(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const raw = normalizeArabicDigits(String(value));
    const match = raw.match(/[0-9][0-9,.]*/);
    if (!match)
        return null;
    const parsed = Number(match[0].replace(/,/g, ""));
    return Number.isNaN(parsed) ? null : parsed;
}
function parseMileageNumericValue(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const raw = normalizeArabicDigits(String(value));
    const normalized = raw.replace(/[,.\s]+/g, "");
    const match = normalized.match(/[0-9][0-9]*/);
    if (!match)
        return null;
    const parsed = Number(match[0]);
    return Number.isNaN(parsed) ? null : parsed;
}
function extractYallaMileage(specs) {
    const directKeys = [YALLA_MILEAGE_KEY_AR, YALLA_DISTANCE_KEY_AR, "Mileage"];
    for (const key of directKeys) {
        if (!(key in specs))
            continue;
        const parsed = parseMileageNumericValue(specs[key]);
        if (parsed !== null)
            return parsed;
    }
    for (const [key, rawValue] of Object.entries(specs)) {
        const lowerKey = key.toLowerCase();
        const isMileageKey = /(mileage|kilometer|kilometre)/.test(lowerKey) ||
            lowerKey.includes(YALLA_KILOMETER_TOKEN_AR) ||
            lowerKey.includes(YALLA_KILOMETERS_TOKEN_AR);
        if (!isMileageKey)
            continue;
        const parsed = parseMileageNumericValue(rawValue);
        if (parsed !== null)
            return parsed;
    }
    return null;
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
function buildPriceNumericExpression(input) {
    return {
        $let: {
            vars: {
                match: {
                    $regexFind: {
                        input: { $ifNull: [input, ""] },
                        regex: /[0-9][0-9,.]*/,
                    },
                },
            },
            in: {
                $cond: [
                    { $ne: ["$$match.match", null] },
                    {
                        $toDouble: {
                            $replaceAll: {
                                input: "$$match.match",
                                find: ",",
                                replacement: "",
                            },
                        },
                    },
                    null,
                ],
            },
        },
    };
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
function buildMileageNumericExpression(input) {
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
function buildYallaMileageRawExpression(specsInput) {
    const specsExpression = {
        $cond: [
            { $eq: [{ $type: specsInput }, "object"] },
            specsInput,
            {},
        ],
    };
    return {
        $let: {
            vars: {
                specs: specsExpression,
                specsArray: { $objectToArray: specsExpression },
            },
            in: {
                $ifNull: [
                    { $getField: { field: "\u0639\u062f\u062f \u0627\u0644\u0643\u064a\u0644\u0648\u0645\u062a\u0631\u0627\u062a", input: "$$specs" } },
                    {
                        $ifNull: [
                            { $getField: { field: "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629", input: "$$specs" } },
                            {
                                $ifNull: [
                                    { $getField: { field: "Mileage", input: "$$specs" } },
                                    {
                                        $first: {
                                            $map: {
                                                input: {
                                                    $filter: {
                                                        input: "$$specsArray",
                                                        as: "entry",
                                                        cond: {
                                                            $regexMatch: {
                                                                input: { $toLower: "$$entry.k" },
                                                                regex: "(mileage|kilometer|kilometre|كيلومتر|الكيلومترات)",
                                                            },
                                                        },
                                                    },
                                                },
                                                as: "entry",
                                                in: "$$entry.v",
                                            },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        },
    };
}
function buildPostDateExpression() {
    return {
        $cond: [
            { $ne: ["$fetchedDate", null] },
            { $toLong: "$fetchedDate" },
            null,
        ],
    };
}
function buildNormalizedYallaStages() {
    const breadcrumbExpression = {
        $cond: [
            { $isArray: "$detail.breadcrumb" },
            "$detail.breadcrumb",
            {
                $cond: [{ $isArray: "$breadcrumbs" }, "$breadcrumbs", []],
            },
        ],
    };
    const imagesExpression = {
        $cond: [
            { $isArray: "$detail.images" },
            "$detail.images",
            {
                $cond: [{ $isArray: "$images" }, "$images", []],
            },
        ],
    };
    const specsExpression = {
        $ifNull: [
            {
                $cond: [
                    { $eq: [{ $type: "$detail.importantSpecs" }, "object"] },
                    "$detail.importantSpecs",
                    null,
                ],
            },
            {
                $ifNull: [
                    {
                        $cond: [
                            { $eq: [{ $type: "$highlights" }, "object"] },
                            "$highlights",
                            null,
                        ],
                    },
                    {},
                ],
            },
        ],
    };
    const usedPriceCompareExpression = {
        min: { $ifNull: ["$priceComparison.marketMinText", "$priceComparison.marketMin"] },
        max: { $ifNull: ["$priceComparison.marketMaxText", "$priceComparison.marketMax"] },
        current: { $ifNull: ["$priceComparison.markerPriceText", "$priceComparison.markerPrice"] },
    };
    const hasUsedPriceCompare = {
        $or: [
            { $ne: ["$priceComparison.marketMinText", null] },
            { $ne: ["$priceComparison.marketMaxText", null] },
            { $ne: ["$priceComparison.markerPriceText", null] },
            { $ne: ["$priceComparison.marketMin", null] },
            { $ne: ["$priceComparison.marketMax", null] },
            { $ne: ["$priceComparison.markerPrice", null] },
        ],
    };
    const fetchedDateExpression = {
        $convert: {
            input: {
                $ifNull: [
                    "$fetchedAt",
                    {
                        $ifNull: ["$scrapedAt", "$detailScrapedAt"],
                    },
                ],
            },
            to: "date",
            onError: null,
            onNull: null,
        },
    };
    return [
        {
            $project: {
                _id: 1,
                adId: {
                    $convert: {
                        input: "$adId",
                        to: "string",
                        onError: null,
                        onNull: null,
                    },
                },
                breadcrumb: breadcrumbExpression,
                description: { $ifNull: ["$detail.description", "$description"] },
                overviewH1: "$detail.overview.h1",
                overviewH4: "$detail.overview.h4",
                specs: specsExpression,
                images: imagesExpression,
                title: {
                    $ifNull: [
                        "$cardTitle",
                        {
                            $ifNull: ["$title", { $ifNull: ["$detail.overview.h1", "Untitled"] }],
                        },
                    ],
                },
                location: "$location",
                priceText: { $ifNull: ["$cardPriceText", "$price"] },
                fetchedDate: fetchedDateExpression,
                url: { $ifNull: ["$url", "$detail.url"] },
                phone: { $ifNull: ["$phone", ""] },
                priceCompare: {
                    $ifNull: [
                        "$detail.priceCompare",
                        {
                            $cond: [hasUsedPriceCompare, usedPriceCompareExpression, null],
                        },
                    ],
                },
            },
        },
        {
            $addFields: {
                id: { $ifNull: ["$adId", { $toString: "$_id" }] },
                tag0: { $ifNull: [{ $arrayElemAt: ["$breadcrumb", 0] }, "yallamotor"] },
                tag1: { $ifNull: [{ $arrayElemAt: ["$breadcrumb", 3] }, ""] },
                tag2: { $ifNull: [{ $arrayElemAt: ["$breadcrumb", 4] }, ""] },
                city: {
                    $ifNull: [{ $arrayElemAt: ["$breadcrumb", 2] }, { $ifNull: ["$location", ""] }],
                },
                carModelYear: {
                    $convert: {
                        input: { $arrayElemAt: ["$breadcrumb", 5] },
                        to: "int",
                        onError: null,
                        onNull: null,
                    },
                },
                mileage: buildMileageNumericExpression(buildYallaMileageRawExpression("$specs")),
                priceNumeric: buildPriceNumericExpression("$priceText"),
                postDate: buildPostDateExpression(),
            },
        },
    ];
}
function buildCombinedYallaPipeline() {
    const baseStages = buildNormalizedYallaStages();
    return [
        ...baseStages,
        {
            $unionWith: {
                coll: yallaMotor_1.YALLA_MOTOR_USED_COLLECTION,
                pipeline: buildNormalizedYallaStages(),
            },
        },
    ];
}
function buildFilter(query) {
    const filter = {};
    const andFilters = [];
    if (query.search) {
        const terms = query.exactSearch
            ? [query.search.trim()].filter(Boolean)
            : query.search
                .split(/\s+/)
                .map((term) => term.trim())
                .filter(Boolean);
        for (const term of terms) {
            const searchRegex = toRegex(term, { exact: query.exactSearch === true });
            andFilters.push({
                $or: [
                    { title: searchRegex },
                    { description: searchRegex },
                    { overviewH1: searchRegex },
                    { overviewH4: searchRegex },
                    { breadcrumb: searchRegex },
                ],
            });
        }
    }
    if (query.city) {
        const cityRegex = toRegex(query.city);
        andFilters.push({ city: cityRegex });
    }
    if (query.tag1) {
        const tagRegexes = buildAliasRegexes(query.tag1);
        andFilters.push({ tag1: { $in: tagRegexes } });
    }
    if (query.tag2) {
        const tagRegexes = buildAliasRegexes(query.tag2);
        andFilters.push({ tag2: { $in: tagRegexes } });
    }
    if (query.carModelYear !== undefined) {
        andFilters.push({ carModelYear: query.carModelYear });
    }
    if (query.hasImage === true) {
        andFilters.push({ "images.0": { $exists: true } });
    }
    if (query.hasPrice === true) {
        andFilters.push({ priceText: { $regex: /\d/ } });
    }
    if (query.hasComments === true) {
        andFilters.push({
            $or: [
                { "priceCompare.min": { $exists: true, $ne: null } },
                { "priceCompare.max": { $exists: true, $ne: null } },
                { "priceCompare.current": { $exists: true, $ne: null } },
            ],
        });
    }
    if (query.dateFrom || query.dateTo) {
        const range = {};
        if (query.dateFrom) {
            const start = new Date(query.dateFrom);
            if (!Number.isNaN(start.getTime())) {
                range.$gte = start;
            }
        }
        if (query.dateTo) {
            const end = new Date(query.dateTo);
            if (!Number.isNaN(end.getTime())) {
                end.setHours(23, 59, 59, 999);
                range.$lte = end;
            }
        }
        if (Object.keys(range).length > 0) {
            andFilters.push({ fetchedDate: range });
        }
    }
    if (andFilters.length > 0) {
        filter.$and = andFilters;
    }
    return filter;
}
function toNumber(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value === "number")
        return value;
    if (typeof value === "string") {
        const num = Number(value);
        return Number.isNaN(num) ? null : num;
    }
    if (typeof value === "object" &&
        value &&
        "toNumber" in value &&
        typeof value.toNumber === "function") {
        return value.toNumber();
    }
    return null;
}
function getYallaBreadcrumbs(doc) {
    const detailBreadcrumb = doc.detail?.breadcrumb;
    if (Array.isArray(detailBreadcrumb))
        return detailBreadcrumb;
    const legacyBreadcrumb = doc.breadcrumbs;
    if (Array.isArray(legacyBreadcrumb))
        return legacyBreadcrumb;
    return [];
}
function getYallaImages(doc) {
    const detailImages = doc.detail?.images;
    if (Array.isArray(detailImages))
        return detailImages;
    const legacyImages = doc.images;
    if (Array.isArray(legacyImages))
        return legacyImages;
    return [];
}
function getYallaSpecs(doc) {
    const detailSpecs = doc.detail?.importantSpecs;
    if (isRecord(detailSpecs))
        return detailSpecs;
    const highlights = doc.highlights;
    if (isRecord(highlights))
        return highlights;
    return {};
}
function getYallaPostDateMs(doc) {
    return (toEpochMillis(doc.fetchedAt) ??
        toEpochMillis(doc.scrapedAt) ??
        toEpochMillis(doc.detailScrapedAt));
}
function normalizeFastYallaListItem(doc, isOptionsMode) {
    const breadcrumbs = getYallaBreadcrumbs(doc);
    const images = getYallaImages(doc);
    const specs = getYallaSpecs(doc);
    const titleFallback = doc.title ?? doc.detail?.overview?.h1 ?? "Untitled";
    const title = doc.cardTitle ?? titleFallback ?? "Untitled";
    const city = breadcrumbs[2] ?? doc.location ?? "";
    const priceText = doc.cardPriceText ?? doc.price ?? null;
    const carModelYear = toNumber(breadcrumbs[5]);
    const mileage = extractYallaMileage(specs);
    const priceCompareFromDetail = isRecord(doc.detail?.priceCompare)
        ? doc.detail.priceCompare
        : null;
    const priceCompare = priceCompareFromDetail ?? normalizePriceCompareFromUsedDoc(doc);
    const url = doc.url ?? doc.detail?.url ?? "";
    const phone = doc.phone ?? "";
    const postDate = getYallaPostDateMs(doc);
    const id = String(doc.adId ?? doc._id ?? "");
    return {
        id,
        postDate,
        tags: [
            breadcrumbs[0] ?? "yallamotor",
            breadcrumbs[3] ?? "",
            breadcrumbs[4] ?? "",
        ],
        carModelYear,
        mileage,
        title: isOptionsMode ? "Untitled" : String(title ?? "Untitled"),
        city: isOptionsMode ? "" : String(city ?? ""),
        priceNumeric: isOptionsMode ? null : parsePriceNumericValue(priceText),
        priceFormatted: isOptionsMode ? null : (priceText ?? null),
        imagesCount: isOptionsMode ? 0 : images.length,
        hasImage: isOptionsMode ? false : images.length > 0,
        commentsCount: 0,
        url: isOptionsMode ? "" : String(url ?? ""),
        phone: isOptionsMode ? "" : String(phone ?? ""),
        source: "yallamotor",
        priceCompare: isOptionsMode ? null : priceCompare,
    };
}
function buildYearOnlyItems(years) {
    return years.map((year) => ({
        id: `model-year-${year}`,
        postDate: null,
        tags: [],
        carModelYear: year,
        mileage: null,
        title: "Untitled",
        city: "",
        priceNumeric: null,
        priceFormatted: null,
        imagesCount: 0,
        hasImage: false,
        commentsCount: 0,
        url: "",
        phone: "",
        source: "yallamotor",
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
function buildYallaListPipeline(query, page, limit, mode = "items") {
    const skip = (page - 1) * limit;
    const filter = buildFilter(query);
    const sort = buildSort(query.sort);
    const isOptionsMode = query.fields === "options";
    const needsNumericPrice = mode === "count" ||
        query.sort === "price-high" ||
        query.sort === "price-low" ||
        query.minPrice !== undefined ||
        query.maxPrice !== undefined;
    const priceRange = {};
    if (query.minPrice !== undefined)
        priceRange.$gte = query.minPrice;
    if (query.maxPrice !== undefined)
        priceRange.$lte = query.maxPrice;
    const applyPriceRange = Object.keys(priceRange).length > 0;
    const mileageRange = {};
    if (query.mileage !== undefined) {
        mileageRange.$gte = query.mileage;
        mileageRange.$lte = query.mileage;
    }
    if (query.mileageMin !== undefined)
        mileageRange.$gte = query.mileageMin;
    if (query.mileageMax !== undefined)
        mileageRange.$lte = query.mileageMax;
    const applyHasMileage = query.hasMileage === true;
    const applyMileageRange = Object.keys(mileageRange).length > 0;
    const pipeline = [
        ...buildCombinedYallaPipeline(),
        { $match: filter },
        {
            $project: {
                _id: 0,
                id: "$id",
                postDate: "$postDate",
                tags: ["$tag0", "$tag1", "$tag2"],
                carModelYear: "$carModelYear",
                mileage: "$mileage",
                title: isOptionsMode ? { $literal: "Untitled" } : "$title",
                city: isOptionsMode ? { $literal: "" } : "$city",
                priceNumeric: needsNumericPrice ? "$priceNumeric" : { $literal: null },
                priceFormatted: isOptionsMode ? { $literal: null } : "$priceText",
                imagesCount: isOptionsMode ? { $literal: 0 } : { $size: { $ifNull: ["$images", []] } },
                hasImage: isOptionsMode
                    ? { $literal: false }
                    : {
                        $gt: [{ $size: { $ifNull: ["$images", []] } }, 0],
                    },
                commentsCount: { $literal: 0 },
                url: isOptionsMode ? { $literal: "" } : { $ifNull: ["$url", ""] },
                phone: isOptionsMode ? { $literal: "" } : { $ifNull: ["$phone", ""] },
                source: { $literal: "yallamotor" },
                priceCompare: isOptionsMode ? { $literal: null } : "$priceCompare",
            },
        },
    ];
    if (applyPriceRange) {
        pipeline.push({ $match: { priceNumeric: priceRange } });
    }
    if (applyHasMileage) {
        pipeline.push({ $match: { mileage: { $ne: null } } });
    }
    if (applyMileageRange) {
        pipeline.push({ $match: { mileage: mileageRange } });
    }
    if (mode === "count") {
        pipeline.push({ $count: "count" });
        return pipeline;
    }
    pipeline.push({ $sort: sort }, { $skip: skip }, { $limit: limit });
    return pipeline;
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
        tag1: query.tag1 ?? "",
        tag2: query.tag2 ?? "",
        carModelYear: query.carModelYear,
        mileage: query.mileage,
        mileageMin: query.mileageMin,
        mileageMax: query.mileageMax,
        fields: query.fields === "modelYears" ? "modelYears" : "default",
    };
}
function isUnfilteredYallaQuery(query) {
    return (!query.search &&
        !query.city &&
        query.minPrice === undefined &&
        query.maxPrice === undefined &&
        query.hasImage !== true &&
        query.hasPrice !== true &&
        query.hasComments !== true &&
        !query.dateFrom &&
        !query.dateTo &&
        !query.tag1 &&
        !query.tag2 &&
        query.carModelYear === undefined &&
        query.mileage === undefined &&
        query.mileageMin === undefined &&
        query.mileageMax === undefined);
}
function isFastDateOnlyYallaQuery(query) {
    return (isUnfilteredYallaQuery(query) &&
        (!query.sort || query.sort === "newest" || query.sort === "oldest") &&
        query.fields !== "modelYears");
}
async function listYallaMotors(query, options = {}) {
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
    const cacheKey = `yalla:list:${JSON.stringify({
        query,
        maxLimit,
        page,
        limit,
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        const db = await (0, mongodb_2.getMongoDb)();
        const legacyCollection = (0, yallaMotor_1.getYallaMotorCollection)(db);
        if (query.fields === "modelYears") {
            const modelYearFilter = buildFilter({
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            });
            const yearRows = await legacyCollection
                .aggregate([
                ...buildCombinedYallaPipeline(),
                { $match: modelYearFilter },
                { $match: { carModelYear: { $ne: null } } },
                { $group: { _id: "$carModelYear" } },
                { $sort: { _id: -1 } },
            ])
                .toArray();
            const years = yearRows
                .map((row) => toNumber(row?._id))
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
        const totalPromise = countMode === "none"
            ? null
            : (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(`yalla:count:${JSON.stringify(buildCountSignature(query))}`, COUNT_CACHE_TTL_MS, COUNT_CACHE_STALE_TTL_MS, async () => {
                if (isUnfilteredYallaQuery(query)) {
                    const usedCollection = (0, yallaMotor_1.getYallaUsedCollection)(db);
                    const [legacyCount, usedCount] = await Promise.all([
                        legacyCollection.estimatedDocumentCount(),
                        usedCollection.estimatedDocumentCount(),
                    ]);
                    return legacyCount + usedCount;
                }
                const [countRow] = await legacyCollection
                    .aggregate(buildYallaListPipeline(query, 1, 1, "count"))
                    .toArray();
                return toNumber(countRow?.count) ?? 0;
            });
        if (isFastDateOnlyYallaQuery(query)) {
            const skip = (page - 1) * limit;
            const candidateLimit = skip + limit + (countMode === "none" ? 1 : 0);
            if (candidateLimit <= FAST_PATH_MAX_CANDIDATES) {
                const usedCollection = (0, yallaMotor_1.getYallaUsedCollection)(db);
                const sortDirection = query.sort === "oldest" ? 1 : -1;
                const isOptionsMode = query.fields === "options";
                const [legacyCandidates, usedCandidates] = await Promise.all([
                    legacyCollection
                        .find({}, { projection: FAST_YALLA_CANDIDATE_PROJECTION })
                        .sort({ fetchedAt: sortDirection })
                        .limit(candidateLimit)
                        .toArray(),
                    usedCollection
                        .find({}, { projection: FAST_YALLA_CANDIDATE_PROJECTION })
                        .sort({ scrapedAt: sortDirection })
                        .limit(candidateLimit)
                        .toArray(),
                ]);
                const mergedCandidates = [
                    ...legacyCandidates.map((doc) => ({
                        id: doc._id,
                        source: "legacy",
                        postDate: getYallaPostDateMs(doc),
                    })),
                    ...usedCandidates.map((doc) => ({
                        id: doc._id,
                        source: "used",
                        postDate: getYallaPostDateMs(doc),
                    })),
                ].sort((a, b) => {
                    const dateCompare = sortDirection === 1
                        ? (a.postDate ?? 0) - (b.postDate ?? 0)
                        : (b.postDate ?? 0) - (a.postDate ?? 0);
                    if (dateCompare !== 0)
                        return dateCompare;
                    return `${a.source}:${String(a.id ?? "")}`.localeCompare(`${b.source}:${String(b.id ?? "")}`);
                });
                const candidatePageSlice = mergedCandidates.slice(skip, skip + limit + (countMode === "none" ? 1 : 0));
                const hasNext = countMode === "none" ? candidatePageSlice.length > limit : undefined;
                const pageCandidates = countMode === "none" ? candidatePageSlice.slice(0, limit) : candidatePageSlice;
                const legacyIds = pageCandidates
                    .filter((item) => item.source === "legacy")
                    .map((item) => item.id);
                const usedIds = pageCandidates
                    .filter((item) => item.source === "used")
                    .map((item) => item.id);
                const [legacyRows, usedRows] = await Promise.all([
                    legacyIds.length > 0
                        ? legacyCollection
                            .find({ _id: { $in: legacyIds } }, { projection: FAST_YALLA_PROJECTION })
                            .toArray()
                        : Promise.resolve([]),
                    usedIds.length > 0
                        ? usedCollection
                            .find({ _id: { $in: usedIds } }, { projection: FAST_YALLA_PROJECTION })
                            .toArray()
                        : Promise.resolve([]),
                ]);
                const total = totalPromise ? await totalPromise : -1;
                const legacyMap = new Map(legacyRows.map((doc) => [String(doc._id), doc]));
                const usedMap = new Map(usedRows.map((doc) => [String(doc._id), doc]));
                const items = pageCandidates
                    .map((candidate) => {
                    const key = String(candidate.id ?? "");
                    const doc = candidate.source === "legacy"
                        ? legacyMap.get(key)
                        : usedMap.get(key);
                    if (!doc)
                        return null;
                    return normalizeFastYallaListItem(doc, isOptionsMode);
                })
                    .filter(Boolean);
                return {
                    items,
                    total,
                    page,
                    limit,
                    ...(hasNext !== undefined ? { hasNext } : {}),
                };
            }
        }
        const fetchLimit = countMode === "none" ? limit + 1 : limit;
        const rawItems = await legacyCollection
            .aggregate(buildYallaListPipeline(query, page, fetchLimit, "items"))
            .toArray();
        const hasNext = countMode === "none" ? rawItems.length > limit : undefined;
        const pageItems = countMode === "none" ? rawItems.slice(0, limit) : rawItems;
        const items = pageItems.map((item) => ({
            ...item,
            postDate: toNumber(item.postDate),
            priceNumeric: toNumber(item.priceNumeric),
            carModelYear: toNumber(item.carModelYear),
            mileage: toNumber(item.mileage),
            imagesCount: toNumber(item.imagesCount) ?? 0,
            commentsCount: toNumber(item.commentsCount) ?? 0,
        }));
        const total = totalPromise ? await totalPromise : -1;
        return {
            items,
            total,
            page,
            limit,
            ...(hasNext !== undefined ? { hasNext } : {}),
        };
    });
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizePriceCompareFromUsedDoc(doc) {
    const priceComparison = isRecord(doc.priceComparison) ? doc.priceComparison : null;
    if (!priceComparison)
        return null;
    const min = priceComparison.marketMinText ?? priceComparison.marketMin ?? null;
    const max = priceComparison.marketMaxText ?? priceComparison.marketMax ?? null;
    const current = priceComparison.markerPriceText ?? priceComparison.markerPrice ?? null;
    if (min === null && max === null && current === null) {
        return null;
    }
    return { min, max, current };
}
function normalizeYallaDetailDoc(doc) {
    const data = doc;
    if (isRecord(data.detail)) {
        return doc;
    }
    const breadcrumb = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
    const images = Array.isArray(data.images) ? data.images : [];
    const features = Array.isArray(data.features) ? data.features : [];
    const highlights = isRecord(data.highlights) && Object.keys(data.highlights).length > 0
        ? data.highlights
        : null;
    const normalizedPriceCompare = normalizePriceCompareFromUsedDoc(data);
    return {
        ...data,
        cardTitle: data.cardTitle ?? data.title ?? "Untitled",
        cardPriceText: data.cardPriceText ?? data.price ?? null,
        fetchedAt: data.fetchedAt ?? data.scrapedAt ?? data.detailScrapedAt ?? null,
        detail: {
            url: data.url ?? "",
            breadcrumb,
            images,
            importantSpecs: highlights ?? {},
            features,
            description: data.description ?? "",
            priceCompare: normalizedPriceCompare,
        },
        source: data.source ?? "yallamotor",
    };
}
function buildYallaIdFilters(id) {
    const filters = [
        { _id: id },
        { adId: id },
        { url: id },
        { "detail.url": id },
    ];
    if (mongodb_1.ObjectId.isValid(id)) {
        filters.push({ _id: new mongodb_1.ObjectId(id) });
    }
    return filters;
}
async function findYallaDoc(collection, id) {
    const filters = buildYallaIdFilters(id);
    return collection.findOne({ $or: filters });
}
async function getYallaMotorById(id) {
    return (0, runtime_cache_1.getOrSetRuntimeCache)(`yalla:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
        const db = await (0, mongodb_2.getMongoDb)();
        const legacyCollection = (0, yallaMotor_1.getYallaMotorCollection)(db);
        const usedCollection = (0, yallaMotor_1.getYallaUsedCollection)(db);
        const [legacyDoc, usedDoc] = await Promise.all([
            findYallaDoc(legacyCollection, id),
            findYallaDoc(usedCollection, id),
        ]);
        if (legacyDoc)
            return legacyDoc;
        if (!usedDoc)
            return null;
        return normalizeYallaDetailDoc(usedDoc);
    });
}
