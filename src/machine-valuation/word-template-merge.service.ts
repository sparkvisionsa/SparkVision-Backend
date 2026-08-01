import { Injectable, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import { getMongoDb } from "@/server/mongodb";
import { MachineValuationService } from "./machine-valuation.service";
import type { MvAccessContext, MvReportTeamMember } from "./types";
import { convertDocxToPdf, isLibreOfficeAvailable } from "./docx-to-pdf";

type PendingPdfExport = {
  projectId: string;
  filePath: string;
  fileName: string;
  expiresAt: number;
};

const pendingPdfExports = new Map<string, PendingPdfExport>();
const PDF_EXPORT_TTL_MS = 10 * 60_000;

function cleanupExpiredPdfExports() {
  const now = Date.now();
  for (const [token, row] of pendingPdfExports.entries()) {
    if (row.expiresAt > now) continue;
    pendingPdfExports.delete(token);
    fs.rm(row.filePath, { force: true }, () => undefined);
  }
}

function storePendingPdfExport(opts: {
  projectId: string;
  sourcePdfPath: string;
  fileName: string;
}): string {
  cleanupExpiredPdfExports();
  const token = randomUUID();
  const persistPath = path.join(os.tmpdir(), `mv-merge-pdf-${token}.pdf`);
  fs.copyFileSync(opts.sourcePdfPath, persistPath);
  pendingPdfExports.set(token, {
    projectId: opts.projectId,
    filePath: persistPath,
    fileName: opts.fileName,
    expiresAt: Date.now() + PDF_EXPORT_TTL_MS,
  });
  return token;
}

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
    maxWidth: 4800,
    maxHeight: 14000,
    quality,
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

const BUNDLED_WORD_TEMPLATE_FILE_NAME = "تقرير تقييم.docx";

function bundledWordTemplateCandidates(): string[] {
  const cwd = process.cwd();
  const candidates = [
    // المصدر المحلي الوحيد أثناء التطوير.
    path.resolve(cwd, "..", "Spark-Vision", "public", "files", BUNDLED_WORD_TEMPLATE_FILE_NAME),
    path.resolve(cwd, "Spark-Vision", "public", "files", BUNDLED_WORD_TEMPLATE_FILE_NAME),
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "Spark-Vision",
      "public",
      "files",
      BUNDLED_WORD_TEMPLATE_FILE_NAME,
    ),
    // نسخة النشر التي ينسخها Docker إلى /app/assets.
    path.resolve(cwd, "assets", BUNDLED_WORD_TEMPLATE_FILE_NAME),
    path.resolve(__dirname, "..", "..", "assets", BUNDLED_WORD_TEMPLATE_FILE_NAME),
  ];
  return [...new Set(candidates)];
}

function findBundledWordTemplateOnDisk(): string | null {
  for (const candidate of bundledWordTemplateCandidates()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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

const WORD_TEMPLATE_VARIABLE_KEY_SET = new Set<string>(WORD_TEMPLATE_VARIABLE_KEYS);

function sanitizeVariableOverrides(
  input: unknown,
): Partial<Record<WordTemplateVariableKey, string>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Partial<Record<WordTemplateVariableKey, string>> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!WORD_TEMPLATE_VARIABLE_KEY_SET.has(key)) continue;
    if (value != null && typeof value !== "string" && typeof value !== "number") continue;
    out[key as WordTemplateVariableKey] = sanitizeForXml(String(value ?? "")).slice(0, 50_000);
  }
  return out;
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
  return {
    ...out,
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
      /** عند true: يُرجع ZIP يحتوي Word + PDF محوّل من نفس الملف. */
      alsoPdf?: boolean;
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
    const reportData = (project.reportData ?? {}) as Record<string, unknown>;
    const sourceTemplatePath = findBundledWordTemplateOnDisk();
    if (!sourceTemplatePath) {
      throw new BadRequestException(
        "لم يُعثر على قالب Word الأساسي «تقرير تقييم.docx» في Spark-Vision/public/files أو assets على السيرفر.",
      );
    }
    let templateBuffer: Buffer | null = await fs.promises.readFile(sourceTemplatePath);
    this.logger.debug(`Using bundled Word template: ${sourceTemplatePath}`);

    const assetSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.assetImageUrls,
      base64List: body.assetImagesBase64,
      fallback: "assets",
    });
    const valuationSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.valuationImageUrls,
      base64List: body.valuationImagesBase64,
      fallback: "valuation",
      project,
    });
    const clientSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.clientImageUrls,
      base64List: body.clientImagesBase64,
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
      const requestTextValues = sanitizeVariableOverrides(body.textValues);
      const textValues = { ...storedTextValues, ...requestTextValues };
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

      const wantPdf = body.alsoPdf === true;
      if (wantPdf) {
        try {
          const pdfPath = await convertDocxToPdf(mergeResult.outputPath, workDir, {
            timeoutMs: Math.min(15 * 60_000, Math.max(180_000, imageCount * 1200)),
          });
          const pdfToken = storePendingPdfExport({
            projectId,
            sourcePdfPath: pdfPath,
            fileName: pdfName,
          });
          res.setHeader("X-Word-Merge-Pdf", "1");
          res.setHeader("X-Word-Merge-Pdf-Token", pdfToken);
          res.setHeader("Access-Control-Expose-Headers", [
            "Content-Disposition",
            "X-Word-Merge-Stats",
            "X-Word-Merge-Warnings",
            "X-Word-Merge-Pdf",
            "X-Word-Merge-Pdf-Token",
            "X-Word-Merge-Pdf-Error",
            "X-Word-Merge-Pdf-Available",
          ].join(", "));
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
          isLibreOfficeAvailable() ? "1" : "0",
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
    cleanupExpiredPdfExports();
    const row = pendingPdfExports.get(token);
    if (!row || row.projectId !== projectId) {
      throw new NotFoundException("انتهت صلاحية ملف PDF أو الرمز غير صالح. أعد تنزيل التقرير.");
    }
    if (!fs.existsSync(row.filePath)) {
      pendingPdfExports.delete(token);
      throw new NotFoundException("تعذر العثور على ملف PDF. أعد تنزيل التقرير.");
    }
    const fileStat = await fs.promises.stat(row.filePath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(row.fileName)}"`,
    );
    res.setHeader("Content-Length", String(fileStat.size));
    try {
      await pipeFileToResponse(row.filePath, res);
    } finally {
      pendingPdfExports.delete(token);
      fs.rm(row.filePath, { force: true }, () => undefined);
    }
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
        const destPath = path.join(destDir, `${prefix}-${String(index + 1).padStart(5, "0")}.jpg`);
        const ok = await writeOptimizedJpegFile(buffer, destPath, settings);
        buffer = null;
        return ok ? destPath : null;
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
