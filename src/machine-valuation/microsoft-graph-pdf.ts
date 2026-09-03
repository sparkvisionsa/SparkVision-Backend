import { createHash, randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_UPLOAD_SESSION_THRESHOLD_BYTES = 10 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES = 10 * 1024 * 1024; // 32 x 320 KiB, as required by Graph.
const MAX_FETCH_ATTEMPTS = 4;
const PDF_HEADER = Buffer.from("%PDF-");

type OfficeFileKind = "docx" | "pptx";

type GraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: URL;
  conversionFolder: string;
  driveId?: string;
  permanentDelete: boolean;
  uploadSessionThresholdBytes: number;
  cacheKey: string;
};

type GraphResources = {
  siteId: string;
  driveId: string;
  folderId: string;
};

type GraphDriveItem = {
  id?: unknown;
  name?: unknown;
  size?: unknown;
};

type TokenCacheEntry = {
  cacheKey: string;
  accessToken: string;
  expiresAt: number;
};

type PromiseCache<T> = {
  cacheKey: string;
  promise: Promise<T>;
};

let tokenCache: TokenCacheEntry | undefined;
let tokenPromiseCache: PromiseCache<TokenCacheEntry> | undefined;
let resourcePromiseCache: PromiseCache<GraphResources> | undefined;

function firstEnvironmentValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function environmentBoolean(names: string[], fallback: boolean): boolean {
  const raw = firstEnvironmentValue(...names).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseUploadSessionThresholdBytes(): number {
  const raw = firstEnvironmentValue("MS_GRAPH_UPLOAD_SESSION_THRESHOLD_MB");
  if (!raw) return DEFAULT_UPLOAD_SESSION_THRESHOLD_BYTES;
  const megabytes = Number(raw);
  if (!Number.isFinite(megabytes) || megabytes < 1 || megabytes > 200) {
    return DEFAULT_UPLOAD_SESSION_THRESHOLD_BYTES;
  }
  return Math.floor(megabytes * 1024 * 1024);
}

function normalizeFolderPath(raw: string): string {
  const segments = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("MS_GRAPH_CONVERSION_FOLDER must be a valid drive-relative folder path");
  }
  return segments.join("/");
}

function getRawGraphConfiguration() {
  return {
    tenantId: firstEnvironmentValue(
      "MS_GRAPH_TENANT_ID",
      "MICROSOFT_GRAPH_TENANT_ID",
      "AZURE_TENANT_ID",
    ),
    clientId: firstEnvironmentValue(
      "MS_GRAPH_CLIENT_ID",
      "MICROSOFT_GRAPH_CLIENT_ID",
      "AZURE_CLIENT_ID",
    ),
    clientSecret: firstEnvironmentValue(
      "MS_GRAPH_CLIENT_SECRET",
      "MICROSOFT_GRAPH_CLIENT_SECRET",
      "AZURE_CLIENT_SECRET",
    ),
    siteUrl: firstEnvironmentValue(
      "MS_GRAPH_SHAREPOINT_SITE_URL",
      "SHAREPOINT_SITE_URL",
    ),
    conversionFolder:
      firstEnvironmentValue("MS_GRAPH_CONVERSION_FOLDER", "CONVERSION_FOLDER") ||
      "TempConversions",
    driveId: firstEnvironmentValue("MS_GRAPH_DRIVE_ID") || undefined,
  };
}

export function microsoftGraphPdfConfigurationMissing(): string[] {
  const config = getRawGraphConfiguration();
  const missing: string[] = [];
  if (!config.tenantId) missing.push("MS_GRAPH_TENANT_ID");
  if (!config.clientId) missing.push("MS_GRAPH_CLIENT_ID");
  if (!config.clientSecret) missing.push("MS_GRAPH_CLIENT_SECRET");
  if (!config.siteUrl) missing.push("MS_GRAPH_SHAREPOINT_SITE_URL");
  return missing;
}

export function isMicrosoftGraphPdfConfigured(): boolean {
  return microsoftGraphPdfConfigurationMissing().length === 0;
}

