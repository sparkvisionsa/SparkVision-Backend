export type CharSet = "digits" | "letters" | "alphanumeric";
export type NumberSource = "sequence" | "date" | "both";
export type DateFormat = "YYYYMMDD" | "YYMMDD" | "YYYYMM" | "YYYY";
export type ResetPeriod = "never" | "yearly" | "monthly" | "daily";

export interface AssignmentNumberConfig {
  enabled: boolean;
  source: NumberSource;       // what the number is built from
  charset: CharSet;           // characters of the sequence part
  incremental: boolean;       // true = counter, false = random each time
  length: number;             // length of the sequence part
  start: number;              // first counter value
  reset: ResetPeriod;         // when the counter restarts (server-side)
  dateFormat: DateFormat;
  prefix: string;
  prefixDash: boolean;        // dash between prefix and number
  partDash: boolean;          // dash between date and sequence
}

export const DEFAULT_ASSIGNMENT_CONFIG: AssignmentNumberConfig = {
  enabled: false,
  source: "sequence",
  charset: "digits",
  incremental: true,
  length: 4,
  start: 1,
  reset: "never",
  dateFormat: "YYYYMMDD",
  prefix: "",
  prefixDash: true,
  partDash: true,
};

const ALPHABETS: Record<CharSet, string> = {
  digits: "0123456789",
  letters: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  alphanumeric: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
};

export function toBase(n: number, alphabet: string, length: number) {
  const b = alphabet.length;
  let x = Math.max(0, Math.floor(n));
  let s = "";
  do {
    s = alphabet[x % b] + s;
    x = Math.floor(x / b);
  } while (x > 0);
  return s.padStart(length, alphabet[0]);
}

export function sequenceCapacity(c: AssignmentNumberConfig) {
  return Math.pow(ALPHABETS[c.charset].length, c.length);
}

export function formatDatePart(fmt: DateFormat, d: Date) {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  switch (fmt) {
    case "YYYYMMDD": return yyyy + mm + dd;
    case "YYMMDD": return yyyy.slice(2) + mm + dd;
    case "YYYYMM": return yyyy + mm;
    case "YYYY": return yyyy;
  }
}

export function generateAssignmentNumber(
  c: AssignmentNumberConfig,
  opts: { counter: number; now?: Date; random?: () => number },
): string {
  const now = opts.now ?? new Date();
  const rnd = opts.random ?? Math.random;
  const parts: string[] = [];

  if (c.source !== "sequence") parts.push(formatDatePart(c.dateFormat, now));

  if (c.source !== "date") {
    const alphabet = ALPHABETS[c.charset];
    if (c.incremental) {
      parts.push(toBase(opts.counter, alphabet, c.length));
    } else {
      let s = "";
      for (let i = 0; i < c.length; i++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      parts.push(s);
    }
  }

  const body = parts.join(c.partDash ? "-" : "");
  const prefix = c.prefix.trim();
  if (!prefix) return body;
  return prefix + (c.prefixDash ? "-" : "") + body;
}

/** Sample list for the live preview. */
export function previewAssignmentNumbers(c: AssignmentNumberConfig, count = 4) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) =>
    generateAssignmentNumber(c, { counter: c.start + i, now }),
  );
}
