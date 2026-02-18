"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCarsSources = listCarsSources;
const harajScrapeController_1 = require("./harajScrapeController");
const yallaMotorController_1 = require("./yallaMotorController");
const syarahController_1 = require("./syarahController");
const runtime_cache_1 = require("../lib/runtime-cache");
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const MAX_INTERNAL_LIMIT = 3000;
const MAX_MODEL_YEAR_SPAN = 300;
const LIST_CACHE_TTL_MS = 20_000;
const OPTIONS_CACHE_TTL_MS = 45_000;
const MODEL_YEARS_CACHE_TTL_MS = 120_000;
const LIST_CACHE_STALE_TTL_MS = 120_000;
const OPTIONS_CACHE_STALE_TTL_MS = 300_000;
const MODEL_YEARS_CACHE_STALE_TTL_MS = 900_000;
function normalizeSource(value) {
    return value.trim().toLowerCase();
}
function toEpochMillis(value) {
    if (!value)
        return null;
    return value > 1_000_000_000_000 ? value : value * 1000;
}
function normalizeHarajItems(items) {
    return items.map((item) => ({
        ...item,
        postDate: toEpochMillis(item.postDate ?? null),
        source: "haraj",
        priceCompare: null,
    }));
}
function normalizeYallaItems(items) {
    return items.map((item) => ({
        ...item,
        postDate: toEpochMillis(item.postDate ?? null),
        source: "yallamotor",
    }));
}
function normalizeSyarahItems(items) {
    return items.map((item) => ({
        ...item,
        postDate: toEpochMillis(item.postDate ?? null),
        source: "syarah",
        priceCompare: null,
    }));
}
function sortItems(items, sort) {
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
function toNumericYear(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
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
        source: "haraj",
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
async function listCarsSources(query) {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const page = Math.max(query.page ?? 1, 1);
    const countMode = query.countMode === "none" ? "none" : "exact";
    const sources = (query.sources ?? ["haraj", "yallamotor", "syarah"]).map(normalizeSource);
    const includeHaraj = sources.includes("haraj");
    const includeYalla = sources.includes("yallamotor");
    const includeSyarah = sources.includes("syarah");
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
    const cacheKey = `cars-sources:list:${JSON.stringify({
        query,
        page,
        limit,
        sources,
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, cacheTtlMs, cacheStaleTtlMs, async () => {
        if (!includeHaraj && !includeYalla && !includeSyarah) {
            return {
                items: [],
                total: 0,
                page,
                limit,
            };
        }
        if (query.fields === "modelYears") {
            const modelYearsQuery = {
                ...query,
                tag1: undefined,
                tag2: undefined,
                carModelYear: undefined,
            };
            const [harajData, yallaData, syarahData] = await Promise.all([
                includeHaraj
                    ? (0, harajScrapeController_1.listHarajScrapes)({
                        ...modelYearsQuery,
                        page: 1,
                        limit: MAX_INTERNAL_LIMIT,
                        fields: "modelYears",
                    }, { maxLimit: MAX_INTERNAL_LIMIT })
                    : Promise.resolve({ items: [] }),
                includeYalla
                    ? (0, yallaMotorController_1.listYallaMotors)({
                        ...modelYearsQuery,
                        page: 1,
                        limit: MAX_INTERNAL_LIMIT,
                        fields: "modelYears",
                    }, { maxLimit: MAX_INTERNAL_LIMIT })
                    : Promise.resolve({ items: [] }),
                includeSyarah
                    ? (0, syarahController_1.listSyarahs)({
                        ...modelYearsQuery,
                        page: 1,
                        limit: MAX_INTERNAL_LIMIT,
                        fields: "modelYears",
                    }, { maxLimit: MAX_INTERNAL_LIMIT })
                    : Promise.resolve({ items: [] }),
            ]);
            const years = [...harajData.items, ...yallaData.items, ...syarahData.items]
                .map((item) => toNumericYear(item.carModelYear))
                .filter((value) => value !== null);
            const items = buildYearOnlyItems(buildDescendingYearRange(years));
            return {
                items,
                total: items.length,
                page: 1,
                limit: items.length || 1,
            };
        }
        if (includeHaraj && !includeYalla && !includeSyarah) {
            const harajData = await (0, harajScrapeController_1.listHarajScrapes)({
                ...query,
                page,
                limit,
            }, { maxLimit: MAX_LIMIT });
            return {
                ...harajData,
                items: normalizeHarajItems(harajData.items),
                page,
                limit,
            };
        }
        if (!includeHaraj && includeYalla && !includeSyarah) {
            const yallaData = await (0, yallaMotorController_1.listYallaMotors)({
                ...query,
                page,
                limit,
            }, { maxLimit: MAX_LIMIT });
            return {
                ...yallaData,
                items: normalizeYallaItems(yallaData.items),
                page,
                limit,
            };
        }
        if (!includeHaraj && !includeYalla && includeSyarah) {
            const syarahData = await (0, syarahController_1.listSyarahs)({
                ...query,
                page,
                limit,
            }, { maxLimit: MAX_LIMIT });
            return {
                ...syarahData,
                items: normalizeSyarahItems(syarahData.items),
                page,
                limit,
            };
        }
        if (query.fields === "options") {
            const [harajData, yallaData, syarahData] = await Promise.all([
                includeHaraj
                    ? (0, harajScrapeController_1.listHarajScrapes)({
                        ...query,
                        page,
                        limit,
                        fields: "options",
                    }, { maxLimit: MAX_LIMIT })
                    : Promise.resolve({ items: [], total: 0 }),
                includeYalla
                    ? (0, yallaMotorController_1.listYallaMotors)({
                        ...query,
                        page,
                        limit,
                        fields: "options",
                    }, { maxLimit: MAX_LIMIT })
                    : Promise.resolve({ items: [], total: 0 }),
                includeSyarah
                    ? (0, syarahController_1.listSyarahs)({
                        ...query,
                        page,
                        limit,
                        fields: "options",
                    }, { maxLimit: MAX_LIMIT })
                    : Promise.resolve({ items: [], total: 0 }),
            ]);
            return {
                items: sortItems([
                    ...normalizeHarajItems(harajData.items),
                    ...normalizeYallaItems(yallaData.items),
                    ...normalizeSyarahItems(syarahData.items),
                ], query.sort).slice(0, limit),
                total: countMode === "none" ? -1 : harajData.total + yallaData.total + syarahData.total,
                page,
                limit,
                ...(countMode === "none"
                    ? {
                        hasNext: Boolean(harajData.hasNext) ||
                            Boolean(yallaData.hasNext) ||
                            Boolean(syarahData.hasNext),
                    }
                    : {}),
            };
        }
        const perSourceLimit = Math.min(limit * page + (countMode === "none" ? 1 : 0), MAX_INTERNAL_LIMIT);
        const [harajData, yallaData, syarahData] = await Promise.all([
            includeHaraj
                ? (0, harajScrapeController_1.listHarajScrapes)({
                    ...query,
                    page: 1,
                    limit: perSourceLimit,
                }, { maxLimit: perSourceLimit })
                : Promise.resolve({ items: [], total: 0 }),
            includeYalla
                ? (0, yallaMotorController_1.listYallaMotors)({
                    ...query,
                    page: 1,
                    limit: perSourceLimit,
                }, { maxLimit: perSourceLimit })
                : Promise.resolve({ items: [], total: 0 }),
            includeSyarah
                ? (0, syarahController_1.listSyarahs)({
                    ...query,
                    page: 1,
                    limit: perSourceLimit,
                }, { maxLimit: perSourceLimit })
                : Promise.resolve({ items: [], total: 0 }),
        ]);
        const combinedItems = sortItems([
            ...normalizeHarajItems(harajData.items),
            ...normalizeYallaItems(yallaData.items),
            ...normalizeSyarahItems(syarahData.items),
        ], query.sort);
        const start = (page - 1) * limit;
        const pageWindowSize = limit + (countMode === "none" ? 1 : 0);
        const pageWindow = combinedItems.slice(start, start + pageWindowSize);
        const hasNext = countMode === "none" ? pageWindow.length > limit : undefined;
        const pagedItems = countMode === "none" ? pageWindow.slice(0, limit) : pageWindow;
        const total = countMode === "none" ? -1 : harajData.total + yallaData.total + syarahData.total;
        return {
            items: pagedItems,
            total,
            page,
            limit,
            ...(hasNext !== undefined ? { hasNext } : {}),
        };
    });
}