function loadGraphConfiguration(): GraphConfig {
  const missing = microsoftGraphPdfConfigurationMissing();
  if (missing.length > 0) {
    throw new Error(`Microsoft Graph PDF conversion is not configured: ${missing.join(", ")}`);
  }

  const raw = getRawGraphConfiguration();
  let siteUrl: URL;
  try {
    siteUrl = new URL(raw.siteUrl);
  } catch {
    throw new Error("MS_GRAPH_SHAREPOINT_SITE_URL must be a valid HTTPS URL");
  }
  if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password) {
    throw new Error("MS_GRAPH_SHAREPOINT_SITE_URL must be a valid HTTPS URL");
  }

  const conversionFolder = normalizeFolderPath(raw.conversionFolder);
  const secretFingerprint = createHash("sha256").update(raw.clientSecret).digest("hex");
  const cacheKey = [
    raw.tenantId,
    raw.clientId,
    secretFingerprint,
    siteUrl.origin,
    siteUrl.pathname,
    conversionFolder,
    raw.driveId ?? "",
  ].join("|");

  return {
    tenantId: raw.tenantId,
    clientId: raw.clientId,
    clientSecret: raw.clientSecret,
    siteUrl,
    conversionFolder,
    driveId: raw.driveId,
    permanentDelete: environmentBoolean(["MS_GRAPH_PERMANENT_DELETE"], true),
    uploadSessionThresholdBytes: parseUploadSessionThresholdBytes(),
    cacheKey,
  };
}

function encodeGraphPath(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function deadlineFromTimeout(timeoutMs?: number): number {
  const normalized =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;
  return Date.now() + normalized;
}

function remainingTime(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const base = Math.min(10_000, 500 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

function isRetryableStatus(status: number, additionalStatuses: readonly number[]): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    additionalStatuses.includes(status)
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: {
    deadline: number;
    label: string;
    additionalRetryStatuses?: readonly number[];
  },
): Promise<Response> {
  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    const remaining = remainingTime(opts.deadline);
    if (remaining <= 0) {
      throw new Error(`${opts.label} timed out`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);
    timeout.unref?.();
    try {
      const response = await globalThis.fetch(url, { ...init, signal: controller.signal });
      lastResponse = response;
      if (
        !isRetryableStatus(
          response.status,
          opts.additionalRetryStatuses ?? [],
        ) ||
        attempt === MAX_FETCH_ATTEMPTS - 1
      ) {
        return response;
      }
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS - 1) break;
    } finally {
      clearTimeout(timeout);
    }

    const delay = retryDelayMs(lastResponse, attempt);
    if (delay >= remainingTime(opts.deadline)) break;
    await sleep(delay);
    lastResponse = undefined;
  }

  if (lastResponse) return lastResponse;
  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? "failed");
  throw new Error(`${opts.label} failed: ${reason}`);
}

async function responseError(response: Response, label: string): Promise<Error> {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    const parsed = JSON.parse(text) as {
      error?: { code?: unknown; message?: unknown };
    };
    const code = typeof parsed.error?.code === "string" ? parsed.error.code : "";
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : "";
    detail = [code, message].filter(Boolean).join(": ");
  } catch {
    // A short plain-text response is still useful for operational diagnostics.
  }
  const safeDetail = detail.replace(/[\r\n]+/g, " ").trim().slice(0, 500);
  return new Error(`${label} returned HTTP ${response.status}${safeDetail ? `: ${safeDetail}` : ""}`);
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) throw await responseError(response, label);
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${label} returned an invalid JSON response`);
  }
}

async function requestAccessToken(config: GraphConfig, deadline: number): Promise<TokenCacheEntry> {
  if (
    tokenCache?.cacheKey === config.cacheKey &&
    tokenCache.expiresAt > Date.now() + 60_000
  ) {
    return tokenCache;
  }
  if (tokenPromiseCache?.cacheKey === config.cacheKey) return tokenPromiseCache.promise;

  const promise = (async () => {
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: GRAPH_SCOPE,
      grant_type: "client_credentials",
    });
    const response = await fetchWithRetry(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      { deadline, label: "Microsoft identity token request" },
    );
    const payload = await parseJsonResponse<{
      access_token?: unknown;
      expires_in?: unknown;
    }>(response, "Microsoft identity token request");
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("Microsoft identity token response did not contain an access token");
    }
    const expiresIn = Number(payload.expires_in);
    const entry: TokenCacheEntry = {
      cacheKey: config.cacheKey,
      accessToken: payload.access_token,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000),
    };
    tokenCache = entry;
    return entry;
  })();

  tokenPromiseCache = { cacheKey: config.cacheKey, promise };
  try {
    return await promise;
  } finally {
    if (tokenPromiseCache?.promise === promise) tokenPromiseCache = undefined;
  }
}

async function graphRequest(
  config: GraphConfig,
  graphPath: string,
  init: RequestInit,
  opts: {
    deadline: number;
    label: string;
    additionalRetryStatuses?: readonly number[];
  },
): Promise<Response> {
  for (let authAttempt = 0; authAttempt < 2; authAttempt += 1) {
    const token = await requestAccessToken(config, opts.deadline);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token.accessToken}`);
    const response = await fetchWithRetry(
      `${GRAPH_BASE_URL}${graphPath}`,
      { ...init, headers },
      opts,
    );
    if (response.status !== 401 || authAttempt > 0) return response;
    await response.body?.cancel().catch(() => undefined);
    if (tokenCache?.accessToken === token.accessToken) tokenCache = undefined;
  }
  throw new Error(`${opts.label} authorization failed`);
}

