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
let cleanupTimer: NodeJS.Timeout | undefined;

function schedulePendingPdfExportCleanup() {
  if (cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
  }

  let nextExpiresAt: number | undefined;
  for (const row of pendingPdfExports.values()) {
    nextExpiresAt =
      nextExpiresAt == null ? row.expiresAt : Math.min(nextExpiresAt, row.expiresAt);
  }
  if (nextExpiresAt == null) return;

  cleanupTimer = setTimeout(() => {
    cleanupTimer = undefined;
    cleanupExpiredPdfExports();
    schedulePendingPdfExportCleanup();
  }, Math.max(1, nextExpiresAt - Date.now()));
  cleanupTimer.unref?.();
}

export function cleanupExpiredPdfExports() {
  const now = Date.now();
  for (const [token, row] of pendingPdfExports.entries()) {
    if (row.expiresAt > now) continue;
    pendingPdfExports.delete(token);
    fs.rm(row.filePath, { force: true }, () => undefined);
  }

  if (pendingPdfExports.size === 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = undefined;
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
  schedulePendingPdfExportCleanup();
  return token;
}

/**
 * Returns a pending export without consuming it. A browser may retry a
 * download after a cancelled connection, so tokens remain usable until their
 * short expiry time. Project access is still checked by the controller.
 */
export function getPendingPdfExport(
  projectId: string,
  token: string,
): PendingPdfExport | null {
  cleanupExpiredPdfExports();
  const row = pendingPdfExports.get(token);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

/** Primarily useful for explicit cleanup in callers and tests. */
export function deletePendingPdfExport(projectId: string, token: string): boolean {
  const row = pendingPdfExports.get(token);
  if (!row || row.projectId !== projectId) return false;
  pendingPdfExports.delete(token);
  fs.rm(row.filePath, { force: true }, () => undefined);
  schedulePendingPdfExportCleanup();
  return true;
}
