/**
 * صيغة الرقم المرجعي للمشاريع على مستوى الشركة.
 * الجزء التسلسلي يبدأ من 1 ويتزايد دون إعادة استخدام الأرقام المحذوفة.
 */

export const REFERENCE_VALUE_TYPES = ["numbers", "letters", "mixed"] as const;
export const REFERENCE_PREFIX_KINDS = ["letters", "year", "month", "day"] as const;

export type ReferenceValueType = (typeof REFERENCE_VALUE_TYPES)[number];
export type ReferencePrefixKind = (typeof REFERENCE_PREFIX_KINDS)[number];

export type ReferenceNumberPattern = {
  valueType: ReferenceValueType;
  /** عدد خانات الجزء التسلسلي (بعد البادئة). */
  length: number;
  hasPrefix: boolean;
  /** أنواع البادئة المختارة بالترتيب: حروف ثم سنة ثم شهر ثم يوم. */
  prefixKinds: ReferencePrefixKind[];
  /** أحرف البادئة عندما يكون نوعها حروفاً، مثل NX. */
  prefixLetters: string;
};

export type CompanySerialNumberingSettings = {
  referenceNumber: ReferenceNumberPattern;
};

export const DEFAULT_REFERENCE_NUMBER_PATTERN: ReferenceNumberPattern = {
  valueType: "numbers",
  length: 6,
  hasPrefix: false,
  prefixKinds: ["letters"],
  prefixLetters: "",
};

export const DEFAULT_SERIAL_NUMBERING_SETTINGS: CompanySerialNumberingSettings = {
  referenceNumber: { ...DEFAULT_REFERENCE_NUMBER_PATTERN },
};

const MAX_LENGTH = 12;
const MAX_PREFIX_LETTERS = 8;

function isValueType(value: unknown): value is ReferenceValueType {
  return typeof value === "string" && (REFERENCE_VALUE_TYPES as readonly string[]).includes(value);
}

function isPrefixKind(value: unknown): value is ReferencePrefixKind {
  return typeof value === "string" && (REFERENCE_PREFIX_KINDS as readonly string[]).includes(value);
}

export function sanitizePrefixLetters(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_PREFIX_LETTERS);
}

function uniquePrefixKinds(values: unknown[]): ReferencePrefixKind[] {
  const seen = new Set<ReferencePrefixKind>();
  const ordered: ReferencePrefixKind[] = [];
  for (const kind of REFERENCE_PREFIX_KINDS) {
    if (values.includes(kind) && !seen.has(kind)) {
      seen.add(kind);
      ordered.push(kind);
    }
  }
  return ordered;
}

export function sanitizeReferenceNumberPattern(raw: unknown): ReferenceNumberPattern {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lengthRaw = Number(source.length);
  const length = Number.isFinite(lengthRaw)
    ? Math.min(MAX_LENGTH, Math.max(1, Math.trunc(lengthRaw)))
    : DEFAULT_REFERENCE_NUMBER_PATTERN.length;
  const prefixKindsRaw = source.prefixKinds;
  const prefixKinds = Array.isArray(prefixKindsRaw)
    ? uniquePrefixKinds(prefixKindsRaw)
    : isPrefixKind(source.prefixKind)
      ? [source.prefixKind]
      : [...DEFAULT_REFERENCE_NUMBER_PATTERN.prefixKinds];
  return {
    valueType: isValueType(source.valueType) ? source.valueType : DEFAULT_REFERENCE_NUMBER_PATTERN.valueType,
    length,
    hasPrefix: source.hasPrefix === true,
    prefixKinds,
    prefixLetters: sanitizePrefixLetters(source.prefixLetters),
  };
}

export function resolveSerialNumberingSettings(raw: unknown): CompanySerialNumberingSettings {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    referenceNumber: sanitizeReferenceNumberPattern(source.referenceNumber),
  };
}

function encodeDigits(sequence: number, length: number): string {
  const body = String(Math.max(1, Math.trunc(sequence)));
  return body.length >= length ? body : body.padStart(length, "0");
}

/** ترميز ثابت العرض: 1 → AAAAAA (لطول 6)، دون تصادم مع الحشو. */
function encodeLetters(sequence: number, length: number): string {
  let x = Math.max(1, Math.trunc(sequence)) - 1;
  const chars: string[] = [];
  const width = Math.max(1, length);
  for (let i = 0; i < width; i += 1) {
    chars.push(String.fromCharCode(65 + (x % 26)));
    x = Math.floor(x / 26);
  }
  while (x > 0) {
    chars.push(String.fromCharCode(65 + (x % 26)));
    x = Math.floor(x / 26);
  }
  return chars.reverse().join("");
}

function encodeMixed(sequence: number, length: number): string {
  const body = Math.max(1, Math.trunc(sequence)).toString(36).toUpperCase();
  return body.length >= length ? body : body.padStart(length, "0");
}

function encodeSerialBody(pattern: ReferenceNumberPattern, sequence: number): string {
  const length = Math.max(1, Math.min(MAX_LENGTH, Math.trunc(pattern.length) || 1));
  if (pattern.valueType === "letters") return encodeLetters(sequence, length);
  if (pattern.valueType === "mixed") return encodeMixed(sequence, length);
  return encodeDigits(sequence, length);
}

function twoDigit(value: number): string {
  return String(value).padStart(2, "0");
}

export function resolveReferencePrefix(pattern: ReferenceNumberPattern, at: Date = new Date()): string {
  if (!pattern.hasPrefix) return "";
  const kinds =
    Array.isArray(pattern.prefixKinds) && pattern.prefixKinds.length > 0
      ? uniquePrefixKinds(pattern.prefixKinds)
      : [];
  const parts: string[] = [];
  for (const kind of kinds) {
    if (kind === "year") parts.push(String(at.getFullYear()).slice(-2));
    else if (kind === "month") parts.push(twoDigit(at.getMonth() + 1));
    else if (kind === "day") parts.push(twoDigit(at.getDate()));
    else {
      const letters = sanitizePrefixLetters(pattern.prefixLetters);
      if (letters) parts.push(letters);
    }
  }
  return parts.join("-");
}

export function formatReferenceNumber(
  pattern: ReferenceNumberPattern,
  sequence: number,
  at: Date = new Date(),
): string {
  const body = encodeSerialBody(pattern, sequence);
  const prefix = resolveReferencePrefix(pattern, at);
  return prefix ? `${prefix}-${body}` : body;
}

export function trimReferenceNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function toProjectSerialApiFields(project: {
  displayNumber?: number | null;
  referenceNumber?: string | null;
}) {
  const displayNumber =
    typeof project.displayNumber === "number" && Number.isFinite(project.displayNumber)
      ? project.displayNumber
      : null;
  return {
    displayNumber,
    referenceNumber: trimReferenceNumber(project.referenceNumber),
  };
}
