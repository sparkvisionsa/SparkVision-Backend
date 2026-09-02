import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";

type PendingPdfExport = {
  projectId: string;
  filePath: string;
  fileName: string;
  expiresAt: number;
};

const pendingPdfExports = new Map<string, PendingPdfExport>();
const PDF_EXPORT_TTL_MS = 10 * 60_000;

export function cleanupExpiredPdfExports() {
  const now = Date.now();
  for (const [token, row] of pendingPdfExports.entries()) {
    if (row.expiresAt > now) continue;
    pendingPdfExports.delete(token);
    fs.rm(row.filePath, { force: true }, () => undefined);
  }
}

export function storePendingPdfExport(opts: {
  projectId: string;
  sourcePdfPath: string;
  fileName: string;
}): string {
  cleanupExpiredPdfExports();
  const token = randomUUID();
  const persistPath = path.join(os.tmpdir(), `mv-merge-pdf-${token}.pdf`);
  try {
    fs.renameSync(opts.sourcePdfPath, persistPath);
  } catch {
    fs.copyFileSync(opts.sourcePdfPath, persistPath);
  }
  pendingPdfExports.set(token, {
    projectId: opts.projectId,
    filePath: persistPath,
    fileName: opts.fileName,
    expiresAt: Date.now() + PDF_EXPORT_TTL_MS,
  });
  return token;
}

export function takePendingPdfExport(
  projectId: string,
  token: string,
): PendingPdfExport | null {
  cleanupExpiredPdfExports();
  const row = pendingPdfExports.get(token);
  if (!row || row.projectId !== projectId) return null;
  pendingPdfExports.delete(token);
  return row;
}
