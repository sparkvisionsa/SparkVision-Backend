import { listHarajScrapes, type HarajScrapeListQuery } from "./harajScrapeController";
import { listYallaMotors } from "./yallaMotorController";
import { getOrSetRuntimeCacheStaleWhileRevalidate } from "../lib/runtime-cache";

export type CarsSourcesListQuery = HarajScrapeListQuery & {
  sources?: string[];
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

function normalizeSource(value: string) {
  return value.trim().toLowerCase();
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

  const sources = (query.sources ?? ["haraj", "yallamotor"]).map(normalizeSource);
  const includeHaraj = sources.includes("haraj");
  const includeYalla = sources.includes("yallamotor");
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
    if (!includeHaraj && !includeYalla) {
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
      const [harajData, yallaData] = await Promise.all([
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
      ]);

      const years = [...harajData.items, ...yallaData.items]
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

    if (includeHaraj && !includeYalla) {
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

    if (!includeHaraj && includeYalla) {
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

    if (query.fields === "options") {
      const [harajData, yallaData] = await Promise.all([
        listHarajScrapes(
          {
            ...query,
            page,
            limit,
            fields: "options",
          },
          { maxLimit: MAX_LIMIT }
        ),
        listYallaMotors(
          {
            ...query,
            page,
            limit,
            fields: "options",
          },
          { maxLimit: MAX_LIMIT }
        ),
      ]);

      return {
        items: sortItems(
          [
            ...normalizeHarajItems(harajData.items as Array<Record<string, any>>),
            ...normalizeYallaItems(yallaData.items as Array<Record<string, any>>),
          ],
          query.sort
        ).slice(0, limit),
        total: countMode === "none" ? -1 : harajData.total + yallaData.total,
        page,
        limit,
        ...(countMode === "none"
          ? {
              hasNext:
                Boolean((harajData as { hasNext?: boolean }).hasNext) ||
                Boolean((yallaData as { hasNext?: boolean }).hasNext),
            }
          : {}),
      };
    }

    const perSourceLimit = Math.min(
      limit * page + (countMode === "none" ? 1 : 0),
      MAX_INTERNAL_LIMIT
    );
    const [harajData, yallaData] = await Promise.all([
      listHarajScrapes(
        {
          ...query,
          page: 1,
          limit: perSourceLimit,
        },
        { maxLimit: perSourceLimit }
      ),
      listYallaMotors(
        {
          ...query,
          page: 1,
          limit: perSourceLimit,
        },
        { maxLimit: perSourceLimit }
      ),
    ]);

    const combinedItems = sortItems(
      [
        ...normalizeHarajItems(harajData.items as Array<Record<string, any>>),
        ...normalizeYallaItems(yallaData.items as Array<Record<string, any>>),
      ],
      query.sort
    );
    const start = (page - 1) * limit;
    const pageWindowSize = limit + (countMode === "none" ? 1 : 0);
    const pageWindow = combinedItems.slice(start, start + pageWindowSize);
    const hasNext = countMode === "none" ? pageWindow.length > limit : undefined;
    const pagedItems = countMode === "none" ? pageWindow.slice(0, limit) : pageWindow;
    const total = countMode === "none" ? -1 : harajData.total + yallaData.total;

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
