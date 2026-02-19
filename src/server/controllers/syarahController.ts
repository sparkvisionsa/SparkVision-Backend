import type { Document, Filter, Sort } from "mongodb";
import { getMongoDb } from "../mongodb";
import { getSyarahCollection, type SyarahDoc } from "../models/syarah";
import type { HarajScrapeListQuery } from "./harajScrapeController";
import { buildVehicleAliases } from "../../lib/vehicle-name-match";
import {
  buildSearchRegex,
  buildSmartSearchTermGroups,
  buildSmartTextSearchQuery,
} from "../../lib/smart-search";
import {
  getOrSetRuntimeCache,
  getOrSetRuntimeCacheStaleWhileRevalidate,
} from "../lib/runtime-cache";

export type SyarahListQuery = HarajScrapeListQuery;

type ListOptions = {
  maxLimit?: number;
};

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
type SearchCandidateIdsResult = {
  supported: true;
  ids: readonly unknown[];
};

function toRegex(value: string, options?: { exact?: boolean; fuzzyArabic?: boolean }) {
  return buildSearchRegex(value, {
    exact: options?.exact,
    fuzzyArabic: options?.fuzzyArabic === true,
  });
}

function normalizeList(value?: string | string[]) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : value.split(",");
  return values.map((item) => item.trim()).filter(Boolean);
}

