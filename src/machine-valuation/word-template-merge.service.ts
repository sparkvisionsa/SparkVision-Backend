import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { createHash, randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import { loadOwnedCompanyWordTemplateBufferFromGridFs } from "@/server/auth-tracking/service";
import { getMongoDb } from "@/server/mongodb";
import { MachineValuationService } from "./machine-valuation.service";
import type { MvAccessContext, MvReportTeamMember } from "./types";
import {
  convertDocxToPdf,
  isDocxPdfConversionAvailable,
  machineValuationPdfTimeoutMs,
} from "./docx-to-pdf";
import { getPendingPdfExport, storePendingPdfExport } from "./pending-pdf-export";

type MergeImageLayout = {
  imagesPerRow: number;
  imagesPerPage: number;
  clientImagesPerRow: number;
  clientImagesPerPage: number;
  imageQuality: number;
};

/** حمولة الدمج عبر مسارات ملفات على القرص — تتحمّل آلاف الصور بلا Base64 في الذاكرة. */
type DiskMergeManifest = {
  templatePath: string;
  outputPath: string;
  textValues: Record<string, string>;
  /** Variables intentionally left untouched for this company template. */
  excludedVariableNames?: string[];
  /** Company-defined placeholders used as image insertion anchors. */
  assetImageMarkerVariables?: string[];
  valuationImageMarkerVariables?: string[];
  clientImageMarkerVariables?: string[];
  assetImagePaths: string[];
  valuationImagePaths: string[];
  clientImagePaths: string[];
  reportPreparers: DiskReportPreparer[];
  imageLayout: MergeImageLayout;
};

type DiskReportPreparer = {
  userId: string;
  reportDisplayName: string;
  jobTitle: string;
  membershipNo: string;
  reportRole: string;
  signatureImageDataUrl: string;
};

type ImageSource =
  | { kind: "url"; url: string }
  | { kind: "fileId"; fileId: string }
  | { kind: "buffer"; buffer: Buffer };

type StoredTemplateVariableMapping = {
  variable: string;
  sourceKey: string;
  staticValue?: string;
};

type StoredCompanyDocumentTemplate = {
  id?: string;
  fileName?: string;
  fileUrl?: string | null;
  gridFsFileId?: string | null;
  variableMappings?: unknown;
  excludedVariableNames?: unknown;
};

type CompanyTemplateConfiguration = {
  /** The owning company is part of the storage boundary, not browser input. */
  companyId: string | null;
  template: StoredCompanyDocumentTemplate | null;
  mappings: StoredTemplateVariableMapping[];
  excludedVariableNames: string[];
};

function sanitizeImageLayout(value: unknown): MergeImageLayout {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const imagesPerRow = Math.trunc(Number(input.imagesPerRow));
  const safeImagesPerRow = Number.isFinite(imagesPerRow)
    ? Math.max(1, Math.min(6, imagesPerRow))
    : 4;
  const providedPerPage = Math.trunc(Number(input.imagesPerPage));
  const autoPerPage =
    safeImagesPerRow <= 1
      ? 2
      : safeImagesPerRow === 2
        ? 4
        : safeImagesPerRow * (safeImagesPerRow >= 4 ? 5 : 4);
  // صف واحد → صورتان/صفحة، صفّان → 4/صفحة (لا تعتمد على قيم قديمة من الواجهة)
  const safeImagesPerPage =
    safeImagesPerRow <= 2
      ? autoPerPage
      : Number.isFinite(providedPerPage) && providedPerPage > 0
        ? Math.max(safeImagesPerRow, Math.min(60, providedPerPage))
        : autoPerPage;
  const clientRaw = Math.trunc(Number(input.clientImagesPerRow));
  const clientImagesPerRow =
    clientRaw === 1 || clientRaw === 2 || clientRaw === 3 ? clientRaw : 2;
  const requestedQuality = Math.trunc(Number(input.imageQuality));
  const imageQuality = Number.isFinite(requestedQuality)
    ? Math.max(70, Math.min(100, requestedQuality))
    : 95;
  return {
    imagesPerRow: safeImagesPerRow,
    imagesPerPage: safeImagesPerPage,
    clientImagesPerRow,
    clientImagesPerPage: clientImagesPerRow * Math.max(2, clientImagesPerRow),
    imageQuality,
  };
}

type OptimizeImageSettings = {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  /** 4:4:4 للنصوص/الجداول، 4:2:0 لصور الأصول الكثيرة */
  chromaSubsampling: "4:4:4" | "4:2:0";
};

const WORD_IMAGE_CACHE_VERSION = "v1";
const WORD_IMAGE_CACHE_TTL_MS = 6 * 60 * 60_000;
const WORD_IMAGE_CACHE_CLEANUP_INTERVAL_MS = 60 * 60_000;
const wordImageCacheInflight = new Map<string, Promise<string | null>>();
let lastWordImageCacheCleanupAt = 0;

function wordImageCacheRoot(): string {
  return path.join(os.tmpdir(), "mv-word-image-cache");
}

function imageSourceIdentity(source: ImageSource): string {
  if (source.kind === "fileId") return `file:${source.fileId}`;
  if (source.kind === "url") return `url:${source.url}`;
  return `buffer:${createHash("sha256").update(source.buffer).digest("hex")}`;
}

function optimizedImageCacheKey(
  projectId: string,
  source: ImageSource,
  settings: OptimizeImageSettings,
  accessScope: string,
): string {
  return createHash("sha256")
    .update(WORD_IMAGE_CACHE_VERSION)
    .update("\0")
    .update(projectId)
    .update("\0")
    .update(accessScope)
    .update("\0")
    .update(imageSourceIdentity(source))
    .update("\0")
    .update(JSON.stringify(settings))
    .digest("hex");
}

async function cachedImageIsFresh(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.size > 32 && Date.now() - stat.mtimeMs <= WORD_IMAGE_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function scheduleWordImageCacheCleanup(): void {
  const now = Date.now();
  if (now - lastWordImageCacheCleanupAt < WORD_IMAGE_CACHE_CLEANUP_INTERVAL_MS) return;
  lastWordImageCacheCleanupAt = now;
  const root = wordImageCacheRoot();
  void fs.promises
    .readdir(root, { withFileTypes: true })
    .then(async (entries) => {
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jpg"))
          .map(async (entry) => {
            const filePath = path.join(root, entry.name);
            try {
              const stat = await fs.promises.stat(filePath);
              if (now - stat.mtimeMs > WORD_IMAGE_CACHE_TTL_MS) {
                await fs.promises.rm(filePath, { force: true });
              }
            } catch {
              /* best-effort cache cleanup */
            }
          }),
      );
    })
    .catch(() => undefined);
}

/** صور الأصول — تُخفَّض مع ازدياد العدد لتتحمل آلاف الصور. */
function adaptiveAssetImageSettings(imageCount: number, quality: number): OptimizeImageSettings {
  // سقف أخف قليلاً مع الحفاظ على وضوح الطباعة — يسرّع sharp ويقلّل حجم الحزمة
  const qualityCeiling =
    imageCount <= 80 ? 92 : imageCount <= 250 ? 86 : imageCount <= 800 ? 80 : imageCount <= 2000 ? 76 : 70;
  const effectiveQuality = Math.min(quality, qualityCeiling);
  if (imageCount <= 80) return { maxWidth: 1000, maxHeight: 1000, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
  if (imageCount <= 250) return { maxWidth: 820, maxHeight: 820, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
  if (imageCount <= 800) return { maxWidth: 720, maxHeight: 720, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
  if (imageCount <= 2000) return { maxWidth: 640, maxHeight: 640, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
  return { maxWidth: 560, maxHeight: 560, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
}

/**
 * صور حسابات القيمة — دقة طباعة عالية.
 * JPEG أساسي (baseline) متوافقاً مع python-docx؛ يُمرَّر كما هو إن كان ضمن الحدود.
 */
function valuationPrintImageSettings(quality: number): OptimizeImageSettings {
  return {
    maxWidth: 6000,
    maxHeight: 18000,
    quality: Math.max(98, quality),
    chromaSubsampling: "4:4:4",
  };
}

/** مستندات العميل — جودة طباعة عالية للنصوص والجداول. */
function clientDocumentImageSettings(quality: number): OptimizeImageSettings {
  return {
    maxWidth: 4800,
    maxHeight: 14000,
    quality: Math.max(quality, 92),
    chromaSubsampling: "4:4:4",
  };
}

function findDocxWorkerVenvPython(): string | null {
  const venvPaths = [
    path.join(process.cwd(), "docx-worker", "venv", "bin", "python"),
    path.join(process.cwd(), "docx-worker", "venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "docx-worker", ".venv", "bin", "python"),
    path.join(process.cwd(), "docx-worker", ".venv", "Scripts", "python.exe"),
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findPythonBin(): string {
  const dedicated = findDocxWorkerVenvPython();
  if (dedicated) return dedicated;
  const fallbacks = [
    path.join(process.cwd(), "pdf-worker", ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "pdf-worker", ".venv", "bin", "python"),
    path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
  ];
  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function systemPythonBin(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function findMergeScriptPath(): string {
  const candidates = [
    path.join(process.cwd(), "docx-worker", "merge_docx.py"),
    path.join(__dirname, "../../docx-worker/merge_docx.py"),
    path.join(__dirname, "../../../docx-worker/merge_docx.py"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("merge_docx.py not found in docx-worker/");
}

type MergeWorkerResult = {
  outputPath: string;
  stats: {
    variablesFilled: number;
    assetImagesInserted: number;
    valuationImagesInserted: number;
    clientImagesInserted: number;
    reportPreparerTableFound: number;
    reportPreparerRowsRemoved: number;
    reportPreparersInserted: number;
    reportSignaturesInserted: number;
    variablesFound: string[];
  };
};

function parseWorkerStats(stderr: string): MergeWorkerResult["stats"] {
  const lines = stderr.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<MergeWorkerResult["stats"]>;
      return {
        variablesFilled: Number(parsed.variablesFilled ?? 0),
        assetImagesInserted: Number(parsed.assetImagesInserted ?? 0),
        valuationImagesInserted: Number(parsed.valuationImagesInserted ?? 0),
        clientImagesInserted: Number(parsed.clientImagesInserted ?? 0),
        reportPreparerTableFound: Number(parsed.reportPreparerTableFound ?? 0),
        reportPreparerRowsRemoved: Number(parsed.reportPreparerRowsRemoved ?? 0),
        reportPreparersInserted: Number(parsed.reportPreparersInserted ?? 0),
        reportSignaturesInserted: Number(parsed.reportSignaturesInserted ?? 0),
        variablesFound: Array.isArray(parsed.variablesFound) ? parsed.variablesFound.map(String) : [],
      };
    } catch {
      /* try next line */
    }
  }
  return {
    variablesFilled: 0,
    assetImagesInserted: 0,
    valuationImagesInserted: 0,
    clientImagesInserted: 0,
    reportPreparerTableFound: 0,
    reportPreparerRowsRemoved: 0,
    reportPreparersInserted: 0,
    reportSignaturesInserted: 0,
    variablesFound: [],
  };
}

function mergeTimeoutMs(imageCount: number): number {
  // حتى ~45 دقيقة لمشاريع بآلاف الصور — المهلة القديمة 180s كانت تقتل العامل (exited null).
  return Math.min(45 * 60_000, Math.max(240_000, 120_000 + imageCount * 900));
}

async function writeOptimizedJpegFile(
  input: Buffer,
  destPath: string,
  settings: OptimizeImageSettings,
): Promise<boolean> {
  const isPrintImage = settings.chromaSubsampling === "4:4:4";
  try {
    // صور الطباعة: contain داخل الحدود.
    // صور الأصول: fill لمربع الخلية في Word حتى يتخطّى بايثون إعادة التمطيط/الترميز.
    // JPEG أساسي (غير progressive، بدون mozjpeg) متوافق مع python-docx.
    let pipeline = sharp(input, { failOn: "none", sequentialRead: true }).rotate();
    if (isPrintImage) {
      pipeline = pipeline.toColourspace("srgb");
    }
    // withMetadata يضيف Exif — python-docx يرفض JPEG الخام من sharp بدون JFIF/Exif
    await pipeline
      .resize({
        width: settings.maxWidth,
        height: settings.maxHeight,
        fit: isPrintImage ? "inside" : "fill",
        withoutEnlargement: true,
        kernel: isPrintImage ? sharp.kernel.lanczos3 : sharp.kernel.cubic,
      })
      .withMetadata({ density: 96 })
      .jpeg({
        quality: settings.quality,
        mozjpeg: false,
        chromaSubsampling: settings.chromaSubsampling,
        progressive: false,
        optimizeScans: false,
        trellisQuantisation: false,
        overshootDeringing: false,
        force: true,
      })
      .toFile(destPath);
    return true;
  } catch {
    try {
      // احتياطي: Pillow على بايثون سيعيد الترميز؛ احفظ الأصل إن فشل sharp
      await fs.promises.writeFile(destPath, input);
      return true;
    } catch {
      return false;
    }
  }
}

function spawnDiskMergeOnce(manifest: DiskMergeManifest, timeoutMs: number): Promise<MergeWorkerResult> {
  const python = findPythonBin();
  const script = findMergeScriptPath();
  const manifestPath = path.join(path.dirname(manifest.outputPath), "manifest.json");

  return fs.promises
    .writeFile(manifestPath, JSON.stringify(manifest), "utf8")
    .then(
      () =>
        new Promise<MergeWorkerResult>((resolve, reject) => {
          const child = spawn(python, [script, manifestPath], {
            cwd: process.cwd(),
            timeout: timeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              // قلّل تجزئة ذاكرة بايثون قليلاً على خوادم صغيرة
              PYTHONUNBUFFERED: "1",
            },
          });

          const errChunks: Buffer[] = [];
          child.stderr.on("data", (d: Buffer) => errChunks.push(d));
          child.on("error", (err) => reject(new Error(`Python: ${err.message}`)));
          child.on("close", (code, signal) => {
            const stderr = Buffer.concat(errChunks).toString("utf8");
            if (stderr) console.log("[docx-worker]\n" + stderr);
            if (code !== 0) {
              const signalHint = signal
                ? ` signal=${signal}`
                : code == null
                  ? " signal=unknown(killed)"
                  : "";
              const timeoutHint =
                signal === "SIGTERM" || signal === "SIGKILL"
                  ? ` (likely timeout ${timeoutMs}ms or OOM)`
                  : "";
              reject(
                new Error(
                  `docx-worker exited ${code}${signalHint}${timeoutHint}: ${stderr.slice(0, 500)}`,
                ),
              );
              return;
            }
            if (!fs.existsSync(manifest.outputPath)) {
              reject(new Error("docx-worker finished but output file is missing"));
              return;
            }
            const stat = fs.statSync(manifest.outputPath);
            if (stat.size < 100) {
              reject(new Error("docx-worker returned empty output file"));
              return;
            }
            resolve({ outputPath: manifest.outputPath, stats: parseWorkerStats(stderr) });
          });
        }),
    );
}

function pipeFileToResponse(filePath: string, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    stream.on("error", (err) => done(err));
    res.on("finish", () => done());
    res.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
        done(new Error("response closed before Word download finished"));
      }
    });
    stream.pipe(res);
  });
}

/** يُطابق أخطاء بايثون الناتجة عن حزمة مفقودة (مثل ‎lxml‎/‎Pillow‎) لا خطأ في بيانات الدمج نفسها. */
function isMissingPythonDependencyError(message: string): boolean {
  return /ModuleNotFoundError|No module named|ImportError/i.test(message);
}

/**
 * يُثبِّت متطلبات ‎docx-worker/requirements.txt‎ عبر ‎pip‎ التابع لنفس ثنائي بايثون
 * المُستخدَم فعلياً في الدمج (‎findPythonBin‎) — بيئة الخادم قد تحتوي بيئة (venv) لم تُنشأ
 * أو تُثبَّت متطلباتها فيها بعد (أو نُسخة بايثون النظام العامة بلا الحزم المطلوبة).
 * يُنفَّذ مرة واحدة فقط لكل عملية تشغيل الخادم (نتيجة مُخزَّنة) حتى لا يُعاد تكرار محاولة
 * فاشلة عند كل طلب دمج.
 */
let dependencyInstallPromise: Promise<boolean> | null = null;

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", (err) => {
      resolve({ code: 1, output: err.message });
    });
    child.on("close", (code) => {
      resolve({ code, output: Buffer.concat(chunks).toString("utf8") });
    });
  });
}

