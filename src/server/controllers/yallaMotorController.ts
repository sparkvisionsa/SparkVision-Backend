import type { Collection, Document, Filter, Sort } from "mongodb";
import { ObjectId } from "mongodb";
import { getMongoDb } from "../mongodb";
import {
  getYallaNewCarsCollection,
  getYallaMotorCollection,
  getYallaUsedCollection,
  type YallaMotorDoc,
  YALLA_MOTOR_NEW_CARS_COLLECTION,
  YALLA_MOTOR_USED_COLLECTION,
} from "../models/yallaMotor";
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

export type YallaMotorListQuery = HarajScrapeListQuery;

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
const FAST_PATH_MAX_CANDIDATES = 2_500;
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

type YallaSearchCandidateIds = {
  legacy?: SearchCandidateIdsResult | null;
  used?: SearchCandidateIdsResult | null;
  newCars?: SearchCandidateIdsResult | null;
};

const FAST_YALLA_PROJECTION = {
  _id: 1,
  adId: 1,
  type: 1,
  breadcrumbs: 1,
  location: 1,
  cardTitle: 1,
  title: 1,
  cardPriceText: 1,
  price: 1,
  priceText: 1,
  priceNumber: 1,
  fetchedAt: 1,
  scrapedAt: 1,
  detailScrapedAt: 1,
  updatedAt: 1,
  createdAt: 1,
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
} as const;

const FAST_YALLA_CANDIDATE_PROJECTION = {
  _id: 1,
  fetchedAt: 1,
  scrapedAt: 1,
  detailScrapedAt: 1,
  updatedAt: 1,
  createdAt: 1,
} as const;

const YALLA_MILEAGE_KEY_AR = "\u0639\u062f\u062f \u0627\u0644\u0643\u064a\u0644\u0648\u0645\u062a\u0631\u0627\u062a";
const YALLA_DISTANCE_KEY_AR = "\u0627\u0644\u0645\u0633\u0627\u0641\u0629 \u0627\u0644\u0645\u0642\u0637\u0648\u0639\u0629";
const YALLA_KILOMETER_TOKEN_AR = "\u0643\u064a\u0644\u0648\u0645\u062a\u0631";
const YALLA_KILOMETERS_TOKEN_AR = "\u0627\u0644\u0643\u064a\u0644\u0648\u0645\u062a\u0631\u0627\u062a";
const YALLA_NEW_LABEL_AR = String.fromCharCode(0x062c, 0x062f, 0x064a, 0x062f);
const YALLA_NEW_FEMININE_LABEL_AR = `${YALLA_NEW_LABEL_AR}${String.fromCharCode(0x0629)}`;
const YALLA_NEW_CAR_REGEX_PATTERN = `(new|${YALLA_NEW_LABEL_AR}|${YALLA_NEW_FEMININE_LABEL_AR})`;

function toRegex(value: string, options?: { exact?: boolean; fuzzyArabic?: boolean }) {
  return buildSearchRegex(value, {
    exact: options?.exact,
    fuzzyArabic: options?.fuzzyArabic === true,
  });
}

function buildAliasRegexes(value: string) {
  const aliases = [value, ...buildVehicleAliases(value)];
  const uniqueAliases = Array.from(
    new Set(aliases.map((item) => item.trim()).filter(Boolean))
  );
  return uniqueAliases.map((item) => toRegex(item));
}

function canUseSearchCandidates(query: YallaMotorListQuery) {
  return query.exactSearch !== true && Boolean(query.search?.trim());
}

