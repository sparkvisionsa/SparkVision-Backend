import { listHarajScrapes, type HarajScrapeListQuery } from "./harajScrapeController";
import { listYallaMotors } from "./yallaMotorController";
import { listSyarahs } from "./syarahController";
import { getOrSetRuntimeCacheStaleWhileRevalidate } from "../lib/runtime-cache";
import { buildVehicleAliases, toVehicleCanonicalKey } from "@/lib/vehicle-name-match";

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
  compact: string;
  canonical: string;
  tokens: string[];
  source: CarsSourceKey;
  weight: number;
};

type SuggestionQueryProfile = {
  normalizedVariants: string[];
  compactVariants: string[];
  canonicalVariants: string[];
  normalizedQueryTokens: string[];
  queryCanonicalTokens: string[];
  queryYearTokens: string[];
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
const SUGGESTIONS_SOURCE_FETCH_LIMIT = 120;
const SUGGESTIONS_FALLBACK_SOURCE_FETCH_LIMIT = 120;
const SUGGESTIONS_CACHE_TTL_MS = 30_000;
const SUGGESTIONS_CACHE_STALE_TTL_MS = 180_000;
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const SOURCE_KEYS: CarsSourceKey[] = ["haraj", "yallamotor", "syarah"];
const SUGGESTIONS_MIN_QUERY_LENGTH = 2;
const SUGGESTIONS_MAX_SEARCH_TERMS = 8;
const SUGGESTIONS_MAX_RAW_CANDIDATES_MULTIPLIER = 18;
const SUGGESTION_MAX_FUZZY_DISTANCE = 3;
const SUGGESTION_MAX_TOKEN_DISTANCE = 2;
const SUGGESTION_MIN_TOKEN_SIMILARITY = 0.72;
const SUGGESTION_STRONG_TOKEN_SIMILARITY = 0.9;

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
  const normalizedRaw = normalizeSuggestionText(rawQuery);
  const normalizedTokens = normalizedRaw
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const phraseCandidates: string[] = [];
  for (let size = Math.min(3, normalizedTokens.length); size >= 2; size -= 1) {
    for (let start = 0; start + size <= normalizedTokens.length; start += 1) {
      phraseCandidates.push(normalizedTokens.slice(start, start + size).join(" "));
    }
  }

  const canonicalRaw = toVehicleCanonicalKey(rawQuery);
  const candidates = [
    rawQuery,
    canonicalRaw,
    ...buildVehicleAliases(rawQuery),
    ...phraseCandidates,
    ...normalizedTokens,
    ...(normalizedTokens.length > 1 ? [normalizedTokens.slice(0, 2).join(" ")] : []),
  ];

  const unique = new Set<string>();
  const terms: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const normalized = normalizeSuggestionText(trimmed);
    if (!normalized || unique.has(normalized)) continue;
    unique.add(normalized);
    terms.push(trimmed);
    if (terms.length >= SUGGESTIONS_MAX_SEARCH_TERMS) break;
  }

  return terms.length > 0 ? terms : [rawQuery.trim()];
}

function buildSuggestionListQuery(
  query: CarsSearchSuggestionsQuery,
  search?: string,
  fetchLimit = SUGGESTIONS_SOURCE_FETCH_LIMIT
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

  const normalizedSearch = typeof search === "string" ? search.trim() : "";

  return {
    ...rest,
    ...(normalizedSearch ? { search: normalizedSearch } : {}),
    exactSearch: false,
    page: 1,
    limit: fetchLimit,
    sort: "newest",
    fields: "default",
    countMode: "none",
  };
}

function toCompactSuggestionText(value: string) {
  return normalizeSuggestionText(value).replace(/\s+/g, "");
}