async function ensureDocxWorkerVenv(): Promise<string | null> {
  const existing = findDocxWorkerVenvPython();
  if (existing) return existing;
  const workerDir = path.dirname(findMergeScriptPath());
  const venvDir = path.join(workerDir, "venv");
  const created = await runProcess(systemPythonBin(), ["-m", "venv", venvDir], {
    cwd: workerDir,
    timeout: 120_000,
  });
  if (created.code !== 0) {
    console.error(`[docx-worker] failed to create venv:\n${created.output.slice(-2000)}`);
    return null;
  }
  return findDocxWorkerVenvPython();
}

function installDocxWorkerDependencies(): Promise<boolean> {
  if (dependencyInstallPromise) return dependencyInstallPromise;
  dependencyInstallPromise = (async () => {
    const workerDir = path.dirname(findMergeScriptPath());
    const requirementsPath = path.join(workerDir, "requirements.txt");
    if (!fs.existsSync(requirementsPath)) return false;
    const python = (await ensureDocxWorkerVenv()) ?? findPythonBin();
    const result = await runProcess(
      python,
      ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", requirementsPath],
      { cwd: workerDir, timeout: 300_000 },
    );
    if (result.code === 0) {
      console.log(`[docx-worker] dependencies installed via pip (${python}):\n${result.output.slice(-2000)}`);
      return true;
    }
    console.error(`[docx-worker] pip install exited ${result.code}:\n${result.output.slice(-2000)}`);
    return false;
  })();
  return dependencyInstallPromise;
}

