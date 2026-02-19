import { listHarajScrapes, type HarajScrapeListQuery } from "./harajScrapeController";
import { listYallaMotors } from "./yallaMotorController";
import { listSyarahs } from "./syarahController";
import { getOrSetRuntimeCacheStaleWhileRevalidate } from "../lib/runtime-cache";
import { buildVehicleAliases } from "@/lib/vehicle-name-match";

export type CarsSourcesListQuery = HarajScrapeListQuery & {
  sources?: string[];
};

export type CarsSearchSuggestionsQuery = CarsSourcesListQuery & {
  q?: string;
};

type CarsSourceKey = "haraj" | "yallamotor" | "syarah";
type SuggestionCandidate = {
  label: string;
  normalized: string;
  source: CarsSourceKey;
  weight: number;
};

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
const SOURCE_KEYS: CarsSourceKey[] = ["haraj", "yallamotor", "syarah"];
const SUGGESTIONS_MIN_QUERY_LENGTH = 2;

function normalizeSource(value: string) {
  return value.trim().toLowerCase();
}

function normalizeSuggestionText(value: string) {
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

function tokenizeSuggestionText(value: string) {
  return normalizeSuggestionText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function resolveSuggestionSources(sources?: string[]) {
  const normalizedSources = (sources ?? SOURCE_KEYS).map(normalizeSource);
  return SOURCE_KEYS.filter((source) => normalizedSources.includes(source));
}

function clampSuggestionLimit(limit?: number) {
  if (typeof limit !== "number" || Number.isNaN(limit)) {
    return SUGGESTIONS_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(limit), SUGGESTIONS_MAX_LIMIT));
}

function buildSuggestionSearchTerms(rawQuery: string) {
  const candidates = [rawQuery, ...buildVehicleAliases(rawQuery)];
  const unique = Array.from(
    new Set(
      candidates
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  const primary = unique[0] ?? "";
  const alias = unique.find(
    (value) => normalizeSuggestionText(value) !== normalizeSuggestionText(primary)
  );
  return alias ? [primary, alias] : [primary];
}

function buildSuggestionListQuery(
  query: CarsSearchSuggestionsQuery,
  search: string
): HarajScrapeListQuery {
  const {
    q: _q,
    sources: _sources,
    page: _page,
    limit: _limit,
    sort: _sort,
    fields: _fields,
    countMode: _countMode,
    ...rest
  } = query;

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

function toSuggestionString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toSuggestionTags(item: Record<string, any>) {
  if (!Array.isArray(item.tags)) {
    return [];
  }
  return item.tags
    .map((tag) => toSuggestionString(tag))
    .filter(Boolean);
}

function extractSuggestionCandidates(
  source: CarsSourceKey,
  item: Record<string, any>
): SuggestionCandidate[] {
  const title = toSuggestionString(item.title);
  const tags = toSuggestionTags(item);
  const brand = toSuggestionString(tags[1]);
  const model = toSuggestionString(tags[2]);
  const suggestions: SuggestionCandidate[] = [];

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

async function listSourceItemsForSuggestions(
  source: CarsSourceKey,
  query: HarajScrapeListQuery
) {
  if (source === "haraj") {
    const result = await listHarajScrapes(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
    return result.items as Array<Record<string, any>>;
  }
  if (source === "yallamotor") {
    const result = await listYallaMotors(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
    return result.items as Array<Record<string, any>>;
  }
  const result = await listSyarahs(query, { maxLimit: SUGGESTIONS_SOURCE_FETCH_LIMIT });
  return result.items as Array<Record<string, any>>;
}

function scoreSuggestionCandidate(
  candidate: SuggestionCandidate,
  normalizedVariants: string[],
  normalizedQueryTokens: string[]
) {
  let bestVariantScore = -1;
  for (const variant of normalizedVariants) {
    if (!variant) continue;
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

  const matchedTokenCount = normalizedQueryTokens.filter((token) =>
    candidate.normalized.includes(token)
  ).length;
  if (bestVariantScore < 0 && matchedTokenCount === 0) {
    return -1;
  }

  const fullTokenBonus =
    normalizedQueryTokens.length > 0 && matchedTokenCount === normalizedQueryTokens.length
      ? 26
      : matchedTokenCount * 6;
  const lengthDelta = Math.abs(candidate.normalized.length - (normalizedVariants[0]?.length ?? 0));
  const compactnessBonus = Math.max(0, 15 - Math.min(lengthDelta, 15));

  return (bestVariantScore < 0 ? 35 : bestVariantScore) + fullTokenBonus + compactnessBonus + candidate.weight;
}

function rankSuggestionCandidates(
  candidates: SuggestionCandidate[],
  queryText: string,
  limit: number
) {
  const normalizedVariants = buildSuggestionSearchTerms(queryText)
    .map((value) => normalizeSuggestionText(value))
    .filter(Boolean);
  const normalizedQueryTokens = tokenizeSuggestionText(queryText);
  const ranked = new Map<
    string,
    {
      label: string;
      score: number;
      hits: number;
      sources: Set<CarsSourceKey>;
    }
  >();

  for (const candidate of candidates) {
    const score = scoreSuggestionCandidate(candidate, normalizedVariants, normalizedQueryTokens);
    if (score < 0) continue;

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
      if (b.score !== a.score) return b.score - a.score;
      if (b.sources.size !== a.sources.size) return b.sources.size - a.sources.size;
      if (b.hits !== a.hits) return b.hits - a.hits;
      if (a.label.length !== b.label.length) return a.label.length - b.label.length;
      return a.label.localeCompare(b.label);
    })
    .slice(0, limit)
    .map((entry) => entry.label);
}

function toEpochMillis(value: number | null) {
  if (!value) return null;
  return value > 1_000_000_000_000 ? value : value * 1000;
}

function normalizeHarajItems(items: Array<Record<string, any>>) {
  return items.map((item) => ({
    ...item,
    postDate: toEpochMillis(item.postDate ?? null),
    source: "haraj",
    priceCompare: null,
  }));
}

function normalizeYallaItems(items: Array<Record<string, any>>) {
  return items.map((item) => ({
    ...item,
    postDate: toEpochMillis(item.postDate ?? null),
    source: "yallamotor",
  }));
}

function normalizeSyarahItems(items: Array<Record<string, any>>) {
  return items.map((item) => ({
    ...item,
    postDate: toEpochMillis(item.postDate ?? null),
    source: "syarah",
    priceCompare: null,
  }));
}

function sortItems(items: Array<Record<string, any>>, sort?: string) {
  const getDate = (item: Record<string, any>) => toEpochMillis(item.postDate ?? null) ?? 0;
  const getPrice = (item: Record<string, any>) =>
    typeof item.priceNumeric === "number" ? item.priceNumeric : null;
  const getComments = (item: Record<string, any>) =>
    typeof item.commentsCount === "number" ? item.commentsCount : 0;

  const compare = (a: Record<string, any>, b: Record<string, any>) => {
    switch (sort) {
      case "oldest":
        return getDate(a) - getDate(b);
      case "price-high": {
        const aPrice = getPrice(a);
        const bPrice = getPrice(b);
        if (aPrice === null && bPrice === null) return getDate(b) - getDate(a);
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;
        return bPrice - aPrice || getDate(b) - getDate(a);
      }
      case "price-low": {
        const aPrice = getPrice(a);
        const bPrice = getPrice(b);
        if (aPrice === null && bPrice === null) return getDate(b) - getDate(a);
        if (aPrice === null) return 1;
        if (bPrice === null) return -1;
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

function toNumericYear(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function buildYearOnlyItems(years: number[]) {
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
    source: "haraj" as const,
    priceCompare: null,
  }));
}

function buildDescendingYearRange(years: number[]) {
  const uniqueSortedYears = Array.from(
    new Set(
      years
        .map((year) => Math.trunc(year))
        .filter((year) => Number.isFinite(year))
    )
  ).sort((a, b) => b - a);

  if (uniqueSortedYears.length === 0) {
    return [];
  }

  const newestYear = uniqueSortedYears[0];
  const oldestYear = uniqueSortedYears[uniqueSortedYears.length - 1];
  if (newestYear - oldestYear > MAX_MODEL_YEAR_SPAN) {
    return uniqueSortedYears;
  }

  const fullRange: number[] = [];
  for (let year = newestYear; year >= oldestYear; year -= 1) {
    fullRange.push(year);
  }
  return fullRange;
}

export async function listCarsSources(query: CarsSourcesListQuery) {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const page = Math.max(query.page ?? 1, 1);
  const countMode = query.countMode === "none" ? "none" : "exact";

  const sources = (query.sources ?? ["haraj", "yallamotor", "syarah"]).map(normalizeSource);
  const includeHaraj = sources.includes("haraj");
  const includeYalla = sources.includes("yallamotor");
  const includeSyarah = sources.includes("syarah");
  const cacheTtlMs =
    query.fields === "modelYears"
      ? MODEL_YEARS_CACHE_TTL_MS
      : query.fields === "options"
        ? OPTIONS_CACHE_TTL_MS
        : LIST_CACHE_TTL_MS;
  const cacheStaleTtlMs =
    query.fields === "modelYears"
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

  return getOrSetRuntimeCacheStaleWhileRevalidate(
    cacheKey,
    cacheTtlMs,
    cacheStaleTtlMs,
    async () => {
    if (!includeHaraj && !includeYalla && !includeSyarah) {
      return {
        items: [],
        total: 0,
        page,
        limit,
      };
    }

    if (query.fields === "modelYears") {
      const modelYearsQuery: CarsSourcesListQuery = {
        ...query,
        tag1: undefined,
        tag2: undefined,
        carModelYear: undefined,
      };
      const [harajData, yallaData, syarahData] = await Promise.all([
        includeHaraj
          ? listHarajScrapes(
              {
                ...modelYearsQuery,
                page: 1,
                limit: MAX_INTERNAL_LIMIT,
                fields: "modelYears",
              },
              { maxLimit: MAX_INTERNAL_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>> }),
        includeYalla
          ? listYallaMotors(
              {
                ...modelYearsQuery,
                page: 1,
                limit: MAX_INTERNAL_LIMIT,
                fields: "modelYears",
              },
              { maxLimit: MAX_INTERNAL_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>> }),
        includeSyarah
          ? listSyarahs(
              {
                ...modelYearsQuery,
                page: 1,
                limit: MAX_INTERNAL_LIMIT,
                fields: "modelYears",
              },
              { maxLimit: MAX_INTERNAL_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>> }),
      ]);

      const years = [...harajData.items, ...yallaData.items, ...syarahData.items]
        .map((item) => toNumericYear((item as Record<string, any>).carModelYear))
        .filter((value): value is number => value !== null);
      const items = buildYearOnlyItems(buildDescendingYearRange(years));

      return {
        items,
        total: items.length,
        page: 1,
        limit: items.length || 1,
      };
    }

    if (includeHaraj && !includeYalla && !includeSyarah) {
      const harajData = await listHarajScrapes(
        {
          ...query,
          page,
          limit,
        },
        { maxLimit: MAX_LIMIT }
      );

      return {
        ...harajData,
        items: normalizeHarajItems(harajData.items as Array<Record<string, any>>),
        page,
        limit,
      };
    }

    if (!includeHaraj && includeYalla && !includeSyarah) {
      const yallaData = await listYallaMotors(
        {
          ...query,
          page,
          limit,
        },
        { maxLimit: MAX_LIMIT }
      );

      return {
        ...yallaData,
        items: normalizeYallaItems(yallaData.items as Array<Record<string, any>>),
        page,
        limit,
      };
    }

    if (!includeHaraj && !includeYalla && includeSyarah) {
      const syarahData = await listSyarahs(
        {
          ...query,
          page,
          limit,
        },
        { maxLimit: MAX_LIMIT }
      );

      return {
        ...syarahData,
        items: normalizeSyarahItems(syarahData.items as Array<Record<string, any>>),
        page,
        limit,
      };
    }

    if (query.fields === "options") {
      const [harajData, yallaData, syarahData] = await Promise.all([
        includeHaraj
          ? listHarajScrapes(
              {
                ...query,
                page,
                limit,
                fields: "options",
              },
              { maxLimit: MAX_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
        includeYalla
          ? listYallaMotors(
              {
                ...query,
                page,
                limit,
                fields: "options",
              },
              { maxLimit: MAX_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
        includeSyarah
          ? listSyarahs(
              {
                ...query,
                page,
                limit,
                fields: "options",
              },
              { maxLimit: MAX_LIMIT }
            )
          : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
      ]);

      return {
        items: sortItems(
          [
            ...normalizeHarajItems(harajData.items as Array<Record<string, any>>),
            ...normalizeYallaItems(yallaData.items as Array<Record<string, any>>),
            ...normalizeSyarahItems(syarahData.items as Array<Record<string, any>>),
          ],
          query.sort
        ).slice(0, limit),
        total: countMode === "none" ? -1 : harajData.total + yallaData.total + syarahData.total,
        page,
        limit,
        ...(countMode === "none"
          ? {
              hasNext:
                Boolean((harajData as { hasNext?: boolean }).hasNext) ||
                Boolean((yallaData as { hasNext?: boolean }).hasNext) ||
                Boolean((syarahData as { hasNext?: boolean }).hasNext),
            }
          : {}),
      };
    }

    const perSourceLimit = Math.min(
      limit * page + (countMode === "none" ? 1 : 0),
      MAX_INTERNAL_LIMIT
    );
    const [harajData, yallaData, syarahData] = await Promise.all([
      includeHaraj
        ? listHarajScrapes(
            {
              ...query,
              page: 1,
              limit: perSourceLimit,
            },
            { maxLimit: perSourceLimit }
          )
        : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
      includeYalla
        ? listYallaMotors(
            {
              ...query,
              page: 1,
              limit: perSourceLimit,
            },
            { maxLimit: perSourceLimit }
          )
        : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
      includeSyarah
        ? listSyarahs(
            {
              ...query,
              page: 1,
              limit: perSourceLimit,
            },
            { maxLimit: perSourceLimit }
          )
        : Promise.resolve({ items: [] as Array<Record<string, any>>, total: 0 }),
    ]);

    const combinedItems = sortItems(
      [
        ...normalizeHarajItems(harajData.items as Array<Record<string, any>>),
        ...normalizeYallaItems(yallaData.items as Array<Record<string, any>>),
        ...normalizeSyarahItems(syarahData.items as Array<Record<string, any>>),
      ],
      query.sort
    );
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
    }
  );
}

export async function listCarsSourceSearchSuggestions(query: CarsSearchSuggestionsQuery) {
  const rawQuery = (query.q ?? query.search ?? "").trim();
  if (rawQuery.length < SUGGESTIONS_MIN_QUERY_LENGTH) {
    return { items: [] as string[] };
  }

  const limit = clampSuggestionLimit(query.limit);
  const sources = resolveSuggestionSources(query.sources);
  if (sources.length === 0) {
    return { items: [] as string[] };
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

  return getOrSetRuntimeCacheStaleWhileRevalidate(
    cacheKey,
    SUGGESTIONS_CACHE_TTL_MS,
    SUGGESTIONS_CACHE_STALE_TTL_MS,
    async () => {
      const searchTerms = buildSuggestionSearchTerms(rawQuery);
      const allCandidates: SuggestionCandidate[] = [];

      for (const searchTerm of searchTerms) {
        const listQuery = buildSuggestionListQuery(query, searchTerm);
        const sourceRows = await Promise.all(
          sources.map(async (source) => {
            const items = await listSourceItemsForSuggestions(source, listQuery);
            return {
              source,
              items,
            };
          })
        );

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
    }
  );
}
