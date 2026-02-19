import { buildVehicleAliases } from "./vehicle-name-match";

type BuildSmartSearchTermGroupsOptions = {
  exact?: boolean;
  maxTerms?: number;
  maxAliasesPerTerm?: number;
};

type BuildSmartTextSearchQueryOptions = BuildSmartSearchTermGroupsOptions & {
  maxOutputTerms?: number;
};

const DEFAULT_MAX_TERMS = 6;
const DEFAULT_MAX_ALIASES_PER_TERM = 12;
const DEFAULT_MAX_TEXT_OUTPUT_TERMS = 18;
const SEARCH_TOKEN_SPLIT_REGEX = /[\s,.;:!?()[\]{}"'`/\\|@#$%^&*+=~<>\u061F\u060C]+/g;
const ARABIC_CHAR_REGEX = /[\u0621-\u064A]/;
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_WEAK_CHAR_SET = new Set([
  "\u0627", // alif
  "\u0648", // waw
  "\u064A", // ya
  "\u0649", // alif maqsura
  "\u0647", // ha
  "\u0629", // ta marbuta
  "\u0621", // hamza
  "\u0624", // waw hamza
  "\u0626", // ya hamza
]);
const SEARCH_STOP_WORDS = new Set<string>([
  "a",
  "an",
  "and",
  "car",
  "for",
  "new",
  "or",
  "sale",
  "the",
  "used",
  "with",
  "without",
  "to",
  "from",
  "\u0641\u064a",
  "\u0645\u0639",
  "\u0627\u0644",
  "\u0648",
  "\u0627\u0648",
  "\u0623\u0648",
  "\u0644\u0644\u0628\u064a\u0639",
  "\u0645\u0628\u0627\u0639",
  "\u0648\u0643\u0627\u0644\u0629",
  "\u0648\u0643\u0627\u0644\u0647",
  "\u0633\u064a\u0627\u0631\u0629",
  "\u0633\u064a\u0627\u0631\u0647",
  "\u0633\u064a\u0627\u0631\u0627\u062a",
]);

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeArabicSearchToken(value: string) {
  return value
    .toLowerCase()
    .replace(ARABIC_DIACRITICS_REGEX, "")
    .replace(/\u0640/g, "")
    .replace(/[\u0660-\u0669]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x0660)
    )
    .replace(/[\u06F0-\u06F9]/g, (digit) =>
      String(digit.charCodeAt(0) - 0x06f0)
    )
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextSearchToken(value: string) {
  return normalizeArabicSearchToken(value)
    .replace(/[^a-z0-9\u0621-\u064A\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toArabicCharClass(char: string) {
  if (char === "\u0627") return "[\u0627\u0623\u0625\u0622\u0671]";
  if (char === "\u064A") return "[\u064A\u0649\u0626]";
  if (char === "\u0648") return "[\u0648\u0624]";
  if (char === "\u0647") return "[\u0647\u0629]";
  if (char === "\u0621") return "[\u0621\u0626\u0624]";
  return escapeRegex(char);
}

function buildArabicLoosePattern(value: string) {
  const normalized = normalizeArabicSearchToken(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || !ARABIC_CHAR_REGEX.test(normalized)) return null;

  const compactChars = normalized.replace(/\s+/g, "").split("");
  if (compactChars.length < 3) {
    return escapeRegex(normalized);
  }

  const skeletonChars = compactChars.filter((char) => !ARABIC_WEAK_CHAR_SET.has(char));

  const composePattern = (chars: string[]) => {
    return chars
      .map((char, index) => {
        const charPattern = ARABIC_CHAR_REGEX.test(char)
          ? toArabicCharClass(char)
          : escapeRegex(char);
        const joinPattern =
          index < chars.length - 1
            ? "(?:[\\s\\-_]*[\u0627\u0623\u0625\u0622\u0671\u0648\u064A\u0649\u0626\u0624\u0647\u0629]?)"
            : "";
        return `${charPattern}${joinPattern}`;
      })
      .join("");
  };

  const variantPatterns = [composePattern(compactChars)];
  if (
    skeletonChars.length >= 3 &&
    skeletonChars.length < compactChars.length &&
    skeletonChars.some((char) => ARABIC_CHAR_REGEX.test(char))
  ) {
    variantPatterns.push(composePattern(skeletonChars));
  }

  const uniquePatterns = Array.from(
    new Set(variantPatterns.filter((pattern) => pattern.length > 0))
  );
  if (!uniquePatterns.length) return null;
  if (uniquePatterns.length === 1) {
    return uniquePatterns[0];
  }
  return `(?:${uniquePatterns.join("|")})`;
}

export function buildSearchRegex(
  value: string,
  options?: { exact?: boolean; fuzzyArabic?: boolean }
) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return /.^/i;
  }

  if (options?.exact) {
    return new RegExp(`^${escapeRegex(raw)}$`, "i");
  }

  const shouldUseArabicFuzzy = options?.fuzzyArabic === true && ARABIC_CHAR_REGEX.test(raw);
  if (shouldUseArabicFuzzy) {
    const loosePattern = buildArabicLoosePattern(raw);
    if (loosePattern) {
      return new RegExp(loosePattern, "i");
    }
  }

  return new RegExp(escapeRegex(raw), "i");
}

function isNumericToken(token: string) {
  return /^[0-9]+$/.test(token);
}

function dedupeNormalized(values: string[], limit: number) {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }

  return output;
}

function isUsefulToken(token: string) {
  const normalized = normalizeToken(token);
  if (!normalized) return false;
  if (isNumericToken(normalized)) return true;
  if (normalized.length <= 2) return false;
  return !SEARCH_STOP_WORDS.has(normalized);
}

function tokenizeSearch(value: string) {
  return value
    .split(SEARCH_TOKEN_SPLIT_REGEX)
    .map((token) => token.trim())
    .filter(Boolean);
}

function expandTokenAliases(token: string, maxAliases: number) {
  const raw = token.trim();
  if (!raw) return [];
  const aliases = [raw, ...buildVehicleAliases(raw)];
  return dedupeNormalized(aliases, maxAliases);
}

export function buildSmartSearchTermGroups(
  search?: string | null,
  options: BuildSmartSearchTermGroupsOptions = {}
) {
  const input = String(search ?? "").trim();
  if (!input) return [] as string[][];

  const exact = options.exact === true;
  const maxTerms = Math.max(1, options.maxTerms ?? DEFAULT_MAX_TERMS);
  const maxAliasesPerTerm = Math.max(
    1,
    options.maxAliasesPerTerm ?? DEFAULT_MAX_ALIASES_PER_TERM
  );

  if (exact) {
    const exactAliases = expandTokenAliases(input, maxAliasesPerTerm);
    return exactAliases.length > 0 ? [exactAliases] : [[input]];
  }

  const rawTokens = tokenizeSearch(input);
  const usefulTokens = rawTokens.filter((token) => isUsefulToken(token));
  const selectedTokens = usefulTokens.length > 0 ? usefulTokens : rawTokens;
  const selectedUniqueTokens = dedupeNormalized(selectedTokens, maxTerms);

  const groups = selectedUniqueTokens
    .map((token) => expandTokenAliases(token, maxAliasesPerTerm))
    .filter((group) => group.length > 0);

  if (groups.length === 0) {
    const fallback = expandTokenAliases(input, maxAliasesPerTerm);
    return fallback.length > 0 ? [fallback] : [[input]];
  }

  if (selectedUniqueTokens.length <= 1 && rawTokens.length > 1) {
    const compositeGroup = expandTokenAliases(input, maxAliasesPerTerm);
    if (compositeGroup.length > 0) {
      groups.unshift(compositeGroup);
    }
  }

  return groups;
}

export function buildSmartTextSearchQuery(
  search?: string | null,
  options: BuildSmartTextSearchQueryOptions = {}
) {
  const input = String(search ?? "").trim();
  if (!input) return "";

  const exact = options.exact === true;
  const maxOutputTerms = Math.max(1, options.maxOutputTerms ?? DEFAULT_MAX_TEXT_OUTPUT_TERMS);

  if (exact) {
    return normalizeTextSearchToken(input);
  }

  const groups = buildSmartSearchTermGroups(input, {
    exact: false,
    maxTerms: options.maxTerms,
    maxAliasesPerTerm: options.maxAliasesPerTerm,
  });

  const rankedTerms: string[] = [];
  const normalizedInput = normalizeTextSearchToken(input);
  if (normalizedInput) {
    rankedTerms.push(normalizedInput);
  }

  for (const group of groups) {
    for (const term of group) {
      const normalized = normalizeTextSearchToken(term);
      if (!normalized) continue;
      if (normalized.length <= 2) continue;
      rankedTerms.push(normalized);
    }
  }

  const uniqueTerms = dedupeNormalized(rankedTerms, maxOutputTerms);
  if (uniqueTerms.length === 0) {
    return normalizedInput;
  }

  return uniqueTerms.join(" ");
}