/**
 * طابور دمج واحد لكل عملية — على خادم 4GB تشغيل دمجين متوازيين يضاعف الذاكرة
 * ويؤدي غالباً إلى OOM أو ‎exited null‎.
 */
let mergeQueueTail: Promise<unknown> = Promise.resolve();

function enqueueDocxMerge<T>(task: () => Promise<T>): Promise<T> {
  const run = mergeQueueTail.then(task, task);
  mergeQueueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * يشغّل عامل دمج Word من ملفات على القرص، ويُحاول تلقائياً تثبيت متطلبات بايثون الناقصة.
 */
async function runDiskDocxMergeWorker(
  manifest: DiskMergeManifest,
  imageCount: number,
): Promise<MergeWorkerResult> {
  return enqueueDocxMerge(async () => {
    const timeoutMs = mergeTimeoutMs(imageCount);
    try {
      return await spawnDiskMergeOnce(manifest, timeoutMs);
    } catch (err) {
      const message = (err as Error).message || "";
      if (!isMissingPythonDependencyError(message)) throw err;
      console.warn(`[docx-worker] missing Python dependency detected, attempting auto-install: ${message}`);
      const installed = await installDocxWorkerDependencies();
      if (!installed) throw err;
      return spawnDiskMergeOnce(manifest, timeoutMs);
    }
  });
}

/**
 * توازي التحميل/الضغط أثناء تجهيز الدمج.
 * رفع التوازي يقلّل زمن التجهيز (كان ~50–80 ثانية لمئات الصور).
 */
const MV_MERGE_ASSET_FETCH_CONCURRENCY = Math.max(
  8,
  Math.min(24, typeof os.cpus === "function" ? os.cpus().length * 3 : 8),
);
const MV_MERGE_PRINT_FETCH_CONCURRENCY = Math.max(4, Math.min(10, MV_MERGE_ASSET_FETCH_CONCURRENCY));

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return results;
}

function bufferFromStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function formatDateAr(value?: unknown): string {
  if (value == null) return "";
  const raw = typeof value === "string" ? value.trim() : "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : iso
          ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
          : new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[^\d.-]/g, "");
  if (!normalized.trim()) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatFinalValueAmount(value: unknown): string {
  const amount = coerceFiniteNumber(value);
  if (amount == null) return "";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(amount);
}

function formatFinalValueOpinion(reportData: Record<string, unknown>): string {
  const amount = formatFinalValueAmount(reportData.finalValue);
  const words = String(reportData.finalValueWords || "").trim();
  if (!amount) return words;
  const numeric = `(${amount} ر.س)`;
  return words ? `${numeric}${words}` : numeric;
}

function sanitizeForXml(text: string): string {
  return text
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .trim();
}

const WORD_TEMPLATE_VARIABLE_KEYS = [
  "reportTitle",
  "clientName",
  "reportIssueDate",
  "reportReference",
  "valuationMethod",
  "valuationPurpose",
  "valuationBasis",
  "valuationDate",
  "agreementDate",
  "inspectionDate",
  "assetSingularPlural",
  "clientActivity",
  "clientRepresentativeName",
  "clientRepresentativeRole",
  "intendedUsers",
  "assetSubjectDescription",
  "valuationBasisDefinition",
  "valuePremiseDefinition",
  "inspectionLocation",
  "inspectionMapUrl",
  "finalValueOpinion",
] as const;

type WordTemplateVariableKey = (typeof WORD_TEMPLATE_VARIABLE_KEYS)[number];

/**
 * Keep arbitrary template values as well as the legacy built-in keys.  A
 * company can legitimately use a placeholder such as `<<branchManager>>`;
 * filtering that key against a fixed whitelist makes custom
 * company templates impossible to merge.
 */
function sanitizeVariableOverrides(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 300)) {
    const safeKey = normalizeTemplateVariableName(key);
    if (!safeKey) continue;
    if (value != null && typeof value !== "string" && typeof value !== "number") continue;
    out[safeKey] = sanitizeForXml(String(value ?? "")).slice(0, 50_000);
  }
  return out;
}

function buildClientIdentity(reportData: Record<string, unknown>): string {
  return [
    String(reportData.clientLegalType || "").trim(),
    String(reportData.clientRepresentativeName || "").trim(),
    String(reportData.clientRepresentativeRole || "").trim(),
    String(reportData.intendedUsers || "").trim(),
  ]
    .filter(Boolean)
    .join(" — ");
}

function normalizeTemplateVariableName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim()
    .slice(0, 180);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStoredTemplateMappings(value: unknown): StoredTemplateVariableMapping[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const mappings: StoredTemplateVariableMapping[] = [];
  for (const row of value.slice(0, 300)) {
    const item = asRecord(row);
    if (!item) continue;
    const variable = normalizeTemplateVariableName(item.variable);
    const sourceKey = normalizeTemplateVariableName(item.sourceKey ?? item.source);
    if (!variable || !sourceKey || seen.has(variable)) continue;
    seen.add(variable);
    const staticValue =
      typeof item.staticValue === "string" || typeof item.staticValue === "number"
        ? sanitizeForXml(String(item.staticValue)).slice(0, 50_000)
        : undefined;
    mappings.push({ variable, sourceKey, ...(staticValue !== undefined ? { staticValue } : {}) });
  }
  return mappings;
}

function readExcludedTemplateVariableNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .slice(0, 300)
      .map(normalizeTemplateVariableName)
      .filter(Boolean),
  )];
}

const IMAGE_MARKER_SOURCE_KEYS = new Set(["images.asset", "images.valuation", "images.client"]);

function dynamicTemplateValues(
  baseValues: Record<string, string>,
  mappings: readonly StoredTemplateVariableMapping[],
): {
  textValues: Record<string, string>;
  assetImageMarkerVariables: string[];
  valuationImageMarkerVariables: string[];
  clientImageMarkerVariables: string[];
} {
  const values = { ...baseValues };
  const assetImageMarkerVariables: string[] = [];
  const valuationImageMarkerVariables: string[] = [];
  const clientImageMarkerVariables: string[] = [];
  for (const mapping of mappings) {
    // Keep marker text intact until the DOCX worker has measured its
    // actual position and inserted the matching image grid beneath it.
    if (IMAGE_MARKER_SOURCE_KEYS.has(mapping.sourceKey)) {
      delete values[mapping.variable];
      if (mapping.sourceKey === "images.asset") {
        assetImageMarkerVariables.push(mapping.variable);
      } else if (mapping.sourceKey === "images.valuation") {
        valuationImageMarkerVariables.push(mapping.variable);
      } else {
        clientImageMarkerVariables.push(mapping.variable);
      }
      continue;
    }
    // `field:<name>` safely selects an existing flattened report value (for
    // example a reportTextOverrides key); no arbitrary object path is read.
    const fieldKey = mapping.sourceKey.startsWith("field:")
      ? normalizeTemplateVariableName(mapping.sourceKey.slice("field:".length))
      : mapping.sourceKey;
    const value =
      mapping.sourceKey === "static"
        ? mapping.staticValue ?? ""
        : Object.prototype.hasOwnProperty.call(baseValues, fieldKey)
          ? baseValues[fieldKey] ?? ""
          : mapping.staticValue ?? "";
    values[mapping.variable] = sanitizeForXml(value).slice(0, 50_000);
  }
  return {
    textValues: values,
    assetImageMarkerVariables: [...new Set(assetImageMarkerVariables)],
    valuationImageMarkerVariables: [...new Set(valuationImageMarkerVariables)],
    clientImageMarkerVariables: [...new Set(clientImageMarkerVariables)],
  };
}

function buildTextValues(
  reportData: Record<string, unknown>,
  projectName: string,
  displayNumber?: unknown,
): Record<string, string> {
  const raw: Record<WordTemplateVariableKey, string> = {
    reportTitle: String(reportData.reportTitle || projectName || "").trim(),
    clientName: String(reportData.clientName || "").trim(),
    reportIssueDate: formatDateAr(reportData.reportIssueDate),
    reportReference: String(reportData.reportReference || displayNumber || "").trim(),
    valuationMethod: String(reportData.valuationMethod || "").trim(),
    valuationPurpose: String(reportData.valuationPurpose || "").trim(),
    valuationBasis: String(reportData.valuationBasis || "").trim(),
    valuationDate: formatDateAr(reportData.valuationDate),
    agreementDate: formatDateAr(reportData.agreementDate),
    inspectionDate: formatDateAr(reportData.inspectionDate),
    assetSingularPlural: String(reportData.assetSingularPlural || "أصل/أصول").trim(),
    clientActivity: String(reportData.clientActivity || "").trim(),
    clientRepresentativeName: String(reportData.clientRepresentativeName || "").trim(),
    clientRepresentativeRole: String(reportData.clientRepresentativeRole || "").trim(),
    intendedUsers: String(reportData.intendedUsers || "").trim(),
    assetSubjectDescription: String(
      reportData.assetSubjectDescription || "الات ومعدات واجهزة متنوعه",
    ).trim(),
    valuationBasisDefinition: String(reportData.valuationBasisDefinition || "").trim(),
    valuePremiseDefinition: String(reportData.valuePremiseDefinition || "").trim(),
    inspectionLocation: String(reportData.inspectionLocation || "").trim(),
    inspectionMapUrl: String(reportData.inspectionMapUrl || "").trim(),
    finalValueOpinion: formatFinalValueOpinion(reportData),
  };

  const out: Record<string, string> = {};
  for (const key of WORD_TEMPLATE_VARIABLE_KEYS) {
    const val = raw[key];
    out[key] = sanitizeForXml(val);
  }
  const numericDisplayNumber =
    typeof displayNumber === "number" && Number.isFinite(displayNumber)
      ? String(displayNumber)
      : "";
  const finalValueAmount = formatFinalValueAmount(reportData.finalValue);
  // This catalog deliberately includes more fields than any one company template.
  // It is the stable server-side source list used by per-company mappings.
  Object.assign(out, {
    projectName: sanitizeForXml(projectName),
    displayNumber: numericDisplayNumber,
    clientId: sanitizeForXml(String(reportData.clientId || "")),
    clientEmail: sanitizeForXml(String(reportData.clientEmail || "")),
    clientPhone: sanitizeForXml(String(reportData.clientPhone || "")),
    clientLegalType: sanitizeForXml(String(reportData.clientLegalType || "")),
    clientIdentity: sanitizeForXml(buildClientIdentity(reportData)),
    intendedUse: sanitizeForXml(String(reportData.intendedUse || "")),
    assetDetailedDescription: sanitizeForXml(String(reportData.assetDetailedDescription || "")),
    reportTypeLabel: sanitizeForXml(String(reportData.reportTypeLabel || "")),
    standardsVersion: sanitizeForXml(String(reportData.standardsVersion || "")),
    currencyLabel: sanitizeForXml(String(reportData.currencyLabel || "")),
    valuePremise: sanitizeForXml(String(reportData.valuePremise || "")),
    finalValue: finalValueAmount,
    finalValueAmount,
    finalValueWords: sanitizeForXml(String(reportData.finalValueWords || "")),
    valuationFirmName: sanitizeForXml(String(reportData.valuationFirmName || "")),
    valuationFirmLicense: sanitizeForXml(String(reportData.valuationFirmLicense || "")),
    valuationFirmAddress: sanitizeForXml(String(reportData.valuationFirmAddress || "")),
    leadValuerName: sanitizeForXml(String(reportData.leadValuerName || "")),
    leadValuerTitle: sanitizeForXml(String(reportData.leadValuerTitle || "")),
    leadValuerMembershipNo: sanitizeForXml(String(reportData.leadValuerMembershipNo || "")),
    scopeOfWorkDetails: sanitizeForXml(String(reportData.scopeOfWorkDetails || "")),
    useRestriction: sanitizeForXml(String(reportData.useRestriction || "")),
    externalSpecialistUse: sanitizeForXml(String(reportData.externalSpecialistUse || "")),
    esgConsiderations: sanitizeForXml(String(reportData.esgConsiderations || "")),
    informationSources: sanitizeForXml(String(reportData.informationSources || "")),
    methodologyRationale: sanitizeForXml(String(reportData.methodologyRationale || "")),
    costApproachDetails: sanitizeForXml(String(reportData.costApproachDetails || "")),
    importantAssumptions: sanitizeForXml(String(reportData.importantAssumptions || "")),
    generalAssumptions: sanitizeForXml(String(reportData.generalAssumptions || "")),
    specialAssumptions: sanitizeForXml(String(reportData.specialAssumptions || "")),
  });
  // Company report-data models store their extra values with stable field IDs.
  // Expose those IDs in the flat catalog so a mapping `field:<id>` works for
  // both old manually-added fields and model-defined fields.
  const customFieldValues: Record<string, string> = {};
  if (Array.isArray(reportData.customFields)) {
    for (const rawField of reportData.customFields.slice(0, 120)) {
      if (!rawField || typeof rawField !== "object") continue;
      const field = rawField as Record<string, unknown>;
      const key = normalizeTemplateVariableName(field.id);
      if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue;
      const value = field.value;
      customFieldValues[key] =
        typeof value === "string" || typeof value === "number"
          ? sanitizeForXml(String(value)).slice(0, 50_000)
          : "";
    }
  }
  return {
    ...out,
    ...customFieldValues,
    ...sanitizeVariableOverrides(reportData.reportTextOverrides),
  };
}