function resolveSearchCandidateLimit(query: YallaMotorListQuery) {
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

async function resolveYallaCollectionSearchCandidateIds(
  collection: Collection<YallaMotorDoc>,
  sourceKey: string,
  textSearchQuery: string,
  candidateLimit: number
) {
  const cacheKey = `yalla:${sourceKey}:search-candidates:${textSearchQuery}:${candidateLimit}`;
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
            } as Filter<YallaMotorDoc>,
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

async function resolveYallaSearchCandidateIds(
  query: YallaMotorListQuery,
  legacyCollection: Collection<YallaMotorDoc>,
  usedCollection: Collection<YallaMotorDoc>,
  newCarsCollection: Collection<YallaMotorDoc>
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
  const [legacy, used, newCars] = await Promise.all([
    resolveYallaCollectionSearchCandidateIds(
      legacyCollection,
      "legacy",
      textSearchQuery,
      candidateLimit
    ),
    resolveYallaCollectionSearchCandidateIds(
      usedCollection,
      "used",
      textSearchQuery,
      candidateLimit
    ),
    resolveYallaCollectionSearchCandidateIds(
      newCarsCollection,
      "newcars",
      textSearchQuery,
      candidateLimit
    ),
  ]);

  if (!legacy && !used && !newCars) {
    return null;
  }

  return { legacy, used, newCars } as YallaSearchCandidateIds;
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

function normalizeArabicDigits(input: string) {
  return input.replace(/[\u0660-\u0669]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0660)
  );
}

function parsePriceNumericValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const raw = normalizeArabicDigits(String(value));
  const match = raw.match(/[0-9][0-9,.]*/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

function parseMileageNumericValue(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const raw = normalizeArabicDigits(String(value));
  const normalized = raw.replace(/[,.\s]+/g, "");
  const match = normalized.match(/[0-9][0-9]*/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractYallaMileage(specs: Record<string, unknown>) {
  const directKeys = [YALLA_MILEAGE_KEY_AR, YALLA_DISTANCE_KEY_AR, "Mileage"];
  for (const key of directKeys) {
    if (!(key in specs)) continue;
    const parsed = parseMileageNumericValue(specs[key]);
    if (parsed !== null) return parsed;
  }

  for (const [key, rawValue] of Object.entries(specs)) {
    const lowerKey = key.toLowerCase();
    const isMileageKey =
      /(mileage|kilometer|kilometre)/.test(lowerKey) ||
      lowerKey.includes(YALLA_KILOMETER_TOKEN_AR) ||
      lowerKey.includes(YALLA_KILOMETERS_TOKEN_AR);
    if (!isMileageKey) continue;
    const parsed = parseMileageNumericValue(rawValue);
    if (parsed !== null) return parsed;
  }

  return null;
}

function buildSort(sort?: string): Sort {
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

function buildPriceNumericExpression(input: string): Document {
  return {
    $let: {
      vars: {
        match: {
          $regexFind: {
            input: {
              $convert: {
                input: { $ifNull: [input, ""] },
                to: "string",
                onError: "",
                onNull: "",
              },
            },
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

function buildNormalizedDigitExpression(input: Document): Document {
  const replacements: Array<[string, string]> = [
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

  let output: Document = input;
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
function buildMileageNumericExpression(input: Document): Document {
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

function buildModelYearFromTextExpression(input: Document): Document {
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
            regex: /(19|20)[0-9]{2}/,
          },
        },
      },
      in: {
        $convert: {
          input: "$$match.match",
          to: "int",
          onError: null,
          onNull: null,
        },
      },
    },
  };
}

function buildYallaMileageRawExpression(specsInput: string): Document {
  const specsExpression: Document = {
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

function buildPostDateExpression(): Document {
  return {
    $cond: [
      { $ne: ["$fetchedDate", null] },
      { $toLong: "$fetchedDate" },
      null,
    ],
  };
}

function buildNormalizedYallaStages(
  searchCandidateIds?: SearchCandidateIdsResult | null
): Document[] {
  const breadcrumbExpression: Document = {
    $cond: [
      { $isArray: "$detail.breadcrumb" },
      "$detail.breadcrumb",
      {
        $cond: [{ $isArray: "$breadcrumbs" }, "$breadcrumbs", []],
      },
    ],
  };

  const imagesExpression: Document = {
    $cond: [
      { $isArray: "$detail.images" },
      "$detail.images",
      {
        $cond: [{ $isArray: "$images" }, "$images", []],
      },
    ],
  };

  const specsExpression: Document = {
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

  const descriptionExpression: Document = {
    $ifNull: [
      "$detail.description",
      {
        $ifNull: [
          "$description",
          {
            $ifNull: ["$descriptionText", "$descriptionHtml"],
          },
        ],
      },
    ],
  };

  const priceTextExpression: Document = {
    $ifNull: [
      "$cardPriceText",
      {
        $ifNull: [
          "$price",
          {
            $ifNull: ["$priceText", "$priceNumber"],
          },
        ],
      },
    ],
  };

  const usedPriceCompareExpression: Document = {
    min: { $ifNull: ["$priceComparison.marketMinText", "$priceComparison.marketMin"] },
    max: { $ifNull: ["$priceComparison.marketMaxText", "$priceComparison.marketMax"] },
    current: { $ifNull: ["$priceComparison.markerPriceText", "$priceComparison.markerPrice"] },
  };

  const hasUsedPriceCompare: Document = {
    $or: [
      { $ne: ["$priceComparison.marketMinText", null] },
      { $ne: ["$priceComparison.marketMaxText", null] },
      { $ne: ["$priceComparison.markerPriceText", null] },
      { $ne: ["$priceComparison.marketMin", null] },
      { $ne: ["$priceComparison.marketMax", null] },
      { $ne: ["$priceComparison.markerPrice", null] },
    ],
  };

  const fetchedDateExpression: Document = {
    $convert: {
      input: {
        $ifNull: [
          "$fetchedAt",
          {
            $ifNull: [
              "$scrapedAt",
              {
                $ifNull: [
                  "$detailScrapedAt",
                  {
                    $ifNull: ["$updatedAt", "$createdAt"],
                  },
                ],
              },
            ],
          },
        ],
      },
      to: "date",
      onError: null,
      onNull: null,
    },
  };

  const normalizedTypeExpression: Document = {
    $toUpper: {
      $convert: {
        input: { $ifNull: ["$type", ""] },
        to: "string",
        onError: "",
        onNull: "",
      },
    },
  };

  const breadcrumbSecondSegmentExpression: Document = {
    $toLower: {
      $convert: {
        input: { $ifNull: [{ $arrayElemAt: ["$breadcrumb", 1] }, ""] },
        to: "string",
        onError: "",
        onNull: "",
      },
    },
  };

  const isNewCarExpression: Document = {
    $or: [
      { $eq: [normalizedTypeExpression, "NEW_CAR"] },
      {
        $regexMatch: {
          input: breadcrumbSecondSegmentExpression,
          regex: YALLA_NEW_CAR_REGEX_PATTERN,
        },
      },
    ],
  };

  const legacyModelYearExpression: Document = {
    $convert: {
      input: { $arrayElemAt: ["$breadcrumb", 5] },
      to: "int",
      onError: null,
      onNull: null,
    },
  };

  const modelYearFromBreadcrumbTitleExpression = buildModelYearFromTextExpression({
    $arrayElemAt: ["$breadcrumb", 4],
  });

  const stages: Document[] = [];
  if (searchCandidateIds?.supported) {
    stages.push({
      $match: {
        _id: { $in: [...searchCandidateIds.ids] },
      },
    });
  }

  stages.push(
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
        type: "$type",
        breadcrumb: breadcrumbExpression,
        description: descriptionExpression,
        overviewH1: { $ifNull: ["$detail.overview.h1", "$title"] },
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
        priceText: {
          $convert: {
            input: priceTextExpression,
            to: "string",
            onError: null,
            onNull: null,
          },
        },
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
        tag1: {
          $ifNull: [
            {
              $cond: [
                isNewCarExpression,
                { $arrayElemAt: ["$breadcrumb", 2] },
                { $arrayElemAt: ["$breadcrumb", 3] },
              ],
            },
            "",
          ],
        },
        tag2: {
          $ifNull: [
            {
              $cond: [
                isNewCarExpression,
                { $arrayElemAt: ["$breadcrumb", 3] },
                { $arrayElemAt: ["$breadcrumb", 4] },
              ],
            },
            "",
          ],
        },
        city: {
          $ifNull: [
            {
              $cond: [
                isNewCarExpression,
                "$location",
                { $ifNull: [{ $arrayElemAt: ["$breadcrumb", 2] }, "$location"] },
              ],
            },
            "",
          ],
        },
        carModelYear: {
          $ifNull: [
            {
              $cond: [
                isNewCarExpression,
                modelYearFromBreadcrumbTitleExpression,
                legacyModelYearExpression,
              ],
            },
            modelYearFromBreadcrumbTitleExpression,
          ],
        },
        mileage: buildMileageNumericExpression(buildYallaMileageRawExpression("$specs")),
        priceNumeric: buildPriceNumericExpression("$priceText"),
        postDate: buildPostDateExpression(),
      },
    }
  );

  return stages;
}

function buildCombinedYallaPipeline(searchCandidateIds?: YallaSearchCandidateIds): Document[] {
  const baseStages = buildNormalizedYallaStages(searchCandidateIds?.legacy);
  return [
    ...baseStages,
    {
      $unionWith: {
        coll: YALLA_MOTOR_USED_COLLECTION,
        pipeline: buildNormalizedYallaStages(searchCandidateIds?.used),
      },
    },
    {
      $unionWith: {
        coll: YALLA_MOTOR_NEW_CARS_COLLECTION,
        pipeline: buildNormalizedYallaStages(searchCandidateIds?.newCars),
      },
    },
  ];
}

function buildFilter(
  query: YallaMotorListQuery,
  options?: {
    skipSearchRegex?: boolean;
  }
): Filter<Document> {
  const filter: Filter<Document> = {};
  const andFilters: Filter<Document>[] = [];

  if (query.search && options?.skipSearchRegex !== true) {
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
          { description: { $in: searchRegexes } },
          { overviewH1: { $in: searchRegexes } },
          { overviewH4: { $in: searchRegexes } },
          { breadcrumb: { $in: searchRegexes } },
          { tag1: { $in: searchRegexes } },
          { tag2: { $in: searchRegexes } },
        ],
      } as Filter<Document>);
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
    const range: { $gte?: Date; $lte?: Date } = {};
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

function toNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  }
  if (
    typeof value === "object" &&
    value &&
    "toNumber" in value &&
    typeof (value as any).toNumber === "function"
  ) {
    return (value as any).toNumber();
  }
  return null;
}

function getYallaBreadcrumbs(doc: Record<string, any>) {
  const detailBreadcrumb = doc.detail?.breadcrumb;
  if (Array.isArray(detailBreadcrumb)) return detailBreadcrumb;
  const legacyBreadcrumb = doc.breadcrumbs;
  if (Array.isArray(legacyBreadcrumb)) return legacyBreadcrumb;
  return [] as unknown[];
}

function getYallaImages(doc: Record<string, any>) {
  const detailImages = doc.detail?.images;
  if (Array.isArray(detailImages)) return detailImages;
  const legacyImages = doc.images;
  if (Array.isArray(legacyImages)) return legacyImages;
  return [] as unknown[];
}

function getYallaSpecs(doc: Record<string, any>) {
  const detailSpecs = doc.detail?.importantSpecs;
  if (isRecord(detailSpecs)) return detailSpecs as Record<string, unknown>;
  const highlights = doc.highlights;
  if (isRecord(highlights)) return highlights as Record<string, unknown>;
  return {} as Record<string, unknown>;
}

function getYallaPostDateMs(doc: Record<string, any>) {
  return (
    toEpochMillis(doc.fetchedAt) ??
    toEpochMillis(doc.scrapedAt) ??
    toEpochMillis(doc.detailScrapedAt) ??
    toEpochMillis(doc.updatedAt) ??
    toEpochMillis(doc.createdAt)
  );
}

function parseYallaModelYearFromText(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = normalizeArabicDigits(String(value));
  const match = normalized.match(/(19|20)\d{2}/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function isYallaNewCarDoc(doc: Record<string, any>, breadcrumbs: unknown[]) {
  const type = typeof doc.type === "string" ? doc.type.trim().toUpperCase() : "";
  if (type === "NEW_CAR") return true;

  const breadcrumbType = typeof breadcrumbs[1] === "string" ? breadcrumbs[1].toLowerCase() : "";
  return new RegExp(YALLA_NEW_CAR_REGEX_PATTERN).test(breadcrumbType);
}

function normalizeFastYallaListItem(doc: Record<string, any>, isOptionsMode: boolean) {
  const breadcrumbs = getYallaBreadcrumbs(doc);
  const images = getYallaImages(doc);
  const specs = getYallaSpecs(doc);
  const isNewCar = isYallaNewCarDoc(doc, breadcrumbs);
  const titleFallback =
    doc.title ?? doc.detail?.overview?.h1 ?? "Untitled";
  const title = doc.cardTitle ?? titleFallback ?? "Untitled";
  const city = isNewCar ? (doc.location ?? "") : (breadcrumbs[2] ?? doc.location ?? "");
  const priceText = doc.cardPriceText ?? doc.price ?? doc.priceText ?? doc.priceNumber ?? null;
  const carModelYear =
    (isNewCar ? parseYallaModelYearFromText(breadcrumbs[4]) : toNumber(breadcrumbs[5])) ??
    parseYallaModelYearFromText(breadcrumbs[4]);
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
      isNewCar ? (breadcrumbs[2] ?? "") : (breadcrumbs[3] ?? ""),
      isNewCar ? (breadcrumbs[3] ?? "") : (breadcrumbs[4] ?? ""),
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
    source: "yallamotor" as const,
    priceCompare: isOptionsMode ? null : priceCompare,
  };
}

function buildYearOnlyItems(years: number[]) {
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
    source: "yallamotor" as const,
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

function buildYallaListPipeline(
  query: YallaMotorListQuery,
  page: number,
  limit: number,
  mode: "items" | "count" = "items",
  searchCandidateIds?: YallaSearchCandidateIds | null,
  skipSearchRegex = false
): Document[] {
  const skip = (page - 1) * limit;
  const filter = buildFilter(query, { skipSearchRegex });
  const sort = buildSort(query.sort);
  const isOptionsMode = query.fields === "options";
  const needsNumericPrice =
    mode === "count" ||
    query.sort === "price-high" ||
    query.sort === "price-low" ||
    query.minPrice !== undefined ||
    query.maxPrice !== undefined;

  const priceRange: { $gte?: number; $lte?: number } = {};
  if (query.minPrice !== undefined) priceRange.$gte = query.minPrice;
  if (query.maxPrice !== undefined) priceRange.$lte = query.maxPrice;
  const applyPriceRange = Object.keys(priceRange).length > 0;

  const mileageRange: { $gte?: number; $lte?: number } = {};
  if (query.mileage !== undefined) {
    mileageRange.$gte = query.mileage;
    mileageRange.$lte = query.mileage;
  }
  if (query.mileageMin !== undefined) mileageRange.$gte = query.mileageMin;
  if (query.mileageMax !== undefined) mileageRange.$lte = query.mileageMax;
  const applyHasMileage = query.hasMileage === true;
  const applyMileageRange = Object.keys(mileageRange).length > 0;

  const pipeline: Document[] = [
    ...buildCombinedYallaPipeline(searchCandidateIds ?? undefined),
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

function buildCountSignature(query: YallaMotorListQuery) {
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

function isUnfilteredYallaQuery(query: YallaMotorListQuery) {
  return (
    !query.search &&
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
    query.mileageMax === undefined
  );
}

function isFastDateOnlyYallaQuery(query: YallaMotorListQuery) {
  return (
    isUnfilteredYallaQuery(query) &&
    (!query.sort || query.sort === "newest" || query.sort === "oldest") &&
    query.fields !== "modelYears"
  );
}

export async function listYallaMotors(query: YallaMotorListQuery, options: ListOptions = {}) {
  const maxLimit = options.maxLimit ?? MAX_LIMIT;
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, maxLimit);
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
  const cacheKey = `yalla:list:${JSON.stringify({
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
    const legacyCollection = getYallaMotorCollection(db);
    const usedCollection = getYallaUsedCollection(db);
    const newCarsCollection = getYallaNewCarsCollection(db);
    const searchCandidateIds = await resolveYallaSearchCandidateIds(
      query,
      legacyCollection,
      usedCollection,
      newCarsCollection
    );
    const hasSearchText = Boolean(query.search?.trim());
    const allSearchCandidateSetsSupported =
      searchCandidateIds?.legacy?.supported === true &&
      searchCandidateIds?.used?.supported === true &&
      searchCandidateIds?.newCars?.supported === true;
    const skipSearchRegex =
      hasSearchText && query.exactSearch !== true && allSearchCandidateSetsSupported;
    const hasNoSearchHits =
      skipSearchRegex &&
      (searchCandidateIds?.legacy?.ids.length ?? 0) === 0 &&
      (searchCandidateIds?.used?.ids.length ?? 0) === 0 &&
      (searchCandidateIds?.newCars?.ids.length ?? 0) === 0;
    if (hasNoSearchHits) {
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

    if (query.fields === "modelYears") {
      const modelYearFilter = buildFilter({
        ...query,
        tag1: undefined,
        tag2: undefined,
        carModelYear: undefined,
      }, { skipSearchRegex });

      const yearRows = await legacyCollection
        .aggregate([
          ...buildCombinedYallaPipeline(searchCandidateIds ?? undefined),
          { $match: modelYearFilter },
          { $match: { carModelYear: { $ne: null } } },
          { $group: { _id: "$carModelYear" } },
          { $sort: { _id: -1 } },
        ])
        .toArray();

      const years = yearRows
        .map((row) => toNumber(row?._id))
        .filter((value): value is number => value !== null);
      const items = buildYearOnlyItems(buildDescendingYearRange(years));

      return {
        items,
        total: items.length,
        page: 1,
        limit: items.length || 1,
      };
    }

    const countMode = query.countMode === "none" ? "none" : "exact";
    const totalPromise =
      countMode === "none"
        ? null
        : getOrSetRuntimeCacheStaleWhileRevalidate(
            `yalla:count:${JSON.stringify(buildCountSignature(query))}`,
            COUNT_CACHE_TTL_MS,
            COUNT_CACHE_STALE_TTL_MS,
            async () => {
              if (isUnfilteredYallaQuery(query)) {
                const [legacyCount, usedCount, newCarsCount] = await Promise.all([
                  legacyCollection.estimatedDocumentCount(),
                  usedCollection.estimatedDocumentCount(),
                  newCarsCollection.estimatedDocumentCount(),
                ]);
                return legacyCount + usedCount + newCarsCount;
              }

              const [countRow] = await legacyCollection
                .aggregate(
                  buildYallaListPipeline(query, 1, 1, "count", searchCandidateIds, skipSearchRegex)
                )
                .toArray();
              return toNumber((countRow as { count?: unknown } | undefined)?.count) ?? 0;
            }
          );

    if (isFastDateOnlyYallaQuery(query)) {
      const skip = (page - 1) * limit;
      const candidateLimit = skip + limit + (countMode === "none" ? 1 : 0);
      if (candidateLimit <= FAST_PATH_MAX_CANDIDATES) {
        const sortDirection: 1 | -1 = query.sort === "oldest" ? 1 : -1;
        const isOptionsMode = query.fields === "options";

        const [legacyCandidates, usedCandidates, newCarsCandidates] = await Promise.all([
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
          newCarsCollection
            .find({}, { projection: FAST_YALLA_CANDIDATE_PROJECTION })
            .sort({ scrapedAt: sortDirection })
            .limit(candidateLimit)
            .toArray(),
        ]);

        const mergedCandidates = [
          ...legacyCandidates.map((doc) => ({
            id: doc._id,
            source: "legacy" as const,
            postDate: getYallaPostDateMs(doc as Record<string, any>),
          })),
          ...usedCandidates.map((doc) => ({
            id: doc._id,
            source: "used" as const,
            postDate: getYallaPostDateMs(doc as Record<string, any>),
          })),
          ...newCarsCandidates.map((doc) => ({
            id: doc._id,
            source: "newcars" as const,
            postDate: getYallaPostDateMs(doc as Record<string, any>),
          })),
        ].sort((a, b) => {
          const dateCompare =
            sortDirection === 1
              ? (a.postDate ?? 0) - (b.postDate ?? 0)
              : (b.postDate ?? 0) - (a.postDate ?? 0);
          if (dateCompare !== 0) return dateCompare;
          return `${a.source}:${String(a.id ?? "")}`.localeCompare(
            `${b.source}:${String(b.id ?? "")}`
          );
        });

        const candidatePageSlice = mergedCandidates.slice(
          skip,
          skip + limit + (countMode === "none" ? 1 : 0)
        );
        const hasNext = countMode === "none" ? candidatePageSlice.length > limit : undefined;
        const pageCandidates =
          countMode === "none" ? candidatePageSlice.slice(0, limit) : candidatePageSlice;
        const legacyIds = pageCandidates
          .filter((item) => item.source === "legacy")
          .map((item) => item.id);
        const usedIds = pageCandidates
          .filter((item) => item.source === "used")
          .map((item) => item.id);
        const newCarsIds = pageCandidates
          .filter((item) => item.source === "newcars")
          .map((item) => item.id);

        const [legacyRows, usedRows, newCarsRows] = await Promise.all([
          legacyIds.length > 0
            ? legacyCollection
                .find(
                  { _id: { $in: legacyIds } } as Filter<YallaMotorDoc>,
                  { projection: FAST_YALLA_PROJECTION }
                )
                .toArray()
            : Promise.resolve([]),
          usedIds.length > 0
            ? usedCollection
                .find(
                  { _id: { $in: usedIds } } as Filter<YallaMotorDoc>,
                  { projection: FAST_YALLA_PROJECTION }
                )
                .toArray()
            : Promise.resolve([]),
          newCarsIds.length > 0
            ? newCarsCollection
                .find(
                  { _id: { $in: newCarsIds } } as Filter<YallaMotorDoc>,
                  { projection: FAST_YALLA_PROJECTION }
                )
                .toArray()
            : Promise.resolve([]),
        ]);
        const total = totalPromise ? await totalPromise : -1;

        const legacyMap = new Map(
          legacyRows.map((doc) => [String((doc as Record<string, any>)._id), doc])
        );
        const usedMap = new Map(
          usedRows.map((doc) => [String((doc as Record<string, any>)._id), doc])
        );
        const newCarsMap = new Map(
          newCarsRows.map((doc) => [String((doc as Record<string, any>)._id), doc])
        );

        const items = pageCandidates
          .map((candidate) => {
            const key = String(candidate.id ?? "");
            const doc = (() => {
              if (candidate.source === "legacy") return legacyMap.get(key);
              if (candidate.source === "used") return usedMap.get(key);
              return newCarsMap.get(key);
            })();
            if (!doc) return null;
            return normalizeFastYallaListItem(doc as Record<string, any>, isOptionsMode);
          })
          .filter(Boolean) as Array<Record<string, any>>;

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
      .aggregate(
        buildYallaListPipeline(query, page, fetchLimit, "items", searchCandidateIds, skipSearchRegex)
      )
      .toArray();
    const hasNext = countMode === "none" ? rawItems.length > limit : undefined;
    const pageItems = countMode === "none" ? rawItems.slice(0, limit) : rawItems;
    const items = pageItems.map((item: any) => ({
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
    }
  );
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePriceCompareFromUsedDoc(doc: Record<string, any>) {
  const priceComparison = isRecord(doc.priceComparison) ? doc.priceComparison : null;
  if (!priceComparison) return null;

  const min = priceComparison.marketMinText ?? priceComparison.marketMin ?? null;
  const max = priceComparison.marketMaxText ?? priceComparison.marketMax ?? null;
  const current = priceComparison.markerPriceText ?? priceComparison.markerPrice ?? null;

  if (min === null && max === null && current === null) {
    return null;
  }

  return { min, max, current };
}

function normalizeYallaDetailDoc(doc: YallaMotorDoc) {
  const data = doc as Record<string, any>;
  if (isRecord(data.detail)) {
    return doc;
  }

  const breadcrumb = Array.isArray(data.breadcrumbs) ? data.breadcrumbs : [];
  const images = Array.isArray(data.images) ? data.images : [];
  const features = Array.isArray(data.features) ? data.features : [];
  const highlights =
    isRecord(data.highlights) && Object.keys(data.highlights).length > 0
      ? data.highlights
      : null;
  const normalizedPriceCompare = normalizePriceCompareFromUsedDoc(data);

  return {
    ...data,
    cardTitle: data.cardTitle ?? data.title ?? "Untitled",
    cardPriceText: data.cardPriceText ?? data.price ?? data.priceText ?? data.priceNumber ?? null,
    fetchedAt:
      data.fetchedAt ??
      data.scrapedAt ??
      data.detailScrapedAt ??
      data.updatedAt ??
      data.createdAt ??
      null,
    detail: {
      url: data.url ?? "",
      breadcrumb,
      images,
      importantSpecs: highlights ?? {},
      features,
      description: data.description ?? data.descriptionText ?? data.descriptionHtml ?? "",
      priceCompare: normalizedPriceCompare,
    },
    source: data.source ?? "yallamotor",
  };
}

function buildYallaIdFilters(id: string): Filter<YallaMotorDoc>[] {
  const filters: Filter<YallaMotorDoc>[] = [
    { _id: id as any },
    { adId: id },
    { url: id },
    { "detail.url": id },
  ];

  if (ObjectId.isValid(id)) {
    filters.push({ _id: new ObjectId(id) } as unknown as Filter<YallaMotorDoc>);
  }

  return filters;
}

async function findYallaDoc(collection: Collection<YallaMotorDoc>, id: string) {
  const filters = buildYallaIdFilters(id);
  return collection.findOne({ $or: filters });
}

export async function getYallaMotorById(id: string) {
  return getOrSetRuntimeCache(`yalla:detail:${id}`, DETAIL_CACHE_TTL_MS, async () => {
    const db = await getMongoDb();
    const legacyCollection = getYallaMotorCollection(db);
    const usedCollection = getYallaUsedCollection(db);
    const newCarsCollection = getYallaNewCarsCollection(db);

    const [legacyDoc, usedDoc, newCarDoc] = await Promise.all([
      findYallaDoc(legacyCollection, id),
      findYallaDoc(usedCollection, id),
      findYallaDoc(newCarsCollection, id),
    ]);

    if (legacyDoc) return legacyDoc;
    if (usedDoc) return normalizeYallaDetailDoc(usedDoc);
    if (newCarDoc) return normalizeYallaDetailDoc(newCarDoc);
    return null;
  });
}