function requireStringId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} response did not contain an id`);
  }
  return value;
}

async function resolveGraphResources(
  config: GraphConfig,
  deadline: number,
): Promise<GraphResources> {
  if (resourcePromiseCache?.cacheKey === config.cacheKey) {
    return resourcePromiseCache.promise;
  }

  const promise = (async () => {
    const sitePath = encodeGraphPath(decodeURIComponent(config.siteUrl.pathname));
    if (!sitePath) throw new Error("MS_GRAPH_SHAREPOINT_SITE_URL must include the site path");
    const siteResponse = await graphRequest(
      config,
      `/sites/${encodeURIComponent(config.siteUrl.hostname)}:/${sitePath}?$select=id`,
      { method: "GET" },
      { deadline, label: "SharePoint site lookup" },
    );
    const site = await parseJsonResponse<{ id?: unknown }>(siteResponse, "SharePoint site lookup");
    const siteId = requireStringId(site.id, "SharePoint site lookup");

    let driveId = config.driveId;
    if (!driveId) {
      const driveResponse = await graphRequest(
        config,
        `/sites/${encodeURIComponent(siteId)}/drive?$select=id`,
        { method: "GET" },
        { deadline, label: "SharePoint Documents library lookup" },
      );
      const drive = await parseJsonResponse<{ id?: unknown }>(
        driveResponse,
        "SharePoint Documents library lookup",
      );
      driveId = requireStringId(drive.id, "SharePoint Documents library lookup");
    }

    const folderResponse = await graphRequest(
      config,
      `/drives/${encodeURIComponent(driveId)}/root:/${encodeGraphPath(config.conversionFolder)}?$select=id,folder`,
      { method: "GET" },
      { deadline, label: "SharePoint conversion folder lookup" },
    );
    const folder = await parseJsonResponse<{ id?: unknown; folder?: unknown }>(
      folderResponse,
      "SharePoint conversion folder lookup",
    );
    if (!folder.folder || typeof folder.folder !== "object") {
      throw new Error("MS_GRAPH_CONVERSION_FOLDER does not point to a SharePoint folder");
    }

    return {
      siteId,
      driveId,
      folderId: requireStringId(folder.id, "SharePoint conversion folder lookup"),
    };
  })();

  resourcePromiseCache = { cacheKey: config.cacheKey, promise };
  try {
    return await promise;
  } catch (error) {
    if (resourcePromiseCache?.promise === promise) resourcePromiseCache = undefined;
    throw error;
  }
}

function officeMimeType(kind: OfficeFileKind): string {
  return kind === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

async function uploadSmallOfficeFile(
  config: GraphConfig,
  resources: GraphResources,
  sourcePath: string,
  remoteName: string,
  kind: OfficeFileKind,
  deadline: number,
): Promise<string> {
  const file = await fs.promises.readFile(sourcePath);
  const response = await graphRequest(
    config,
    `/drives/${encodeURIComponent(resources.driveId)}/items/${encodeURIComponent(resources.folderId)}:/${encodeURIComponent(remoteName)}:/content`,
    {
      method: "PUT",
      headers: {
        "Content-Type": officeMimeType(kind),
        "Content-Length": String(file.length),
      },
      body: file,
    },
    { deadline, label: "SharePoint Office file upload" },
  );
  const item = await parseJsonResponse<GraphDriveItem>(response, "SharePoint Office file upload");
  return requireStringId(item.id, "SharePoint Office file upload");
}

async function cancelUploadSession(uploadUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  try {
    const response = await fetchWithRetry(
      uploadUrl,
      { method: "DELETE", redirect: "follow" },
      { deadline, label: "SharePoint upload session cancellation" },
    );
    await response.body?.cancel().catch(() => undefined);
  } catch {
    // The session expires automatically; cancellation is best effort.
  }
}

async function uploadLargeOfficeFile(
  config: GraphConfig,
  resources: GraphResources,
  sourcePath: string,
  remoteName: string,
  fileSize: number,
  deadline: number,
): Promise<string> {
  const createResponse = await graphRequest(
    config,
    `/drives/${encodeURIComponent(resources.driveId)}/items/${encodeURIComponent(resources.folderId)}:/${encodeURIComponent(remoteName)}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail" } }),
    },
    { deadline, label: "SharePoint upload session creation" },
  );
  const session = await parseJsonResponse<{ uploadUrl?: unknown }>(
    createResponse,
    "SharePoint upload session creation",
  );
  if (typeof session.uploadUrl !== "string" || !session.uploadUrl.startsWith("https://")) {
    throw new Error("SharePoint upload session response did not contain a secure upload URL");
  }

  const file = await fs.promises.open(sourcePath, "r");
  let completed = false;
  try {
    let offset = 0;
    while (offset < fileSize) {
      const length = Math.min(UPLOAD_CHUNK_BYTES, fileSize - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, offset);
      if (bytesRead !== length) throw new Error("Office source file changed while it was uploading");

      const response = await fetchWithRetry(
        session.uploadUrl,
        {
          method: "PUT",
          redirect: "follow",
          headers: {
            "Content-Length": String(length),
            "Content-Range": `bytes ${offset}-${offset + length - 1}/${fileSize}`,
          },
          body: chunk,
        },
        { deadline, label: "SharePoint resumable Office file upload" },
      );

      if (response.status === 202) {
        await response.body?.cancel().catch(() => undefined);
        offset += length;
        continue;
      }

      const item = await parseJsonResponse<GraphDriveItem>(
        response,
        "SharePoint resumable Office file upload",
      );
      completed = true;
      return requireStringId(item.id, "SharePoint resumable Office file upload");
    }
    throw new Error("SharePoint upload session ended without returning the uploaded item");
  } finally {
    await file.close();
    if (!completed) await cancelUploadSession(session.uploadUrl);
  }
}