const REPORT_MANAGER_ROLE =
  "الإدارة التنفيذية وتعميد ومراجعة المخرجات النهائية";
const REPORT_PREPARER_ROLE = "إعداد التقرير";
const REPORT_INSPECTION_ROLE = "المعاينة";

function cleanReportText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

/** يمنع نهائياً استخدام رقم تسجيل الدخول/الهاتف كاسم داخل التقرير. */
function safeReportPersonName(value: unknown): string {
  const name = cleanReportText(value, 200);
  if (!name) return "";
  if (/[0-9\u0660-\u0669\u06f0-\u06f9]/.test(name)) return "";
  return /[A-Za-z\u00c0-\u024f\u0600-\u06ff]/.test(name) ? name : "";
}

function asObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  const text = cleanReportText(value, 100);
  return ObjectId.isValid(text) ? new ObjectId(text) : null;
}

function companyTemplateFilePath(
  fileUrl: unknown,
  extension: ".docx" | ".pptx",
  companyId: string | null,
): string | null {
  if (typeof fileUrl !== "string" || !fileUrl.trim() || !companyId) return null;
  const raw = fileUrl.trim().replace(/\\/g, "/");
  const lowercase = raw.toLowerCase();
  if (!lowercase.endsWith(extension)) return null;

  const resolveInside = (root: string, relative: string): string | null => {
    const base = path.resolve(root);
    const candidate = path.resolve(base, relative.replace(/^[/\\]+/, ""));
    return candidate === base || candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
  };

  const safeCompanyId = companyId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeCompanyId) return null;
  const companyPrefix = `/uploads/company-report-templates/${safeCompanyId}/`;
  if (!raw.startsWith(companyPrefix)) return null;
  return resolveInside(
    path.join(process.cwd(), "uploads", "company-report-templates", safeCompanyId),
    raw.slice(companyPrefix.length),
  );
}

function readStoredReportTeam(value: unknown): MvReportTeamMember[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: MvReportTeamMember[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = cleanReportText(row.id, 100);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: safeReportPersonName(row.name),
      title: cleanReportText(row.title, 200),
      membershipNo: cleanReportText(row.membershipNo, 100),
      role: cleanReportText(row.role, 500),
    });
    if (rows.length >= 12) break;
  }
  return rows;
}

@Injectable()
export class WordTemplateMergeService {
  private readonly logger = new Logger(WordTemplateMergeService.name);

  constructor(private readonly mvService: MachineValuationService) {}