function boundedLevenshteinDistance(a: string, b: string, maxDistance = SUGGESTION_MAX_FUZZY_DISTANCE) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      if (current[j] < rowMin) {
        rowMin = current[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function toLooseSuggestionToken(value: string) {
  return normalizeSuggestionText(value)
    .replace(/[\u0627\u0648\u064a\u0649\u0647\u0629\u0621\u0624\u0626]/g, "")
    .replace(/[aeiouy]/g, "")
    .replace(/\s+/g, "");
}

function resolveTokenMaxDistance(a: string, b: string) {
  const minLength = Math.min(a.length, b.length);
  if (minLength >= 7) return SUGGESTION_MAX_TOKEN_DISTANCE;
  return 1;
}

function scoreSuggestionTokenSimilarity(queryToken: string, candidateToken: string) {
  const normalizedQuery = normalizeSuggestionText(queryToken);
  const normalizedCandidate = normalizeSuggestionText(candidateToken);
  if (!normalizedQuery || !normalizedCandidate) return 0;

  if (normalizedQuery === normalizedCandidate) return 1;

  if (
    normalizedCandidate.startsWith(normalizedQuery) ||
    normalizedQuery.startsWith(normalizedCandidate)
  ) {
    const ratio =
      Math.min(normalizedQuery.length, normalizedCandidate.length) /
      Math.max(normalizedQuery.length, normalizedCandidate.length);
    return Math.max(0.84, ratio);
  }

  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    const ratio =
      Math.min(normalizedQuery.length, normalizedCandidate.length) /
      Math.max(normalizedQuery.length, normalizedCandidate.length);
    return Math.max(0.76, ratio * 0.95);
  }

  const looseQuery = toLooseSuggestionToken(normalizedQuery);
  const looseCandidate = toLooseSuggestionToken(normalizedCandidate);
  if (
    looseQuery &&
    looseCandidate &&
    looseQuery.length >= 2 &&
    looseCandidate.length >= 2 &&
    looseQuery === looseCandidate
  ) {
    return 0.93;
  }

  const maxDistance = resolveTokenMaxDistance(normalizedQuery, normalizedCandidate);
  const distance = boundedLevenshteinDistance(
    normalizedQuery,
    normalizedCandidate,
    maxDistance
  );
  if (distance > maxDistance) return 0;

  const ratio = 1 - distance / Math.max(normalizedQuery.length, normalizedCandidate.length);
  return Math.max(0.7, ratio);
}

function buildSuggestionQueryProfile(queryText: string): SuggestionQueryProfile {
  const variants = buildSuggestionSearchTerms(queryText);
  const normalizedVariants: string[] = [];
  const compactVariants: string[] = [];
  const canonicalVariants: string[] = [];

  for (const variant of variants) {
    const normalized = normalizeSuggestionText(variant);
    if (!normalized) continue;
    normalizedVariants.push(normalized);
    compactVariants.push(normalized.replace(/\s+/g, ""));
    canonicalVariants.push(toCompactSuggestionText(toVehicleCanonicalKey(variant)));
  }

  const normalizedQueryTokens = tokenizeSuggestionText(queryText);
  const queryCanonicalTokens = normalizedQueryTokens.map((token) =>
    toCompactSuggestionText(toVehicleCanonicalKey(token))
  );
  const queryYearTokens = normalizedQueryTokens.filter((token) =>
    /^(19|20)\d{2}$/.test(token)
  );

  return {
    normalizedVariants,
    compactVariants,
    canonicalVariants,
    normalizedQueryTokens,
    queryCanonicalTokens,
    queryYearTokens,
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
  const city = toSuggestionString(item.city);
  const modelYear =
    typeof item.carModelYear === "number" && Number.isFinite(item.carModelYear)
      ? String(Math.trunc(item.carModelYear))
      : toSuggestionString(item.carModelYear);
  const mileage =
    typeof item.mileage === "number" && Number.isFinite(item.mileage)
      ? `${Math.trunc(item.mileage)} km`
      : toSuggestionString(item.mileage);
  const priceText = toSuggestionString(item.priceFormatted);
  const suggestions: SuggestionCandidate[] = [];

  if (title && title.toLowerCase() !== "untitled") {
    suggestions.push({
      label: title,
      normalized: normalizeSuggestionText(title),
      compact: toCompactSuggestionText(title),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(title)),
      tokens: tokenizeSuggestionText(title),
      source,
      weight: 7,
    });
  }
  if (brand) {
    suggestions.push({
      label: brand,
      normalized: normalizeSuggestionText(brand),
      compact: toCompactSuggestionText(brand),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(brand)),
      tokens: tokenizeSuggestionText(brand),
      source,
      weight: 8,
    });
  }
  if (model) {
    suggestions.push({
      label: model,
      normalized: normalizeSuggestionText(model),
      compact: toCompactSuggestionText(model),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(model)),
      tokens: tokenizeSuggestionText(model),
      source,
      weight: 6,
    });
  }
  if (brand && model) {
    const combined = `${brand} ${model}`.trim();
    suggestions.push({
      label: combined,
      normalized: normalizeSuggestionText(combined),
      compact: toCompactSuggestionText(combined),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(combined)),
      tokens: tokenizeSuggestionText(combined),
      source,
      weight: 10,
    });
  }
  if (city) {
    suggestions.push({
      label: city,
      normalized: normalizeSuggestionText(city),
      compact: toCompactSuggestionText(city),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(city)),
      tokens: tokenizeSuggestionText(city),
      source,
      weight: 5,
    });
  }
  if (modelYear) {
    suggestions.push({
      label: modelYear,
      normalized: normalizeSuggestionText(modelYear),
      compact: toCompactSuggestionText(modelYear),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(modelYear)),
      tokens: tokenizeSuggestionText(modelYear),
      source,
      weight: 4,
    });
  }
  if (mileage) {
    suggestions.push({
      label: mileage,
      normalized: normalizeSuggestionText(mileage),
      compact: toCompactSuggestionText(mileage),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(mileage)),
      tokens: tokenizeSuggestionText(mileage),
      source,
      weight: 2,
    });
  }
  if (priceText) {
    suggestions.push({
      label: priceText,
      normalized: normalizeSuggestionText(priceText),
      compact: toCompactSuggestionText(priceText),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(priceText)),
      tokens: tokenizeSuggestionText(priceText),
      source,
      weight: 2,
    });
  }
  if (brand && model && modelYear) {
    const combinedWithYear = `${brand} ${model} ${modelYear}`.trim();
    suggestions.push({
      label: combinedWithYear,
      normalized: normalizeSuggestionText(combinedWithYear),
      compact: toCompactSuggestionText(combinedWithYear),
      canonical: toCompactSuggestionText(toVehicleCanonicalKey(combinedWithYear)),
      tokens: tokenizeSuggestionText(combinedWithYear),
      source,
      weight: 11,
    });
  }

  const normalizedSuggestions: SuggestionCandidate[] = [];
  for (const suggestion of suggestions) {
    if (!suggestion.normalized) continue;
    normalizedSuggestions.push({
      ...suggestion,
      compact: suggestion.compact || suggestion.normalized.replace(/\s+/g, ""),
      canonical:
        suggestion.canonical ||
        toCompactSuggestionText(toVehicleCanonicalKey(suggestion.label)),
      tokens: suggestion.tokens ?? tokenizeSuggestionText(suggestion.label),
    });
  }

  return normalizedSuggestions;
}