async function uploadOfficeFile(
  config: GraphConfig,
  resources: GraphResources,
  sourcePath: string,
  remoteName: string,
  kind: OfficeFileKind,
  deadline: number,
): Promise<string> {
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error("Office source file is empty or missing");
  if (stat.size <= config.uploadSessionThresholdBytes) {
    return uploadSmallOfficeFile(
      config,
      resources,
      sourcePath,
      remoteName,
      kind,
      deadline,
    );
  }
  return uploadLargeOfficeFile(
    config,
    resources,
    sourcePath,
    remoteName,
    stat.size,
    deadline,
  );
}

async function downloadConvertedPdf(
  config: GraphConfig,
  resources: GraphResources,
  itemId: string,
  outputPath: string,
  deadline: number,
): Promise<void> {
  let response = await graphRequest(
    config,
    `/drives/${encodeURIComponent(resources.driveId)}/items/${encodeURIComponent(itemId)}/content?format=pdf`,
    { method: "GET", redirect: "manual" },
    {
      deadline,
      label: "Microsoft 365 PDF conversion",
      additionalRetryStatuses: [404, 409, 423],
    },
  );

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("Microsoft 365 PDF conversion did not return a download URL");
    let downloadUrl: URL;
    try {
      downloadUrl = new URL(location);
    } catch {
      throw new Error("Microsoft 365 PDF conversion returned an invalid download URL");
    }
    if (downloadUrl.protocol !== "https:") {
      throw new Error("Microsoft 365 PDF conversion returned an insecure download URL");
    }
    response = await fetchWithRetry(
      downloadUrl.toString(),
      { method: "GET", redirect: "follow" },
      { deadline, label: "Microsoft 365 converted PDF download" },
    );
  }

  if (!response.ok) throw await responseError(response, "Microsoft 365 PDF conversion");
  if (!response.body) throw new Error("Microsoft 365 PDF conversion returned an empty response");

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  const partialPath = `${outputPath}.partial-${randomUUID()}`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(partialPath, { flags: "wx" }),
    );
    const stat = await fs.promises.stat(partialPath);
    if (stat.size < 100) throw new Error("Microsoft 365 returned an invalid or empty PDF");
    const handle = await fs.promises.open(partialPath, "r");
    try {
      const header = Buffer.alloc(PDF_HEADER.length);
      await handle.read(header, 0, header.length, 0);
      if (!header.equals(PDF_HEADER)) throw new Error("Microsoft 365 response is not a PDF file");
    } finally {
      await handle.close();
    }
    await fs.promises.rm(outputPath, { force: true });
    await fs.promises.rename(partialPath, outputPath);
  } finally {
    await fs.promises.rm(partialPath, { force: true }).catch(() => undefined);
  }
}