  /**
   * Load only the configuration stored for the project's company.  The merge
   * endpoint accepts a catalogue id only as a selector; file references and
   * mappings always come from the owning company's stored configuration.
   */
  private async resolveCompanyWordTemplateConfiguration(
    projectCompanyId: unknown,
    ctx: MvAccessContext,
    requestedTemplateId?: string,
  ): Promise<CompanyTemplateConfiguration> {
    const companyId = asObjectId(projectCompanyId ?? ctx.companyId);
    if (!companyId) {
      return { companyId: null, template: null, mappings: [], excludedVariableNames: [] };
    }
    try {
      const db = await getMongoDb();
      const { companies } = getAuthCollections(db);
      const company = await companies.findOne({ _id: companyId });
      const reportDefaults = asRecord((company as unknown as Record<string, unknown> | null)?.reportDefaults);
      const topLevelMappings = asRecord(reportDefaults?.variableMappings)?.word;
      const topLevelExclusions = asRecord(reportDefaults?.excludedVariables)?.word;
      const templateRows = Array.isArray(reportDefaults?.wordTemplates)
        ? reportDefaults.wordTemplates.map(asRecord).filter((row): row is Record<string, unknown> => row != null)
        : [];
      const legacyTemplate = asRecord(reportDefaults?.wordTemplate);
      const templateData = requestedTemplateId
        ? templateRows.find((row) => cleanReportText(row.id, 120) === requestedTemplateId) ??
          (templateRows.length === 0 && legacyTemplate && (
            cleanReportText(legacyTemplate.id, 120) === requestedTemplateId ||
            (!cleanReportText(legacyTemplate.id, 120) && requestedTemplateId === "word-template-1")
          )
            ? legacyTemplate
            : null)
        : templateRows[0] ?? legacyTemplate;
      if (!templateData) {
        return {
          companyId: companyId.toString(),
          template: null,
          mappings: readStoredTemplateMappings(topLevelMappings),
          excludedVariableNames: readExcludedTemplateVariableNames(topLevelExclusions),
        };
      }
      const template: StoredCompanyDocumentTemplate = {
        id: typeof templateData.id === "string" ? templateData.id : undefined,
        fileName: typeof templateData.fileName === "string" ? templateData.fileName : undefined,
        fileUrl: typeof templateData.fileUrl === "string" ? templateData.fileUrl : null,
        gridFsFileId: typeof templateData.gridFsFileId === "string" ? templateData.gridFsFileId : null,
        variableMappings: templateData.variableMappings,
        excludedVariableNames: templateData.excludedVariableNames,
      };
      // Tolerate the short-lived pre-release storage shape while companies are
      // being migrated.  The canonical shape is template.variableMappings.
      return {
        companyId: companyId.toString(),
        template,
        mappings: readStoredTemplateMappings(template.variableMappings ?? topLevelMappings),
        excludedVariableNames: readExcludedTemplateVariableNames(
          template.excludedVariableNames ?? topLevelExclusions,
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Could not load company Word template configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        companyId: companyId.toString(),
        template: null,
        mappings: [],
        excludedVariableNames: [],
      };
    }
  }

  private async loadTemplateBufferFromGridFs(
    fileId: string,
    companyId: string | null,
  ): Promise<Buffer | null> {
    if (!companyId) return null;
    try {
      return await loadOwnedCompanyWordTemplateBufferFromGridFs(fileId, companyId);
    } catch (error) {
      this.logger.warn(
        `Could not load company template from GridFS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async loadConfiguredWordTemplate(
    config: CompanyTemplateConfiguration,
  ): Promise<Buffer | null> {
    const stored = config.template;
    if (stored?.gridFsFileId) {
      const buffer = await this.loadTemplateBufferFromGridFs(stored.gridFsFileId, config.companyId);
      if (buffer?.subarray(0, 2).toString("utf8") === "PK") return buffer;
    }
    const storedPath = companyTemplateFilePath(stored?.fileUrl, ".docx", config.companyId);
    if (storedPath && fs.existsSync(storedPath)) {
      try {
        const buffer = await fs.promises.readFile(storedPath);
        if (buffer.subarray(0, 2).toString("utf8") === "PK") return buffer;
      } catch (error) {
        this.logger.warn(`Could not read company Word template ${storedPath}: ${String(error)}`);
      }
    }
    return null;
  }

  private async resolveReportPreparers(
    reportData: Record<string, unknown>,
    projectCompanyId: unknown,
    ctx: MvAccessContext,
  ): Promise<DiskReportPreparer[]> {
    const companyId = asObjectId(projectCompanyId ?? ctx.companyId);
    if (!companyId) return [];

    try {
      const db = await getMongoDb();
      const { companies, users, userCompanyMemberships } = getAuthCollections(db);
      const [company, memberships] = await Promise.all([
        companies.findOne({ _id: companyId }),
        userCompanyMemberships.find({ companyId }).toArray(),
      ]);

      const eligibleMemberships = memberships.filter(
        (membership) =>
          membership.role === "company_admin" ||
          !Array.isArray(membership.productIds) ||
          membership.productIds.length === 0 ||
          membership.productIds.includes("machine-valuation"),
      );
      const membershipByUserId = new Map(
        eligibleMemberships.map((membership) => [
          membership.userId.toString(),
          membership,
        ]),
      );
      const managerMembership =
        eligibleMemberships.find((membership) => membership.role === "company_admin") ??
        memberships.find((membership) => membership.role === "company_admin");
      const managerId =
        managerMembership?.userId.toString() ??
        company?.adminUserId?.toString() ??
        "";

      const storedTeam = readStoredReportTeam(reportData.valuationTeam);
      const storedById = new Map(storedTeam.map((row) => [row.id, row]));
      const reportOnlyById = new Map(
        (Array.isArray(company?.reportOnlySignatories) ? company.reportOnlySignatories : [])
          .filter((row) => Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string")
          .map((row) => {
            const item = row as {
              id: string;
              name?: string;
              jobTitle?: string;
              membershipNo?: string;
              signatureImageDataUrl?: string | null;
            };
            return [String(item.id), item] as const;
          }),
      );

      const orderedIds: string[] = [];
      if (managerId) orderedIds.push(managerId);
      for (const row of storedTeam) {
        if (row.id === managerId || orderedIds.includes(row.id)) continue;
        // أعضاء الشركة أو معدّو التقارير فقط (بدون حساب دخول).
        if (!membershipByUserId.has(row.id) && !reportOnlyById.has(row.id)) continue;
        orderedIds.push(row.id);
      }

      const userObjectIds = orderedIds
        .map(asObjectId)
        .filter((value): value is ObjectId => value !== null);
      const userRows =
        userObjectIds.length > 0
          ? await users.find({ _id: { $in: userObjectIds } }).toArray()
          : [];
      const userById = new Map(userRows.map((user) => [user._id.toString(), user]));

      const preparers: DiskReportPreparer[] = [];
      let nonManagerIndex = 0;
      for (const entryId of orderedIds) {
        const reportOnly = reportOnlyById.get(entryId);
        if (reportOnly) {
          const stored = storedById.get(entryId);
          const reportRole =
            cleanReportText(stored?.role, 500) ||
            (nonManagerIndex === 0 ? REPORT_PREPARER_ROLE : REPORT_INSPECTION_ROLE);
          nonManagerIndex += 1;
          const signature =
            typeof reportOnly.signatureImageDataUrl === "string" &&
            reportOnly.signatureImageDataUrl.startsWith("data:image/")
              ? reportOnly.signatureImageDataUrl
              : "";
          preparers.push({
            userId: entryId,
            reportDisplayName:
              safeReportPersonName(reportOnly.name) ||
              safeReportPersonName(stored?.name),
            jobTitle:
              cleanReportText(reportOnly.jobTitle, 200) ||
              cleanReportText(stored?.title, 200),
            membershipNo:
              cleanReportText(reportOnly.membershipNo, 100) ||
              cleanReportText(stored?.membershipNo, 100),
            reportRole,
            signatureImageDataUrl: signature,
          });
          continue;
        }

        const user = userById.get(entryId);
        if (!user) continue;
        const isManager = entryId === managerId;
        if (!isManager && !membershipByUserId.has(entryId)) continue;
        const stored = storedById.get(entryId);
        const currentDisplayName = safeReportPersonName(user.valuationReportDisplayName);
        const legacyDisplayName = safeReportPersonName(user.username);
        const reportRole =
          cleanReportText(stored?.role, 500) ||
          (isManager
            ? REPORT_MANAGER_ROLE
            : nonManagerIndex === 0
              ? REPORT_PREPARER_ROLE
              : REPORT_INSPECTION_ROLE);
        if (!isManager) nonManagerIndex += 1;
        const signature =
          typeof user.valuationReportSignatureDataUrl === "string" &&
          user.valuationReportSignatureDataUrl.startsWith("data:image/")
            ? user.valuationReportSignatureDataUrl
            : "";
        preparers.push({
          userId: entryId,
          reportDisplayName:
            currentDisplayName ||
            safeReportPersonName(stored?.name) ||
            legacyDisplayName,
          jobTitle:
            cleanReportText(user.valuationReportJobTitle, 200) ||
            cleanReportText(stored?.title, 200),
          membershipNo:
            cleanReportText(user.valuationReportMembershipNo, 100) ||
            cleanReportText(stored?.membershipNo, 100),
          reportRole,
          signatureImageDataUrl: signature,
        });
      }
      return preparers.slice(0, 12);
    } catch (error) {
      this.logger.warn(
        `Could not resolve Word report preparers: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  async mergeAndRespond(
    projectId: string,
    ctx: MvAccessContext,
    body: {
      assetImageUrls?: string[];
      valuationImageUrls?: string[];
      clientImageUrls?: string[];
      assetImagesBase64?: string[];
      valuationImagesBase64?: string[];
      clientImagesBase64?: string[];
      textValues?: Record<string, string>;
      /** Selects one of the owning company's saved Word templates. */
      templateId?: string;
      /** عند true: يُرجع ZIP يحتوي Word + PDF محوّل من نفس الملف. */
      alsoPdf?: boolean;
      /** تجاهل نسخة الواجهة واقرأ أحدث بيانات وصور المشروع من قاعدة البيانات. */
      useStoredProjectState?: boolean;
      imageLayout?: {
        imagesPerRow?: number;
        imagesPerPage?: number;
        clientImagesPerRow?: number;
        clientImagesPerPage?: number;
        imageQuality?: number;
      };
    },
    res: Response,
  ): Promise<void> {
    const loaded = await this.mvService.getProject(projectId, ctx);
    const project = loaded.project;
    const useStoredProjectState = body.useStoredProjectState === true;
    const reportData = (project.reportData ?? {}) as Record<string, unknown>;
    const requestedTemplateId = cleanReportText(body.templateId, 120) ||
      cleanReportText(reportData.wordTemplateId, 120);
    const companyTemplateConfig = await this.resolveCompanyWordTemplateConfiguration(
      project.companyId,
      ctx,
      requestedTemplateId || undefined,
    );
    let templateBuffer = await this.loadConfiguredWordTemplate(companyTemplateConfig);
    if (!templateBuffer) {
      throw new BadRequestException(
        companyTemplateConfig.template
          ? "تعذر قراءة قالب Word المحفوظ لهذه الشركة. أعد رفع القالب من بيانات إعداد التقرير النهائي ثم أعد المحاولة."
          : requestedTemplateId
            ? "قالب Word المحدد لم يعد متاحاً لهذه الشركة. اختر قالباً آخر من صفحة التقرير النهائي."
          : "لم يتم إعداد قالب Word لهذه الشركة بعد. ارفع قالب Word من بيانات إعداد التقرير النهائي ثم أعد المحاولة.",
      );
    }
    this.logger.debug(`Using the saved company Word template for ${projectId}.`);

    const assetSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: useStoredProjectState ? undefined : body.assetImageUrls,
      base64List: useStoredProjectState ? undefined : body.assetImagesBase64,
      fallback: "assets",
    });
    const valuationSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: useStoredProjectState ? undefined : body.valuationImageUrls,
      base64List: useStoredProjectState ? undefined : body.valuationImagesBase64,
      fallback: "valuation",
      project,
    });
    const clientSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: useStoredProjectState ? undefined : body.clientImageUrls,
      base64List: useStoredProjectState ? undefined : body.clientImagesBase64,
      fallback: "client",
      project,
    });

    const imageCount = assetSources.length + valuationSources.length + clientSources.length;
    const imageLayout = sanitizeImageLayout({
      imagesPerRow: reportData.wordAssetImagesPerRow,
      clientImagesPerRow: reportData.clientDocumentsImagesPerRow,
      imageQuality: reportData.wordImageQuality,
      ...(body.imageLayout ?? {}),
    });
    const assetSettings = adaptiveAssetImageSettings(
      assetSources.length || imageCount,
      imageLayout.imageQuality,
    );
    const valuationSettings = valuationPrintImageSettings(imageLayout.imageQuality);
    const clientSettings = clientDocumentImageSettings(imageLayout.imageQuality);

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `mv-docx-${projectId.slice(-8)}-`));
    const templatePath = path.join(workDir, "template.docx");
    const outputPath = path.join(workDir, "output.docx");

    try {
      await fs.promises.writeFile(templatePath, templateBuffer);
      templateBuffer = null;

      const assetDir = path.join(workDir, "asset");
      const valuationDir = path.join(workDir, "valuation");
      const clientDir = path.join(workDir, "client");
      await fs.promises.mkdir(assetDir, { recursive: true });
      await fs.promises.mkdir(valuationDir, { recursive: true });
      await fs.promises.mkdir(clientDir, { recursive: true });

      const prepareStartedAt = Date.now();
      this.logger.log(
        `Preparing Word merge for ${projectId}: ${assetSources.length} asset, ${valuationSources.length} valuation, ${clientSources.length} client images (disk pipeline, asset≤${assetSettings.maxWidth}px, concurrency=${MV_MERGE_ASSET_FETCH_CONCURRENCY}/${MV_MERGE_PRINT_FETCH_CONCURRENCY})`,
      );

      const [assetImagePaths, valuationImagePaths, clientImagePaths, reportPreparers] = await Promise.all([
        this.materializeImagesToDisk(assetSources, assetDir, "a", assetSettings, projectId, ctx),
        this.materializeImagesToDisk(
          valuationSources,
          valuationDir,
          "v",
          valuationSettings,
          projectId,
          ctx,
        ),
        this.materializeImagesToDisk(clientSources, clientDir, "c", clientSettings, projectId, ctx),
        this.resolveReportPreparers(reportData, project.companyId, ctx),
      ]);
      this.logger.log(
        `Prepared Word images for ${projectId} in ${Date.now() - prepareStartedAt}ms (asset=${assetImagePaths.length}, valuation=${valuationImagePaths.length}, client=${clientImagePaths.length})`,
      );

      const storedTextValues = buildTextValues(
        reportData,
        project.name || "",
        project.displayNumber,
      );
      // وجود المفتاح في الطلب — حتى لو كانت قيمته فارغة — يتغلب على القيمة المخزنة.
      const requestTextValues = useStoredProjectState
        ? {}
        : sanitizeVariableOverrides(body.textValues);
      const configuredValues = dynamicTemplateValues(
        { ...storedTextValues, ...requestTextValues },
        companyTemplateConfig.mappings,
      );
      const textValues = configuredValues.textValues;
      // منع مسح عناوين الفهرس/المتن عندما تصل قيمة فارغة من الواجهة
      if (!String(textValues.assetSingularPlural || "").trim()) {
        textValues.assetSingularPlural =
          storedTextValues.assetSingularPlural || "أصل/أصول";
      }
      if (!String(textValues.assetSubjectDescription || "").trim()) {
        textValues.assetSubjectDescription =
          storedTextValues.assetSubjectDescription || "الات ومعدات واجهزة متنوعه";
      }

      const manifest: DiskMergeManifest = {
        templatePath,
        outputPath,
        textValues,
        excludedVariableNames: companyTemplateConfig.excludedVariableNames,
        assetImageMarkerVariables: configuredValues.assetImageMarkerVariables,
        valuationImageMarkerVariables: configuredValues.valuationImageMarkerVariables,
        clientImageMarkerVariables: configuredValues.clientImageMarkerVariables,
        assetImagePaths,
        valuationImagePaths,
        clientImagePaths,
        reportPreparers,
        imageLayout,
      };

      this.logger.log(
        `Merging Word for ${projectId}: ${assetImagePaths.length} asset, ${valuationImagePaths.length} valuation, ${clientImagePaths.length} client images, ${reportPreparers.length} report preparers`,
      );

      let mergeResult: MergeWorkerResult;
      try {
        mergeResult = await runDiskDocxMergeWorker(manifest, imageCount);
      } catch (err) {
        this.logger.error(`docx-worker failed: ${(err as Error).message}`);
        throw new BadRequestException(`تعذر دمج ملف Word: ${(err as Error).message}`);
      }

      const stats = mergeResult.stats;
      const imageWarnings: string[] = [];
      const appendImageWarning = (
        label: string,
        requested: number,
        inserted: number,
      ) => {
        if (inserted >= requested) return;
        imageWarnings.push(
          `${label}: تم إدراج ${inserted} من أصل ${requested} صورة.`,
        );
      };
      appendImageWarning(
        "صور الأصول",
        assetSources.length,
        stats.assetImagesInserted,
      );
      appendImageWarning(
        "صور حسابات القيمة",
        valuationSources.length,
        stats.valuationImagesInserted,
      );
      appendImageWarning(
        "صور ملفات العميل",
        clientSources.length,
        stats.clientImagesInserted,
      );
      if (imageWarnings.length > 0) {
        this.logger.warn(
          `Word merge completed with image warnings for ${projectId}: ${imageWarnings.join(" ")}`,
        );
      }
      const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
      const docxName = `${safeName}-merged-report.docx`;
      const pdfName = `${safeName}-merged-report.pdf`;
      res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
      if (imageWarnings.length > 0) {
        res.setHeader(
          "X-Word-Merge-Warnings",
          encodeURIComponent(JSON.stringify(imageWarnings)),
        );
      }

      res.setHeader(
        "Access-Control-Expose-Headers",
        [
          "Content-Disposition",
          "X-Word-Merge-Stats",
          "X-Word-Merge-Warnings",
          "X-Word-Merge-Pdf",
          "X-Word-Merge-Pdf-Token",
          "X-Word-Merge-Pdf-Error",
          "X-Word-Merge-Pdf-Available",
        ].join(", "),
      );

      const wantPdf = body.alsoPdf === true;
      if (wantPdf) {
        try {
          const pdfStartedAt = Date.now();
          const pdfPath = await convertDocxToPdf(mergeResult.outputPath, workDir, {
            timeoutMs: machineValuationPdfTimeoutMs(imageCount),
          });
          this.logger.log(
            `Word→PDF conversion completed for ${projectId} in ${Date.now() - pdfStartedAt}ms`,
          );
          const pdfToken = storePendingPdfExport({
            projectId,
            sourcePdfPath: pdfPath,
            fileName: pdfName,
          });
          res.setHeader("X-Word-Merge-Pdf", "1");
          res.setHeader("X-Word-Merge-Pdf-Token", pdfToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Word→PDF conversion failed for ${projectId}: ${msg}`);
          res.setHeader("X-Word-Merge-Pdf", "0");
          res.setHeader(
            "X-Word-Merge-Pdf-Error",
            encodeURIComponent(msg.slice(0, 300)),
          );
          // نكمل بتنزيل Word فقط حتى لا يفشل التصدير بالكامل
        }
      } else {
        res.setHeader(
          "X-Word-Merge-Pdf-Available",
          isDocxPdfConversionAvailable() ? "1" : "0",
        );
      }

      const fileStat = await fs.promises.stat(mergeResult.outputPath);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(docxName)}"`,
      );
      res.setHeader("Content-Length", String(fileStat.size));
      await pipeFileToResponse(mergeResult.outputPath, res);
    } finally {
      fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    }
  }

  /** تنزيل PDF جاهز من نفس عملية الدمج — ملف PDF منفصل بدون ZIP. */
  async respondWithPendingPdf(
    projectId: string,
    token: string,
    res: Response,
  ): Promise<void> {
    const row = getPendingPdfExport(projectId, token);
    if (!row) {
      throw new NotFoundException("انتهت صلاحية ملف PDF أو الرمز غير صالح. أعد تنزيل التقرير.");
    }
    if (!fs.existsSync(row.filePath)) {
      throw new NotFoundException("تعذر العثور على ملف PDF. أعد تنزيل التقرير.");
    }
    const fileStat = await fs.promises.stat(row.filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(row.fileName)}"`,
    );
    res.setHeader("Content-Length", String(fileStat.size));
    await pipeFileToResponse(row.filePath, res);
  }

  private async resolveImageSources(opts: {
    projectId: string;
    ctx: MvAccessContext;
    urls?: string[];
    base64List?: string[];
    fallback: "assets" | "valuation" | "client";
    project?: { _id?: unknown; valuationAccountingWorkspace?: unknown; clientDocumentsWorkspace?: unknown };
  }): Promise<ImageSource[]> {
    const fromBase64: ImageSource[] = [];
    for (const item of opts.base64List ?? []) {
      try {
        const buffer = Buffer.from(item, "base64");
        if (buffer.byteLength > 0) fromBase64.push({ kind: "buffer", buffer });
      } catch {
        /* skip invalid base64 */
      }
    }
    if (fromBase64.length > 0) return fromBase64;

    const trimmedUrls = (opts.urls ?? []).map((url) => url.trim()).filter(Boolean);
    if (trimmedUrls.length > 0) {
      return trimmedUrls.map((url) => ({ kind: "url" as const, url }));
    }

    // قائمة URLs فارغة (أو غير مُرسلة) → احتياطي الخادم.
    // الواجهة كانت ترسل [] عند فراغ المخزن المحلي فتُمنع صور مرفق 3 بالكامل.

    if (opts.fallback === "assets") {
      const fileIds = await this.listReportAssetFileIds(opts.projectId, opts.ctx);
      return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
    }
    if (opts.fallback === "valuation") {
      const fileIds = this.listWorkspaceImageFileIds(opts.project?.valuationAccountingWorkspace);
      return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
    }
    const fileIds = this.listWorkspaceImageFileIds(opts.project?.clientDocumentsWorkspace);
    this.logger.log(
      `Word merge client images fallback for ${opts.projectId}: ${fileIds.length} fileId(s) from workspace`,
    );
    return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
  }

  private async materializeImagesToDisk(
    sources: ImageSource[],
    destDir: string,
    prefix: string,
    settings: OptimizeImageSettings,
    projectId: string,
    ctx: MvAccessContext,
  ): Promise<string[]> {
    if (sources.length === 0) return [];
    const concurrency =
      settings.chromaSubsampling === "4:4:4"
        ? MV_MERGE_PRINT_FETCH_CONCURRENCY
        : MV_MERGE_ASSET_FETCH_CONCURRENCY;
    const paths = await mapWithConcurrency(sources, concurrency, async (source, index) => {
      try {
        const destPath = path.join(destDir, `${prefix}-${String(index + 1).padStart(5, "0")}.jpg`);
        const cachedPath = await this.getOrCreateOptimizedImageCacheFile(
          source,
          settings,
          projectId,
          ctx,
        );
        if (!cachedPath) return null;
        try {
          await fs.promises.link(cachedPath, destPath);
        } catch {
          await fs.promises.copyFile(cachedPath, destPath);
        }
        return destPath;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const name = err && typeof err === "object" && "name" in err ? String((err as { name?: unknown }).name) : "";
        if (name === "NoSuchKey" || /NoSuchKey|not found|404/i.test(msg)) {
          this.logger.warn(
            `Word merge skipped missing image ${prefix}-${index + 1} for ${projectId}: ${name || msg}`,
          );
        } else {
          this.logger.warn(
            `Word merge skipped image ${prefix}-${index + 1} for ${projectId}: ${msg}`,
          );
        }
        return null;
      }
    });
    return paths.filter((item): item is string => Boolean(item));
  }

  private async getOrCreateOptimizedImageCacheFile(
    source: ImageSource,
    settings: OptimizeImageSettings,
    projectId: string,
    ctx: MvAccessContext,
  ): Promise<string | null> {
    const cacheRoot = wordImageCacheRoot();
    await fs.promises.mkdir(cacheRoot, { recursive: true });
    scheduleWordImageCacheCleanup();
    const accessScope = `${ctx.companyId ?? ""}:${ctx.userId ?? "anonymous"}:${ctx.isSuperAdmin ? "1" : "0"}`;
    const key = optimizedImageCacheKey(projectId, source, settings, accessScope);
    const cachePath = path.join(cacheRoot, `${key}.jpg`);
    if (await cachedImageIsFresh(cachePath)) return cachePath;

    const running = wordImageCacheInflight.get(key);
    if (running) return running;

    const task = (async (): Promise<string | null> => {
      if (await cachedImageIsFresh(cachePath)) return cachePath;
      let buffer: Buffer | null = null;
      if (source.kind === "buffer") {
        buffer = source.buffer;
      } else if (source.kind === "fileId") {
        const download = await this.mvService.getProjectFileDownload(projectId, source.fileId, ctx);
        buffer = await bufferFromStream(download.stream);
      } else {
        buffer = await this.fetchImageBuffer(source.url, ctx);
      }
      if (!buffer || buffer.byteLength === 0) return null;

      const tempPath = path.join(cacheRoot, `${key}.${randomUUID()}.tmp`);
      try {
        const ok = await writeOptimizedJpegFile(buffer, tempPath, settings);
        buffer = null;
        if (!ok) return null;
        await fs.promises.rm(cachePath, { force: true });
        await fs.promises.rename(tempPath, cachePath);
        return cachePath;
      } finally {
        buffer = null;
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
      }
    })();
    wordImageCacheInflight.set(key, task);
    void task.then(
      () => {
        if (wordImageCacheInflight.get(key) === task) wordImageCacheInflight.delete(key);
      },
      () => {
        if (wordImageCacheInflight.get(key) === task) wordImageCacheInflight.delete(key);
      },
    );
    return task;
  }

  private async listReportAssetFileIds(projectId: string, ctx: MvAccessContext): Promise<string[]> {
    try {
      const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
      return files
        .filter((file) => {
          const mimeType = String(file.mimeType || "").toLowerCase();
          const extension = String(file.extension || "").toLowerCase();
          const isImage =
            !mimeType.startsWith("video/") &&
            (mimeType.startsWith("image/") ||
              ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"].includes(extension));
          return isImage && file.includeInReport === true;
        })
        .map((file) => String(file._id || "").trim())
        .filter(Boolean);
    } catch (err) {
      this.logger.warn(`Could not list asset images for Word merge: ${(err as Error).message}`);
      return [];
    }
  }

  private listWorkspaceImageFileIds(workspace: unknown): string[] {
    if (!workspace || typeof workspace !== "object") return [];
    const store = workspace as { includeInReport?: boolean; images?: unknown[] };
    if (store.includeInReport === false || !Array.isArray(store.images)) return [];
    return store.images
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { fileId?: unknown; includeInReport?: unknown };
        if (row.includeInReport === false) return "";
        return typeof row.fileId === "string" ? row.fileId.trim() : "";
      })
      .filter(Boolean);
  }

  private async fetchImageBuffer(url: string, ctx: MvAccessContext): Promise<Buffer | null> {
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
      const fileMatch = trimmed.match(
        /\/api\/mv\/projects\/([^/]+)\/files\/([^/?#]+)\/download/,
      );
      if (fileMatch) {
        const [, pid, fid] = fileMatch;
        const dl = await this.mvService.getProjectFileDownload(pid!, fid!, ctx);
        return bufferFromStream(dl.stream);
      }

      if (trimmed.startsWith("data:")) {
        const b64 = trimmed.split(",")[1];
        if (b64) return Buffer.from(b64, "base64");
      }

      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const res = await fetch(trimmed);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
      }
    } catch {
      return null;
    }
    return null;
  }
}