async function listSourceItemsForSuggestions(
  source: CarsSourceKey,
  query: HarajScrapeListQuery,
  fetchLimit = SUGGESTIONS_SOURCE_FETCH_LIMIT
) {
  if (source === "haraj") {
    const result = await listHarajScrapes(query, { maxLimit: fetchLimit });
    return result.items as Array<Record<string, any>>;
  }
  if (source === "yallamotor") {
    const result = await listYallaMotors(query, { maxLimit: fetchLimit });
    return result.items as Array<Record<string, any>>;
  }
  const result = await listSyarahs(query, { maxLimit: fetchLimit });
  return result.items as Array<Record<string, any>>;
}

function scoreSuggestionCandidate(
  candidate: SuggestionCandidate,
  profile: SuggestionQueryProfile
) {
  const {
    normalizedVariants,
    compactVariants,
    canonicalVariants,
    normalizedQueryTokens,
    queryCanonicalTokens,
    queryYearTokens,
  } = profile;
  let bestVariantScore = -1;
  for (let index = 0; index < normalizedVariants.length; index += 1) {
    const variant = normalizedVariants[index];
    if (!variant) continue;

    const variantCompact = compactVariants[index] ?? variant.replace(/\s+/g, "");
    const variantCanonical = canonicalVariants[index] ?? variantCompact;

    if (candidate.normalized === variant) {
      bestVariantScore = Math.max(bestVariantScore, 220);
      continue;
    }
    if (candidate.compact === variantCompact) {
      bestVariantScore = Math.max(bestVariantScore, 205);
      continue;
    }
    if (candidate.canonical && variantCanonical && candidate.canonical === variantCanonical) {
      bestVariantScore = Math.max(bestVariantScore, 196);
      continue;
    }
    if (
      candidate.canonical &&
      variantCanonical &&
      (candidate.canonical.includes(variantCanonical) ||
        variantCanonical.includes(candidate.canonical))
    ) {
      bestVariantScore = Math.max(bestVariantScore, 186);
      continue;
    }
    if (candidate.normalized.startsWith(variant)) {
      bestVariantScore = Math.max(bestVariantScore, 178);
      continue;
    }
    if (candidate.compact.startsWith(variantCompact)) {
      bestVariantScore = Math.max(bestVariantScore, 165);
      continue;
    }
    if (candidate.normalized.includes(variant)) {
      bestVariantScore = Math.max(bestVariantScore, 138);
      continue;
    }

    const compactDistance = boundedLevenshteinDistance(
      candidate.compact,
      variantCompact,
      SUGGESTION_MAX_FUZZY_DISTANCE
    );
    if (compactDistance <= SUGGESTION_MAX_FUZZY_DISTANCE) {
      if (compactDistance <= 1) {
        bestVariantScore = Math.max(bestVariantScore, 130);
      } else if (compactDistance === 2) {
        bestVariantScore = Math.max(bestVariantScore, 112);
      } else {
        bestVariantScore = Math.max(bestVariantScore, 94);
      }
    }

    if (candidate.canonical && variantCanonical) {
      const canonicalDistance = boundedLevenshteinDistance(
        candidate.canonical,
        variantCanonical,
        2
      );
      if (canonicalDistance <= 1) {
        bestVariantScore = Math.max(bestVariantScore, 124);
      } else if (canonicalDistance === 2) {
        bestVariantScore = Math.max(bestVariantScore, 104);
      }
    }
  }

  const tokenMatchScores = normalizedQueryTokens.map((token, index) => {
    if (!token) return 0;

    let bestTokenScore = candidate.normalized.includes(token) ? 0.94 : 0;
    for (const candidateToken of candidate.tokens) {
      if (!candidateToken) continue;
      const score = scoreSuggestionTokenSimilarity(token, candidateToken);
      if (score > bestTokenScore) {
        bestTokenScore = score;
      }
      if (bestTokenScore >= 0.995) {
        break;
      }
    }

    const canonicalToken = queryCanonicalTokens[index];
    if (canonicalToken && candidate.canonical) {
      if (candidate.canonical === canonicalToken) {
        bestTokenScore = Math.max(bestTokenScore, 0.98);
      } else if (
        candidate.canonical.includes(canonicalToken) ||
        canonicalToken.includes(candidate.canonical)
      ) {
        bestTokenScore = Math.max(bestTokenScore, 0.9);
      }
    }

    return bestTokenScore;
  });

  const matchedTokenCount = tokenMatchScores.filter(
    (score) => score >= SUGGESTION_MIN_TOKEN_SIMILARITY
  ).length;
  const strongMatchedTokenCount = tokenMatchScores.filter(
    (score) => score >= SUGGESTION_STRONG_TOKEN_SIMILARITY
  ).length;
  const tokenSimilarityCoverage =
    normalizedQueryTokens.length > 0
      ? tokenMatchScores.reduce((sum, score) => sum + score, 0) / normalizedQueryTokens.length
      : 0;

  const queryTokenCoverage =
    normalizedQueryTokens.length > 0
      ? matchedTokenCount / normalizedQueryTokens.length
      : 0;
  const candidateTokenCoverage =
    candidate.tokens.length > 0
      ? matchedTokenCount / candidate.tokens.length
      : 0;
  const candidateYearTokens = candidate.tokens.filter((token) => /^(19|20)\d{2}$/.test(token));
  const matchedYearCount = queryYearTokens.filter((yearToken) =>
    candidateYearTokens.includes(yearToken)
  ).length;

  if (
    bestVariantScore < 0 &&
    matchedTokenCount === 0 &&
    tokenSimilarityCoverage < 0.45
  ) {
    return -1;
  }

  const fullTokenBonus =
    normalizedQueryTokens.length > 0 && strongMatchedTokenCount === normalizedQueryTokens.length
      ? 44
      : matchedTokenCount * 12;
  const tokenCoverageBonus =
    Math.round(queryTokenCoverage * 24) +
    Math.round(candidateTokenCoverage * 12) +
    Math.round(tokenSimilarityCoverage * 40);
  const orderedTokenBonus =
    normalizedQueryTokens.length > 1 &&
    candidate.normalized.includes(normalizedQueryTokens.join(" "))
      ? 22
      : 0;
  const yearBonus = matchedYearCount > 0 ? matchedYearCount * 14 : 0;
  const canonicalBonus =
    candidate.canonical &&
    queryCanonicalTokens.some((canonicalToken) =>
      canonicalToken ? candidate.canonical.includes(canonicalToken) : false
    )
      ? 12
      : 0;
  const lengthDelta = Math.abs(candidate.normalized.length - (normalizedVariants[0]?.length ?? 0));
  const compactnessBonus = Math.max(0, 15 - Math.min(lengthDelta, 15));

  return (
    (bestVariantScore < 0 ? 46 : bestVariantScore) +
    fullTokenBonus +
    tokenCoverageBonus +
    orderedTokenBonus +
    yearBonus +
    canonicalBonus +
    compactnessBonus +
    candidate.weight
  );
}