function buildAliasRegexes(value: string) {
  const aliases = [value, ...buildVehicleAliases(value)];
  const uniqueAliases = Array.from(
    new Set(aliases.map((item) => item.trim()).filter(Boolean))
  );
  return uniqueAliases.map((item) => toRegex(item));
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toEpochMillis(value: unknown) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const text = String(value).trim();
  if (!text) return null;
  const numericCandidate = Number(text);
  if (!Number.isNaN(numericCandidate)) {
    return numericCandidate > 1_000_000_000_000
      ? numericCandidate
      : numericCandidate * 1000;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function toCleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function buildNumericExpression(fieldPath: string): Document {
  return {
    $convert: {
      input: `$${fieldPath}`,
      to: "double",
      onError: null,
      onNull: null,
    },
  };
}

function canUseSearchCandidates(query: SyarahListQuery) {
  return query.exactSearch !== true && Boolean(query.search?.trim());
}

function resolveSearchCandidateLimit(query: SyarahListQuery) {
  const page = Math.max(query.page ?? 1, 1);
  const limit = Math.max(query.limit ?? DEFAULT_LIMIT, 1);
  const pageWindow = page * limit;
  const usesDeepSort =
    query.sort === "price-high" || query.sort === "price-low" || query.sort === "comments";
  const multiplier = usesDeepSort
    ? SEARCH_TEXT_DEEP_SORT_WINDOW_MULTIPLIER
    : SEARCH_TEXT_DEFAULT_WINDOW_MULTIPLIER;
  const computedLimit = pageWindow * multiplier;

  return Math.max(
    SEARCH_TEXT_CANDIDATE_MIN_LIMIT,
    Math.min(computedLimit, SEARCH_TEXT_CANDIDATE_LIMIT)
  );
}

async function resolveSyarahSearchCandidateIds(
  collection: ReturnType<typeof getSyarahCollection>,
  query: SyarahListQuery
) {
  if (!canUseSearchCandidates(query)) {
    return null;
  }

  const textSearchQuery = buildSmartTextSearchQuery(query.search, {
    exact: false,
    maxTerms: 8,
    maxAliasesPerTerm: 8,
    maxOutputTerms: 20,
  });
  if (!textSearchQuery) {
    return null;
  }

  const candidateLimit = resolveSearchCandidateLimit(query);
  const cacheKey = `syarah:search-candidates:${textSearchQuery}:${candidateLimit}`;
  return getOrSetRuntimeCacheStaleWhileRevalidate(
    cacheKey,
    SEARCH_CANDIDATE_CACHE_TTL_MS,
    SEARCH_CANDIDATE_CACHE_STALE_TTL_MS,
    async () => {
      try {
        const rows = await collection
          .find(
            {
              $text: {
                $search: textSearchQuery,
                $caseSensitive: false,
                $diacriticSensitive: false,
              },
            } as Filter<SyarahDoc>,
            {
              projection: { _id: 1 },
              limit: candidateLimit,
            }
          )
          .toArray();

        // If we hit the hard cap, avoid clipping and fallback to regex-only flow.
        if (candidateLimit >= SEARCH_TEXT_CANDIDATE_LIMIT && rows.length >= candidateLimit) {
          return null;
        }

        return {
          supported: true,
          ids: rows.map((doc) => doc._id),
        } as SearchCandidateIdsResult;
      } catch {
        // Text index might not exist yet on all environments.
        return null;
      }
    }
  );
}

function buildFilter(
  query: SyarahListQuery,
  searchCandidateIds?: SearchCandidateIdsResult | null
): Filter<SyarahDoc> {
  const filter: Filter<SyarahDoc> = {};
  const andFilters: Filter<SyarahDoc>[] = [];
  const shouldApplyRegexSearch = !searchCandidateIds?.supported || query.exactSearch === true;

  if (searchCandidateIds?.supported) {
    andFilters.push({
      _id: { $in: [...searchCandidateIds.ids] },
    } as unknown as Filter<SyarahDoc>);
  }

  if (query.search && shouldApplyRegexSearch) {
    const termGroups = buildSmartSearchTermGroups(query.search, {
      exact: query.exactSearch === true,
    });
    for (const group of termGroups) {
      const searchRegexes = group.map((term) =>
        toRegex(term, {
          exact: query.exactSearch === true,
          fuzzyArabic: query.exactSearch !== true,
        })
      );
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
          { tags: { $in: searchRegexes } },
        ],
      } as Filter<SyarahDoc>);
    }
  }

  if (query.city) {
    andFilters.push({ city: toRegex(query.city) });
  }

  if (query.tag1) {
    andFilters.push({ brand: { $in: buildAliasRegexes(query.tag1) } as any });
  }

  if (query.tag2) {
    andFilters.push({ model: { $in: buildAliasRegexes(query.tag2) } as any });
  }

  if (query.carModelYear !== undefined) {
    andFilters.push({
      year: {
        $in: [query.carModelYear, String(query.carModelYear)],
      } as any,
    });
  }

  if (query.hasImage === true) {
    andFilters.push({
      $or: [{ "images.0": { $exists: true } }, { featured_image: { $regex: /\S/ } }],
    });
  }

  const effectivePriceExpression: Document = {
    $ifNull: [buildNumericExpression("price_cash"), buildNumericExpression("price_monthly")],
  };

  if (query.hasPrice === true) {
    andFilters.push({
      $expr: {
        $gt: [effectivePriceExpression, 0],
      },
    } as Filter<SyarahDoc>);
  }

  if (query.hasComments === true) {
    andFilters.push({
      $or: [{ "comments.0": { $exists: true } }, { commentsCount: { $gt: 0 } }],
    } as Filter<SyarahDoc>);
  }

  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    const priceConditions: Document[] = [{ $ne: [effectivePriceExpression, null] }];
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
    } as Filter<SyarahDoc>);
  }

  if (query.dateFrom || query.dateTo) {
    const fetchedAtExpression: Document = {
      $convert: {
        input: "$fetchedAt",
        to: "date",
        onError: null,
        onNull: null,
      },
    };
    const dateConditions: Document[] = [{ $ne: [fetchedAtExpression, null] }];
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
      } as Filter<SyarahDoc>);
    }
  }

  const excludeTag1Values = normalizeList(query.excludeTag1);
  if (excludeTag1Values.length > 0) {
    andFilters.push({
      brand: {
        $nin: excludeTag1Values,
      } as any,
    });
  }

  if (
    query.hasMileage === true ||
    query.mileage !== undefined ||
    query.mileageMin !== undefined ||
    query.mileageMax !== undefined
  ) {
    const mileageExpression = buildNumericExpression("mileage_km");
    const mileageConditions: Document[] = [{ $ne: [mileageExpression, null] }];

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
    } as Filter<SyarahDoc>);
  }

  if (andFilters.length > 0) {
    filter.$and = andFilters;
  }

  return filter;
}

