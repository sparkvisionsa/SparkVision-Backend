"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCarsSources = listCarsSources;
exports.listCarsSourceSearchSuggestions = listCarsSourceSearchSuggestions;
const harajScrapeController_1 = require("./harajScrapeController");
const yallaMotorController_1 = require("./yallaMotorController");
const syarahController_1 = require("./syarahController");
const runtime_cache_1 = require("../lib/runtime-cache");
const vehicle_name_match_1 = require("../../lib/vehicle-name-match");
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
const SUGGESTIONS_DEFAULT_LIMIT = 8;
const SUGGESTIONS_MAX_LIMIT = 20;
const SUGGESTIONS_SOURCE_FETCH_LIMIT = 80;
const SUGGESTIONS_CACHE_TTL_MS = 30_000;
const SUGGESTIONS_CACHE_STALE_TTL_MS = 180_000;
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const SOURCE_KEYS = ["haraj", "yallamotor", "syarah"];
const SUGGESTIONS_MIN_QUERY_LENGTH = 2;
function normalizeSource(value) {
    return value.trim().toLowerCase();
}
function normalizeSuggestionText(value) {
    return value
        .normalize("NFKD")
        .replace(ARABIC_DIACRITICS_REGEX, "")
        .replace(/[\u0625\u0623\u0622\u0671]/g, "\u0627")
        .replace(/\u0649/g, "\u064a")
        .replace(/\u0624/g, "\u0648")
        .replace(/\u0626/g, "\u064a")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function tokenizeSuggestionText(value) {
    return normalizeSuggestionText(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1);
}
function resolveSuggestionSources(sources) {
    const normalizedSources = (sources ?? SOURCE_KEYS).map(normalizeSource);
    return SOURCE_KEYS.filter((source) => normalizedSources.includes(source));
}
function clampSuggestionLimit(limit) {
    if (typeof limit !== "number" || Number.isNaN(limit)) {
        return SUGGESTIONS_DEFAULT_LIMIT;
    }
    return Math.max(1, Math.min(Math.trunc(limit), SUGGESTIONS_MAX_LIMIT));
}
function buildSuggestionSearchTerms(rawQuery) {
    const candidates = [rawQuery, ...(0, vehicle_name_match_1.buildVehicleAliases)(rawQuery)];
    const unique = Array.from(new Set(candidates
        .map((value) => value.trim())
        .filter(Boolean)));
    const primary = unique[0] ?? "";
    const alias = unique.find((value) => normalizeSuggestionText(value) !== normalizeSuggestionText(primary));
    return alias ? [primary, alias] : [primary];
}
function buildSuggestionListQuery(query, search) {
    const { q: _q, sources: _sources, page: _page, limit: _limit, sort: _sort, fields: _fields, countMode: _countMode, ...rest } = query;
    return {
        ...rest,
        search,
        exactSearch: false,
        page: 1,
        limit: SUGGESTIONS_SOURCE_FETCH_LIMIT,
        sort: "newest",
        fields: "default",
        countMode: "none",
    };
}
function toSuggestionString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function toSuggestionTags(item) {
    if (!Array.isArray(item.tags)) {
        return [];
    }
    return item.tags
        .map((tag) => toSuggestionString(tag))
        .filter(Boolean);
}
function extractSuggestionCandidates(source, item) {
    const title = toSuggestionString(item.title);
    const tags = toSuggestionTags(item);
    const brand = toSuggestionString(tags[1]);
    const model = toSuggestionString(tags[2]);
    const suggestions = [];
    if (title && title.toLowerCase() !== "untitled") {
        suggestions.push({
            label: title,
            normalized: normalizeSuggestionText(title),
            source,
            weight: 7,
        });
    }
    if (brand) {
        suggestions.push({
            label: brand,
            normalized: normalizeSuggestionText(brand),
            source,
            weight: 8,
        });
    }
    if (model) {
        suggestions.push({
            label: model,
            normalized: normalizeSuggestionText(model),
            source,
            weight: 6,
        });
    }
    if (brand && model) {
        const combined = `${brand} ${model}`.trim();
        suggestions.push({
            label: combined,
            normalized: normalizeSuggestionText(combined),
            source,
            weight: 10,
        });
    }
    return suggestions.filter((suggestion) => Boolean(suggestion.normalized));
}
async function listSourceItemsForSuggestions(source, query) {
    if (source === "haraj") {
        const result = await (0, harajScrapeController_1.listHarajScrapes)(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
        return result.items;
    }
    if (source === "yallamotor") {
        const result = await (0, yallaMotorController_1.listYallaMotors)(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
        return result.items;
    }
    const result = await (0, syarahController_1.listSyarahs)(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
    return result.items;
}
function scoreSuggestionCandidate(candidate, normalizedVariants, normalizedQueryTokens) {
    let bestVariantScore = -1;
    for (const variant of normalizedVariants) {
        if (!variant)
            continue;
        if (candidate.normalized === variant) {
            bestVariantScore = Math.max(bestVariantScore, 120);
            continue;
        }
        if (candidate.normalized.startsWith(variant)) {
            bestVariantScore = Math.max(bestVariantScore, 95);
            continue;
        }
        if (candidate.normalized.includes(variant)) {
            bestVariantScore = Math.max(bestVariantScore, 72);
        }
    }
    const matchedTokenCount = normalizedQueryTokens.filter((token) => candidate.normalized.includes(token)).length;
    if (bestVariantScore < 0 && matchedTokenCount === 0) {
        return -1;
    }
    const fullTokenBonus = normalizedQueryTokens.length > 0 && matchedTokenCount === normalizedQueryTokens.length
        ? 26
        : matchedTokenCount * 6;
    const lengthDelta = Math.abs(candidate.normalized.length - (normalizedVariants[0]?.length ?? 0));
    const compactnessBonus = Math.max(0, 15 - Math.min(lengthDelta, 15));
    return (bestVariantScore < 0 ? 35 : bestVariantScore) + fullTokenBonus + compactnessBonus + candidate.weight;
}
function rankSuggestionCandidates(candidates, queryText, limit) {
    const normalizedVariants = buildSuggestionSearchTerms(queryText)
        .map((value) => normalizeSuggestionText(value))
        .filter(Boolean);
    const normalizedQueryTokens = tokenizeSuggestionText(queryText);
    const ranked = new Map();
    for (const candidate of candidates) {
        const score = scoreSuggestionCandidate(candidate, normalizedVariants, normalizedQueryTokens);
        if (score < 0)
            continue;
        const existing = ranked.get(candidate.normalized);
        if (!existing) {
            ranked.set(candidate.normalized, {
                label: candidate.label,
                score,
                hits: 1,
                sources: new Set([candidate.source]),
            });
            continue;
        }
        existing.hits += 1;
        existing.sources.add(candidate.source);
        if (score > existing.score) {
            existing.score = score;
            existing.label = candidate.label;
        }
    }
    return Array.from(ranked.values())
        .sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (b.sources.size !== a.sources.size)
            return b.sources.size - a.sources.size;
        if (b.hits !== a.hits)
            return b.hits - a.hits;
        if (a.label.length !== b.label.length)
            return a.label.length - b.label.length;
        return a.label.localeCompare(b.label);
    })
        .slice(0, limit)
        .map((entry) => entry.label);
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
async function listCarsSourceSearchSuggestions(query) {
    const rawQuery = (query.q ?? query.search ?? "").trim();
    if (rawQuery.length < SUGGESTIONS_MIN_QUERY_LENGTH) {
        return { items: [] };
    }
    const limit = clampSuggestionLimit(query.limit);
    const sources = resolveSuggestionSources(query.sources);
    if (sources.length === 0) {
        return { items: [] };
    }
    const cacheKey = `cars-sources:suggestions:${JSON.stringify({
        q: rawQuery,
        limit,
        sources,
        tag0: query.tag0 ?? "",
        tag1: query.tag1 ?? "",
        tag2: query.tag2 ?? "",
        carModelYear: query.carModelYear ?? null,
        excludeTag1: query.excludeTag1 ?? "",
    })}`;
    return (0, runtime_cache_1.getOrSetRuntimeCacheStaleWhileRevalidate)(cacheKey, SUGGESTIONS_CACHE_TTL_MS, SUGGESTIONS_CACHE_STALE_TTL_MS, async () => {
        const searchTerms = buildSuggestionSearchTerms(rawQuery);
        const allCandidates = [];
        for (const searchTerm of searchTerms) {
            const listQuery = buildSuggestionListQuery(query, searchTerm);
            const sourceRows = await Promise.all(sources.map(async (source) => {
                const items = await listSourceItemsForSuggestions(source, listQuery);
                return {
                    source,
                    items,
                };
            }));
            for (const sourceRow of sourceRows) {
                for (const item of sourceRow.items) {
                    allCandidates.push(...extractSuggestionCandidates(sourceRow.source, item));
                }
            }
            if (allCandidates.length >= limit * 12) {
                break;
            }
        }
        return {
            items: rankSuggestionCandidates(allCandidates, rawQuery, limit),
        };
    });
}
