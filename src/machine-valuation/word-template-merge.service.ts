import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { MachineValuationService } from "./machine-valuation.service";
import type { MvAccessContext } from "./types";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import {
  PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAMES,
  PRO_OPTION_BUNDLED_WORD_TEMPLATE_URLS,
  loadCompanyWordTemplateBufferFromGridFs,
  resolveCompanyReportDefaults,
} from "@/server/auth-tracking/service";
import { getMongoDb } from "@/server/mongodb";

type MergeImageLayout = {
  imagesPerRow: number;
  imagesPerPage: number;
  clientImagesPerRow: number;
  clientImagesPerPage: number;
};

/** حمولة الدمج عبر مسارات ملفات على القرص — تتحمّل آلاف الصور بلا Base64 في الذاكرة. */
type DiskMergeManifest = {
  templatePath: string;
  outputPath: string;
  textValues: Record<string, string>;
  textByBookmarkName: Record<string, string>;
  assetImagePaths: string[];
  valuationImagePaths: string[];
  clientImagePaths: string[];
  imageLayout: MergeImageLayout;
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
  const autoPerPage = safeImagesPerRow * (safeImagesPerRow >= 4 ? 5 : 4);
  const safeImagesPerPage =
    Number.isFinite(providedPerPage) && providedPerPage > 0
      ? Math.max(safeImagesPerRow, Math.min(60, providedPerPage))
      : autoPerPage;
  const clientRaw = Math.trunc(Number(input.clientImagesPerRow));
  const clientImagesPerRow =
    clientRaw === 1 || clientRaw === 2 || clientRaw === 3 ? clientRaw : 2;
  return {
    imagesPerRow: safeImagesPerRow,
    imagesPerPage: safeImagesPerPage,
    clientImagesPerRow,
    clientImagesPerPage: clientImagesPerRow * clientImagesPerRow,
  };
}

/** أبعاد/جودة تتقلّص تلقائياً مع ازدياد عدد الصور حتى تتحمل آلاف الصور على 4GB. */
function adaptiveImageSettings(imageCount: number): { maxSide: number; quality: number } {
  if (imageCount <= 80) return { maxSide: 1100, quality: 82 };
  if (imageCount <= 250) return { maxSide: 900, quality: 78 };
  if (imageCount <= 800) return { maxSide: 780, quality: 74 };
  if (imageCount <= 2000) return { maxSide: 680, quality: 70 };
  return { maxSide: 600, quality: 66 };
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
    textFilled: number;
    assetImagesInserted: number;
    valuationImagesInserted: number;
    clientImagesInserted: number;
    bookmarksFound: string[];
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
        textFilled: Number(parsed.textFilled ?? 0),
        assetImagesInserted: Number(parsed.assetImagesInserted ?? 0),
        valuationImagesInserted: Number(parsed.valuationImagesInserted ?? 0),
        clientImagesInserted: Number(parsed.clientImagesInserted ?? 0),
        bookmarksFound: Array.isArray(parsed.bookmarksFound) ? parsed.bookmarksFound.map(String) : [],
      };
    } catch {
      /* try next line */
    }
  }
  return {
    textFilled: 0,
    assetImagesInserted: 0,
    valuationImagesInserted: 0,
    clientImagesInserted: 0,
    bookmarksFound: [],
  };
}

function mergeTimeoutMs(imageCount: number): number {
  // حتى ~45 دقيقة لمشاريع بآلاف الصور — المهلة القديمة 180s كانت تقتل العامل (exited null).
  return Math.min(45 * 60_000, Math.max(240_000, 120_000 + imageCount * 900));
}