async function deleteTemporaryGraphItem(
  config: GraphConfig,
  resources: GraphResources,
  itemId: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  if (config.permanentDelete) {
    try {
      const permanentResponse = await graphRequest(
        config,
        `/drives/${encodeURIComponent(resources.driveId)}/items/${encodeURIComponent(itemId)}/permanentDelete`,
        { method: "POST", headers: { Accept: "application/json" } },
        { deadline, label: "SharePoint temporary file permanent deletion" },
      );
      if (permanentResponse.ok) {
        await permanentResponse.body?.cancel().catch(() => undefined);
        return;
      }
      await permanentResponse.body?.cancel().catch(() => undefined);
    } catch {
      // Fall back to regular deletion for tenants where permanentDelete is unavailable.
    }
  }

  const response = await graphRequest(
    config,
    `/drives/${encodeURIComponent(resources.driveId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
    { deadline, label: "SharePoint temporary file deletion" },
  );
  if (!response.ok && response.status !== 404) {
    throw await responseError(response, "SharePoint temporary file deletion");
  }
  await response.body?.cancel().catch(() => undefined);
}

export async function convertOfficeFileToPdfViaMicrosoftGraph(
  sourcePath: string,
  outDir: string,
  opts: { kind: OfficeFileKind; timeoutMs?: number },
): Promise<string> {
  const config = loadGraphConfiguration();
  const deadline = deadlineFromTimeout(opts.timeoutMs);
  const resources = await resolveGraphResources(config, deadline);
  const absoluteSource = path.resolve(sourcePath);
  const extension = path.extname(absoluteSource).toLowerCase();
  if (extension !== `.${opts.kind}`) {
    throw new Error(`Microsoft Graph PDF conversion expected a .${opts.kind} source file`);
  }

  const remoteName = `sparkvision-${Date.now()}-${randomUUID()}.${opts.kind}`;
  let itemId: string | undefined;
  try {
    itemId = await uploadOfficeFile(
      config,
      resources,
      absoluteSource,
      remoteName,
      opts.kind,
      deadline,
    );
    const outputPath = path.join(
      path.resolve(outDir),
      `${path.basename(absoluteSource, extension)}.pdf`,
    );
    await downloadConvertedPdf(config, resources, itemId, outputPath, deadline);
    return outputPath;
  } finally {
    if (itemId) {
      try {
        await deleteTemporaryGraphItem(config, resources, itemId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[MicrosoftGraphPdf] Temporary source cleanup failed: ${message}`);
      }
    }
  }
}

/** Clears only non-secret in-memory caches. Intended for isolated tests. */
export function resetMicrosoftGraphPdfCaches(): void {
  tokenCache = undefined;
  tokenPromiseCache = undefined;
  resourcePromiseCache = undefined;
}
