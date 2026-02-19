const ARABIC_DIACRITICS_REGEX = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

const ARABIC_DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const ARABIC_CHAR_TO_LATIN: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "a",
  آ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ة: "h",
  ى: "a",
  ؤ: "w",
  ئ: "y",
};

const ARABIC_SPELLED_LETTER_TO_LATIN: Record<string, string> = {
  سي: "c",
  اس: "s",
  إكس: "x",
  اكس: "x",
  أكس: "x",
  جي: "g",
  بي: "b",
  دي: "d",
  تي: "t",
  في: "v",
  اف: "f",
  كي: "k",
  كيو: "q",
  ال: "l",
  إل: "l",
  ام: "m",
  إم: "m",
  ان: "n",
  إن: "n",
  ار: "r",
  آر: "r",
  واي: "y",
  دبليو: "w",
  اتش: "h",
  زد: "z",
  او: "o",
  يو: "u",
};

const LATIN_TO_ARABIC_SPELLED_LETTER: Record<string, string> = {
  a: "اي",
  b: "بي",
  c: "سي",
  d: "دي",
  e: "اي",
  f: "اف",
  g: "جي",
  h: "اتش",
  i: "اي",
  j: "جاي",
  k: "كي",
  l: "ال",
  m: "ام",
  n: "ان",
  o: "او",
  p: "بي",
  q: "كيو",
  r: "ار",
  s: "اس",
  t: "تي",
  u: "يو",
  v: "في",
  w: "دبليو",
  x: "اكس",
  y: "واي",
  z: "زد",
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
};

const KNOWN_VEHICLE_ALIAS_GROUPS: string[][] = [
  ["toyota", "تويوتا"],
  ["nissan", "نيسان"],
  ["hyundai", "هيونداي", "هونداي"],
  ["kia", "كيا"],
  ["ford", "فورد"],
  ["chevrolet", "chevy", "شفروليه", "شيفروليه", "شفر"],
  ["gmc", "جمس", "جي ام سي"],
  ["lexus", "لكزس"],
  ["mercedes", "mercedes benz", "benz", "مرسيدس", "مرسيدس بنز", "بنز"],
  ["bmw", "بي ام دبليو", "بى ام دبليو"],
  ["audi", "اودي", "أودي"],
  ["mazda", "مازدا"],
  ["honda", "هوندا"],
  ["mitsubishi", "ميتسوبيشي"],
  ["dodge", "دودج"],
  ["jeep", "جيب"],
  ["isuzu", "ايسوزو", "إيسوزو"],
  ["land cruiser", "landcruiser", "لاند كروزر", "لاندكروزر", "gxr", "جي اكس ار", "vxr", "في اكس ار"],
  ["prado", "برادو"],
  ["camry", "كامري"],
  ["corolla", "كورولا"],
  ["yaris", "يارس", "ياريس"],
  ["hilux", "هايلكس", "هايلوكس"],
  ["rav4", "rav 4", "راف4", "راف فور"],
  ["fortuner", "فورتشنر", "فورشنر"],
  ["sonata", "سوناتا"],
  ["elantra", "النترا", "إلنترا"],
  ["accent", "اكسنت", "أكسنت"],
  ["tucson", "توسان"],
  ["patrol", "باترول"],
  ["sunny", "صني", "سني"],
  ["altima", "التيما", "ألتيما"],
  ["maxima", "ماكسيما", "مكسيما"],
  ["accord", "اكورد", "أكورد"],
  ["civic", "سيفيك", "سيفك"],
  ["crv", "cr v", "cr-v", "سي ار في", "سي آر في"],
  ["tahoe", "تاهو"],
  ["suburban", "سوبربان"],
  ["yukon", "يوكن"],
  ["silverado", "سلفرادو", "سيلفرادو"],
  ["sierra", "سييرا"],
];

function replaceArabicDigits(value: string) {
  return value.replace(/[٠-٩]/g, (digit) => ARABIC_DIGIT_MAP[digit] ?? digit);
}

function normalizeArabicLetters(value: string) {
  return value
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
}