function buildSort(sort?: string): Sort {
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

function buildListProjection(fields?: SyarahListQuery["fields"]): Document {
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

function buildCountSignature(query: SyarahListQuery) {
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

function isFilterEmpty(filter: Filter<SyarahDoc>) {
  return !Array.isArray(filter.$and) || filter.$and.length === 0;
}

function normalizeSyarahListItem(doc: SyarahDoc, fields?: SyarahListQuery["fields"]) {
  const brand = toCleanString(doc.brand);
  const model = toCleanString(doc.model);
  const trim = toCleanString(doc.trim);
  const year = toNumber(doc.year);
  const mileage = toNumber(doc.mileage_km);
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
      source: "syarah" as const,
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
    phone: toCleanString((doc as Record<string, unknown>).phone),
    url: toCleanString(doc.share_link),
    source: "syarah" as const,
    priceCompare: null,
  };
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
    source: "syarah" as const,
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

export async function listSyarahs(query: SyarahListQuery, options: ListOptions = {}) {
  const maxLimit = options.maxLimit ?? MAX_LIMIT;
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), maxLimit);
  const page = Math.max(query.page ?? 1, 1);
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
  const cacheKey = `syarah:list:${JSON.stringify({
    query,
    maxLimit,
    page,
    limit,
  })}`;

  return getOrSetRuntimeCacheStaleWhileRevalidate(
    cacheKey,
    cacheTtlMs,
    cacheStaleTtlMs,
    async () => {
      const db = await getMongoDb();
      const collection = getSyarahCollection(db);
      const searchCandidateIds = await resolveSyarahSearchCandidateIds(collection, query);
      const hasNoHits =
        searchCandidateIds?.supported === true && searchCandidateIds.ids.length === 0;
      if (query.search && hasNoHits) {
        if (query.fields === "modelYears") {
          return {
            items: [] as Array<Record<string, any>>,
            total: 0,
            page: 1,
            limit: 1,
          };
        }

        const countMode = query.countMode === "none" ? "none" : "exact";
        return {
          items: [] as Array<Record<string, any>>,
          total: 0,
          page,
          limit,
          ...(countMode === "none" ? { hasNext: false } : {}),
        };
      }
      const filter = buildFilter(query, searchCandidateIds);

      if (query.fields === "modelYears") {
        const modelYearFilter = buildFilter({
          ...query,
          tag1: undefined,
          tag2: undefined,
          carModelYear: undefined,
        }, searchCandidateIds);
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
          .filter((value): value is number => value !== null);
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
      const items = (countMode === "none" ? rawItems.slice(0, limit) : rawItems).map((doc) =>
        normalizeSyarahListItem(doc, query.fields)
      );

      const total =
        countMode === "none"
          ? -1
          : await getOrSetRuntimeCacheStaleWhileRevalidate(
              `syarah:count:${JSON.stringify(buildCountSignature(query))}`,
              COUNT_CACHE_TTL_MS,
              COUNT_CACHE_STALE_TTL_MS,
              async () => {
                if (isFilterEmpty(filter)) {
                  return collection.estimatedDocumentCount();
                }
                return collection.countDocuments(filter);
              }
            );

      return {
        items,
        total,
        page,
        limit,
        ...(hasNext !== undefined ? { hasNext } : {}),
      };
    }
  );
}

export async function getSyarahById(id: string) {
  return getOrSetRuntimeCache(`syarah:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
    const db = await getMongoDb();
    const collection = getSyarahCollection(db);
    const numericId = Number(id);
    const filters: Filter<SyarahDoc>[] = [
      { _id: id as any },
      { id },
      { post_id: id } as any,
      { share_link: id },
    ];
    if (!Number.isNaN(numericId)) {
      filters.push({ id: numericId } as any, { post_id: numericId } as any);
    }
    return collection.findOne({ $or: filters });
  });
}
