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
  try {
    return Buffer.from(original, "latin1").toString("utf8");
  } catch {
    return original;
  }
}