function normalizeText(value: string) {
  return normalizeArabicLetters(replaceArabicDigits(value.toLowerCase()))
    .replace(ARABIC_DIACRITICS_REGEX, "")
    .replace(/ـ/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAlias(value: string) {
  return normalizeText(value).replace(/[^a-z0-9\u0621-\u064A]+/gi, "");
}

function transliterateArabicToLatin(value: string) {
  const normalized = normalizeText(value);
  let output = "";
  for (const char of normalized) {
    if (/[a-z0-9]/.test(char)) {
      output += char;
      continue;
    }
    output += ARABIC_CHAR_TO_LATIN[char] ?? "";
  }
  return output.replace(/[^a-z0-9]+/g, "");
}

function arabicSpelledLettersToLatin(value: string) {
  const normalized = normalizeText(value);
  const keys = Object.keys(ARABIC_SPELLED_LETTER_TO_LATIN).sort(
    (a, b) => b.length - a.length
  );
  let converted = normalized;
  for (const key of keys) {
    const regex = new RegExp(key, "g");
    converted = converted.replace(regex, ARABIC_SPELLED_LETTER_TO_LATIN[key]);
  }
  return converted.replace(/[^a-z0-9]+/g, "");
}

function latinToArabicSpelledLetters(value: string) {
  const compact = normalizeText(value).replace(/[^a-z0-9]+/g, "");
  if (!compact) return "";
  return compact
    .split("")
    .map((char) => LATIN_TO_ARABIC_SPELLED_LETTER[char] ?? char)
    .join(" ");
}

function latinSkeleton(value: string) {
  return value.replace(/[aeiouyw]/g, "");
}

function addKnownVehicleAliases(aliasSet: Set<string>, addAlias: (value: string) => void) {
  const existing = Array.from(aliasSet);
  if (existing.length === 0) return;

  const compactExisting = new Set(
    existing
      .map((item) => normalizeText(item).replace(/\s+/g, ""))
      .filter(Boolean)
  );

  for (const group of KNOWN_VEHICLE_ALIAS_GROUPS) {
    const compactGroupAliases = new Set(
      group
        .map((alias) => normalizeText(alias).replace(/\s+/g, ""))
        .filter(Boolean)
    );
    const hasMatch = Array.from(compactGroupAliases).some((alias) =>
      compactExisting.has(alias)
    );
    if (!hasMatch) continue;

    for (const alias of group) {
      addAlias(alias);
    }
  }
}

export function buildVehicleAliases(value?: string | null) {
  const input = String(value ?? "").trim();
  if (!input) return [];

  const normalized = normalizeText(input);
  const compact = compactAlias(normalized);
  const hasArabic = /[\u0621-\u064A]/.test(normalized);
  const hasLatin = /[a-z]/.test(normalized);

  const aliases = new Set<string>();
  const addAlias = (candidate: string) => {
    const clean = normalizeText(candidate);
    if (!clean) return;
    aliases.add(clean);
    aliases.add(clean.replace(/\s+/g, ""));
  };

  addAlias(normalized);
  addAlias(compact);

  if (hasArabic) {
    addAlias(arabicSpelledLettersToLatin(normalized));
    addAlias(transliterateArabicToLatin(normalized));
  }

  if (hasLatin) {
    const latinCompact = normalized.replace(/[^a-z0-9]+/g, "");
    addAlias(latinCompact);
    addAlias(latinCompact.split("").join(" "));
    addAlias(latinToArabicSpelledLetters(latinCompact));
    addAlias(latinToArabicSpelledLetters(latinCompact).replace(/\s+/g, ""));
  }

  addKnownVehicleAliases(aliases, addAlias);

  return Array.from(aliases).filter(Boolean);
}

export function toVehicleCanonicalKey(value?: string | null) {
  const aliases = buildVehicleAliases(value);
  const latinCandidates = aliases.filter((alias) => /^[a-z0-9]+$/i.test(alias));
  const latinCompact = latinCandidates.sort((a, b) => b.length - a.length)[0];
  if (latinCompact) return latinCompact;
  return aliases[0] ?? normalizeText(String(value ?? ""));
}

function numericSignature(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function isVehicleTextMatch(
  candidate?: string | null,
  query?: string | null
) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) return true;

  const candidateAliases = buildVehicleAliases(candidate);
  if (candidateAliases.length === 0) return false;
  const queryAliases = buildVehicleAliases(normalizedQuery);

  for (const queryAlias of queryAliases) {
    for (const candidateAlias of candidateAliases) {
      if (candidateAlias === queryAlias) {
        return true;
      }

      if (
        /^[a-z0-9]+$/i.test(candidateAlias) &&
        /^[a-z0-9]+$/i.test(queryAlias)
      ) {
        const candidateDigits = numericSignature(candidateAlias);
        const queryDigits = numericSignature(queryAlias);
        if ((candidateDigits || queryDigits) && candidateDigits !== queryDigits) {
          continue;
        }

        const candidateSkeleton = latinSkeleton(candidateAlias);
        const querySkeleton = latinSkeleton(queryAlias);
        if (
          candidateSkeleton.length >= 2 &&
          querySkeleton.length >= 2 &&
          candidateSkeleton === querySkeleton
        ) {
          return true;
        }
      }
    }
  }

  return false;
}