async function writeOptimizedJpegFile(
  input: Buffer,
  destPath: string,
  maxSide: number,
  quality: number,
): Promise<boolean> {
  try {
    await sharp(input)
      .rotate()
      .resize({
        width: maxSide,
        height: maxSide,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toFile(destPath);
    return true;
  } catch {
    try {
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

/** تنزيل/ضغط صور متوازي محدود — أعلى من ذلك يضغط الذاكرة على Droplet 4GB. */
const MV_MERGE_IMAGE_FETCH_CONCURRENCY = 3;

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

const COMPANY_REPORT_TEMPLATE_UPLOAD_PREFIX = "/uploads/company-report-templates/";

function bundledWordTemplateSearchDirs(): string[] {
  const cwd = process.cwd();
  const dirs = [
    path.resolve(cwd, "assets"),
    path.resolve(cwd, "public", "files"),
    path.resolve(cwd, "..", "Spark-Vision", "public", "files"),
    // من dist/machine-valuation → جذر الـ backend
    path.resolve(__dirname, "..", "..", "assets"),
    path.resolve(__dirname, "..", "..", "public", "files"),
    path.resolve(__dirname, "..", "..", "..", "Spark-Vision", "public", "files"),
  ];
  return [...new Set(dirs)];
}

function findBundledWordTemplateOnDisk(): string | null {
  for (const dir of bundledWordTemplateSearchDirs()) {
    for (const fileName of PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAMES) {
      const candidate = path.resolve(dir, fileName);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveBundledWordTemplatePath(uploadUrl?: string | null): string | null {
  const trimmed = (uploadUrl ?? "").trim();
  if (trimmed && !PRO_OPTION_BUNDLED_WORD_TEMPLATE_URLS.has(trimmed)) return null;
  return findBundledWordTemplateOnDisk();
}

function resolveCompanyWordTemplatePath(uploadUrl: string): string | null {
  const trimmed = uploadUrl.trim();
  const bundledPath = resolveBundledWordTemplatePath(trimmed);
  if (bundledPath) return bundledPath;
  if (!trimmed.startsWith(COMPANY_REPORT_TEMPLATE_UPLOAD_PREFIX) || !trimmed.toLowerCase().endsWith(".docx")) {
    return null;
  }
  const relative = trimmed.slice(COMPANY_REPORT_TEMPLATE_UPLOAD_PREFIX.length);
  if (!relative || relative.includes("..") || relative.includes("\\") || path.isAbsolute(relative)) {
    return null;
  }
  const baseDir = path.resolve(process.cwd(), "uploads", "company-report-templates");
  const fullPath = path.resolve(baseDir, relative);
  return fullPath.startsWith(baseDir + path.sep) ? fullPath : null;
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
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(amount);
}

function formatFinalValue(value: unknown, _currency?: string | null): string {
  // القالب يحتوي عادة على «ر.س.» بجانب إشارة «قيمة» — نملأ الرقم فقط لتفادي التكرار
  return formatFinalValueAmount(value);
}

function sanitizeForXml(text: string): string {
  return text
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .trim();
}

function sanitizeTextRecord(
  input: unknown,
  options: { dropEmpty?: boolean } = {},
): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const safeKey = sanitizeForXml(String(key));
    const safeValue = sanitizeForXml(String(value ?? ""));
    if (!safeKey || (options.dropEmpty && !safeValue)) continue;
    out[safeKey] = safeValue;
  }
  return out;
}

function buildTextValues(reportData: Record<string, unknown>, projectName: string): Record<string, string> {
  const clientIdentity = [
    reportData.clientLegalType,
    reportData.clientRepresentativeName,
    reportData.clientRepresentativeRole,
    reportData.intendedUsers,
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" — ");

  const raw: Record<string, string> = {
    reportTitle: String(reportData.reportTitle || projectName || "").trim(),
    clientName: String(reportData.clientName || "").trim(),
    clientIdentity,
    valuationBasis: String(reportData.valuationBasis || "").trim(),
    valuationPurpose: String(reportData.valuationPurpose || "").trim(),
    agreementDate: formatDateAr(reportData.agreementDate),
    reportIssueDate: formatDateAr(reportData.reportIssueDate),
    valuationDate: formatDateAr(reportData.valuationDate),
    inspectionDate: formatDateAr(reportData.inspectionDate),
    valuePremise: String(reportData.valuePremise || "").trim(),
    finalValue: formatFinalValue(reportData.finalValue, reportData.currencyLabel as string),
    finalValueAmount: formatFinalValueAmount(reportData.finalValue),
    finalValueWords: String(reportData.finalValueWords || "").trim(),
    inspectionLocation: String(reportData.inspectionLocation || "").trim(),
    inspectionMapUrl: String(reportData.inspectionMapUrl || "").trim(),
  };

  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    out[key] = sanitizeForXml(val);
  }
  return out;
}

@Injectable()
export class WordTemplateMergeService {
  private readonly logger = new Logger(WordTemplateMergeService.name);

  constructor(private readonly mvService: MachineValuationService) {}

  async mergeAndRespond(
    projectId: string,
    ctx: MvAccessContext,
    body: {
      templateFileId?: string;
      assetImageUrls?: string[];
      valuationImageUrls?: string[];
      clientImageUrls?: string[];
      assetImagesBase64?: string[];
      valuationImagesBase64?: string[];
      clientImagesBase64?: string[];
      textValues?: Record<string, string>;
      textByBookmarkName?: Record<string, string>;
      imageLayout?: {
        imagesPerRow?: number;
        imagesPerPage?: number;
        clientImagesPerRow?: number;
        clientImagesPerPage?: number;
      };
    },
    res: Response,
  ): Promise<void> {
    const loaded = await this.mvService.getProject(projectId, ctx);
    const project = loaded.project;
    const reportData = (project.reportData ?? {}) as Record<string, unknown>;
    const templateFileId =
      body.templateFileId?.trim() || String(reportData.wordReportTemplateFileId || "").trim();

    let templateBuffer: Buffer | null = null;
    if (templateFileId) {
      const download = await this.mvService.getProjectFileDownload(projectId, templateFileId, ctx);
      templateBuffer = await bufferFromStream(download.stream);
    } else {
      templateBuffer = await this.loadCompanyWordTemplateBuffer(project, ctx);
    }

    if (!templateBuffer) {
      throw new BadRequestException(
        "لم يُعثر على قالب Word المضمّن أو المرفوع. تأكد من وجود assets/mv-word-template.docx على السيرفر، أو ارفع قالباً من إعدادات الشركة ثم أعد المحاولة.",
      );
    }

    const assetSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.assetImageUrls,
      base64List: body.assetImagesBase64,
      urlsProvided: Array.isArray(body.assetImageUrls),
      fallback: "assets",
    });
    const valuationSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.valuationImageUrls,
      base64List: body.valuationImagesBase64,
      urlsProvided: Array.isArray(body.valuationImageUrls),
      fallback: "valuation",
      project,
    });
    const clientSources = await this.resolveImageSources({
      projectId,
      ctx,
      urls: body.clientImageUrls,
      base64List: body.clientImagesBase64,
      urlsProvided: Array.isArray(body.clientImageUrls),
      fallback: "client",
      project,
    });

    const imageCount = assetSources.length + valuationSources.length + clientSources.length;
    const assetSettings = adaptiveImageSettings(assetSources.length || imageCount);
    const valuationSettings = adaptiveImageSettings(Math.max(40, valuationSources.length));
    const clientSettings = adaptiveImageSettings(Math.max(40, clientSources.length));

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

      this.logger.log(
        `Preparing Word merge for ${projectId}: ${assetSources.length} asset, ${valuationSources.length} valuation, ${clientSources.length} client images (disk pipeline, maxSide≈${assetSettings.maxSide})`,
      );

      const [assetImagePaths, valuationImagePaths, clientImagePaths] = await Promise.all([
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
      ]);

      const storedTextValues = buildTextValues(reportData, project.name || "");
      const requestTextValues = sanitizeTextRecord(body.textValues, { dropEmpty: true });
      const textValues =
        Object.keys(requestTextValues).length > 0
          ? { ...storedTextValues, ...requestTextValues }
          : storedTextValues;
      const textByBookmarkName = sanitizeTextRecord(body.textByBookmarkName, { dropEmpty: true });

      const manifest: DiskMergeManifest = {
        templatePath,
        outputPath,
        textValues,
        textByBookmarkName,
        assetImagePaths,
        valuationImagePaths,
        clientImagePaths,
        imageLayout: sanitizeImageLayout(body.imageLayout),
      };

      this.logger.log(
        `Merging Word for ${projectId}: ${assetImagePaths.length} asset, ${valuationImagePaths.length} valuation, ${clientImagePaths.length} client images`,
      );

      let mergeResult: MergeWorkerResult;
      try {
        mergeResult = await runDiskDocxMergeWorker(manifest, imageCount);
      } catch (err) {
        this.logger.error(`docx-worker failed: ${(err as Error).message}`);
        throw new BadRequestException(`تعذر دمج ملف Word: ${(err as Error).message}`);
      }

      const stats = mergeResult.stats;
      const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
      const fileStat = await fs.promises.stat(mergeResult.outputPath);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(`${safeName}-updated-report.docx`)}"`,
      );
      res.setHeader("Content-Length", String(fileStat.size));
      res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
      await pipeFileToResponse(mergeResult.outputPath, res);
    } finally {
      fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    }
  }

  private async resolveImageSources(opts: {
    projectId: string;
    ctx: MvAccessContext;
    urls?: string[];
    base64List?: string[];
    urlsProvided: boolean;
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

    if ((opts.urls?.length ?? 0) > 0) {
      return (opts.urls ?? [])
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => ({ kind: "url" as const, url }));
    }

    // قائمة URLs فارغة صراحةً = لا صور من هذا النوع
    if (opts.urlsProvided) return [];

    if (opts.fallback === "assets") {
      const fileIds = await this.listReportAssetFileIds(opts.projectId, opts.ctx);
      return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
    }
    if (opts.fallback === "valuation") {
      const fileIds = this.listWorkspaceImageFileIds(opts.project?.valuationAccountingWorkspace);
      return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
    }
    const fileIds = this.listWorkspaceImageFileIds(opts.project?.clientDocumentsWorkspace);
    return fileIds.map((fileId) => ({ kind: "fileId" as const, fileId }));
  }

  private async materializeImagesToDisk(
    sources: ImageSource[],
    destDir: string,
    prefix: string,
    settings: { maxSide: number; quality: number },
    projectId: string,
    ctx: MvAccessContext,
  ): Promise<string[]> {
    if (sources.length === 0) return [];
    const paths = await mapWithConcurrency(sources, MV_MERGE_IMAGE_FETCH_CONCURRENCY, async (source, index) => {
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
        const ok = await writeOptimizedJpegFile(
          buffer,
          destPath,
          settings.maxSide,
          settings.quality,
        );
        buffer = null;
        return ok ? destPath : null;
      } catch {
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

  private resolveCompanyId(project: { companyId?: unknown }, ctx: MvAccessContext): ObjectId | null {
    const raw = project.companyId ?? ctx.companyId;
    if (raw instanceof ObjectId) return raw;
    if (typeof raw !== "string" || !raw.trim() || !ObjectId.isValid(raw.trim())) return null;
    return new ObjectId(raw.trim());
  }

  private async loadCompanyWordTemplateBuffer(
    project: { companyId?: unknown },
    ctx: MvAccessContext,
  ): Promise<Buffer | null> {
    const companyId = this.resolveCompanyId(project, ctx);
    if (!companyId) return null;
    const db = await getMongoDb();
    const { companies, users, userCompanyMemberships } = getAuthCollections(db);
    const company = await companies.findOne({ _id: companyId });
    const adminMembership = await userCompanyMemberships.findOne({ companyId, role: "company_admin" });
    const adminUserId = adminMembership?.userId ?? company?.adminUserId ?? null;
    const adminUser = adminUserId ? await users.findOne({ _id: adminUserId }) : null;
    const wordTemplate = resolveCompanyReportDefaults(company?.reportDefaults, {
      companyName: company?.name,
      adminPhone: adminUser?.phone,
      adminUsername: adminUser?.username,
    }).wordTemplate;

    // 1) GridFS أولاً (يعمل عبر السيرفرات ولا يعتمد على مجلد uploads المحلي)
    const gridFsId =
      typeof wordTemplate?.gridFsFileId === "string" ? wordTemplate.gridFsFileId.trim() : "";
    if (gridFsId) {
      const fromGrid = await loadCompanyWordTemplateBufferFromGridFs(gridFsId);
      if (fromGrid?.byteLength) return fromGrid;
    }

    // 2) ملف القرص المحلي من إعدادات الشركة (مفيد للتطوير وللسيرفر إن وُجد المجلد)
    const filePath = wordTemplate?.fileUrl ? resolveCompanyWordTemplatePath(wordTemplate.fileUrl) : null;
    if (filePath && fs.existsSync(filePath)) {
      return fs.promises.readFile(filePath);
    }

    // 3) القالب المضمّن في المشروع — يعمل محلياً وفي الـ deployment دون إعادة رفع
    const bundledPath = findBundledWordTemplateOnDisk();
    if (bundledPath) {
      if (wordTemplate?.fileUrl && !PRO_OPTION_BUNDLED_WORD_TEMPLATE_URLS.has(wordTemplate.fileUrl.trim())) {
        this.logger.warn(
          `Company Word template missing (url=${wordTemplate.fileUrl}, gridFs=${gridFsId || "none"}); falling back to bundled ${path.basename(bundledPath)} for company ${String(companyId)}`,
        );
      }
      return fs.promises.readFile(bundledPath);
    }

    if (wordTemplate?.fileUrl) {
      this.logger.warn(
        `Company Word template metadata exists (url=${wordTemplate.fileUrl}, gridFs=${gridFsId || "none"}) but file is missing on disk/GridFS for company ${String(companyId)}`,
      );
    }
    return null;
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