function rankSuggestionCandidates(
  candidates: SuggestionCandidate[],
  queryText: string,
  limit: number
) {
  const profile = buildSuggestionQueryProfile(queryText);
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
    const score = scoreSuggestionCandidate(candidate, profile);
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
      const minExpectedCandidates = limit * 3;
      const maxRawCandidates = limit * SUGGESTIONS_MAX_RAW_CANDIDATES_MULTIPLIER;

      for (const searchTerm of searchTerms) {
        const listQuery = buildSuggestionListQuery(
          query,
          searchTerm,
          SUGGESTIONS_SOURCE_FETCH_LIMIT
        );
        const sourceRows = await Promise.all(
          sources.map(async (source) => {
            const items = await listSourceItemsForSuggestions(
              source,
              listQuery,
              SUGGESTIONS_SOURCE_FETCH_LIMIT
            );
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

        if (allCandidates.length >= maxRawCandidates || allCandidates.length >= minExpectedCandidates) {
          break;
        }
      }

      if (allCandidates.length < limit) {
        const fallbackQuery = buildSuggestionListQuery(
          query,
          undefined,
          SUGGESTIONS_FALLBACK_SOURCE_FETCH_LIMIT
        );
        const fallbackSourceRows = await Promise.all(
          sources.map(async (source) => {
            const items = await listSourceItemsForSuggestions(
              source,
              fallbackQuery,
              SUGGESTIONS_FALLBACK_SOURCE_FETCH_LIMIT
            );
            return {
              source,
              items,
            };
          })
        );

        for (const sourceRow of fallbackSourceRows) {
          for (const item of sourceRow.items) {
            allCandidates.push(...extractSuggestionCandidates(sourceRow.source, item));
            if (allCandidates.length >= maxRawCandidates) break;
          }
          if (allCandidates.length >= maxRawCandidates) break;
        }
      }

      return {
        items: rankSuggestionCandidates(allCandidates, rawQuery, limit),
      };
    }
  );
}
