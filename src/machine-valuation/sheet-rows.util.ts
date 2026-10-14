export type MvRowValue = string | number | null;

export function recordsToRowValues(
  headers: string[],
  rows: Record<string, MvRowValue>[],
): MvRowValue[][] {
  return rows.map((row) =>
    headers.map((h) => {
      const v = row[h];
      return v === undefined ? null : v;
    }),
  );
}

export function rowValuesToRecords(
  headers: string[],
  rowValues: MvRowValue[][],
): Record<string, MvRowValue>[] {
  return rowValues.map((vals) => {
    const o: Record<string, MvRowValue> = {};
    headers.forEach((h, i) => {
      o[h] = vals[i] ?? null;
    });
    return o;
  });
}

/**
 * Multer often decodes UTF-8 filenames as latin1; recover UTF-8.
 * Prefer client-sent `sourceFileNameUtf8` when available.
 */
export function decodeUploadFilename(original: string): string {
  if (!original) return "";

  const normalized = original.normalize("NFC");
  // A name that already contains real Unicode (Arabic included) must not be
  // forced through latin1. Doing so truncates every code point above 255.
  if (Array.from(normalized).some((char) => char.codePointAt(0)! > 0xff)) {
    return normalized;
  }

  try {
    const decoded = Buffer.from(normalized, "latin1").toString("utf8");
    // Genuine latin1 names (for example résumé.pdf) are not necessarily UTF-8.
    // Keep the original whenever decoding would introduce replacement marks.
    if (decoded.includes("\uFFFD")) return normalized;
    return decoded.normalize("NFC");
  } catch {
    return normalized;
  }
}
