import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { ObjectId } from "mongodb";
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

type MergePayload = {
  templateBase64: string;
  textValues: Record<string, string>;
  textByBookmarkName: Record<string, string>;
  assetImagesBase64: string[];
  valuationImagesBase64: string[];
  clientImagesBase64: string[];
  imageLayout: {
    imagesPerRow: number;
    imagesPerPage: number;
    clientImagesPerRow: number;
    clientImagesPerPage: number;
  };
};

function sanitizeImageLayout(value: unknown): MergePayload["imageLayout"] {
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

function findPythonBin(): string {
  const venvPaths = [
    path.join(process.cwd(), "docx-worker", "venv", "bin", "python"),
    path.join(process.cwd(), "docx-worker", "venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
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
  buffer: Buffer;
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

/**
 * حجم تقديري لحمولة الدمج بلا استدعاء `JSON.stringify` على الحمولة كاملة — استدعاء واحد
 * كهذا يبني سلسلة نصية واحدة ضخمة في الذاكرة، ومع مئات صور الأصول (Base64) تتجاوز حد
 * أقصى طول سلسلة في V8 فيرمي الاستدعاء نفسه استثناء `RangeError: Invalid string length`
 * قبل أن نتمكن حتى من قياس الطول — وهذا تحديداً ما كان يُفشل كل عمليات دمج/تنزيل Word
 * لمشاريع بها عدد كبير من الصور.
 */
function estimateMergePayloadSize(payload: MergePayload): number {
  let size = payload.templateBase64.length;
  for (const img of payload.assetImagesBase64) size += img.length;
  for (const img of payload.valuationImagesBase64) size += img.length;
  for (const img of payload.clientImagesBase64) size += img.length;
  return size;
}

function writeAsync(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = stream.write(chunk, "utf8", (err) => {
      if (err && !settled) {
        settled = true;
        reject(err);
      }
    });
    if (ok) {
      if (!settled) {
        settled = true;
        resolve();
      }
      return;
    }
    stream.once("drain", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

/**
 * يكتب حمولة الدمج كـ JSON مباشرة إلى `stream` تدريجياً — سلسلة/سلسلة، بدل بناء سلسلة
 * JSON واحدة ضخمة عبر `JSON.stringify(payload)` (انظر `estimateMergePayloadSize`). كل
 * استدعاء `JSON.stringify` هنا يُجرى على سلسلة واحدة (اسم حقل أو صورة واحدة) بعيداً كل
 * البعد عن حد الطول الأقصى، بصرف النظر عن عدد الصور الإجمالي في الحمولة.
 */
async function streamMergePayloadJson(payload: MergePayload, stream: NodeJS.WritableStream): Promise<void> {
  await writeAsync(stream, `{"templateBase64":${JSON.stringify(payload.templateBase64)}`);
  await writeAsync(stream, `,"textValues":${JSON.stringify(payload.textValues)}`);
  await writeAsync(stream, `,"textByBookmarkName":${JSON.stringify(payload.textByBookmarkName)}`);
  await writeAsync(stream, `,"imageLayout":${JSON.stringify(payload.imageLayout)}`);

  await writeAsync(stream, `,"assetImagesBase64":[`);
  for (let i = 0; i < payload.assetImagesBase64.length; i++) {
    await writeAsync(stream, `${i > 0 ? "," : ""}${JSON.stringify(payload.assetImagesBase64[i])}`);
  }
  await writeAsync(stream, `]`);

  await writeAsync(stream, `,"valuationImagesBase64":[`);
  for (let i = 0; i < payload.valuationImagesBase64.length; i++) {
    await writeAsync(stream, `${i > 0 ? "," : ""}${JSON.stringify(payload.valuationImagesBase64[i])}`);
  }
  await writeAsync(stream, `]`);

  await writeAsync(stream, `,"clientImagesBase64":[`);
  for (let i = 0; i < payload.clientImagesBase64.length; i++) {
    await writeAsync(stream, `${i > 0 ? "," : ""}${JSON.stringify(payload.clientImagesBase64[i])}`);
  }
  await writeAsync(stream, `]}`);
}

function closeWriteStream(stream: fs.WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
  });
}

/** مهلة دمج تتناسب مع عدد الصور — 180s كانت تقتل مشاريع بمئات الصور (exited null / SIGTERM). */
function mergeTimeoutMs(payload: MergePayload): number {
  const imageCount =
    payload.assetImagesBase64.length +
    payload.valuationImagesBase64.length +
    payload.clientImagesBase64.length;
  return Math.min(900_000, Math.max(180_000, 120_000 + imageCount * 1_500));
}

function spawnMergeOnce(payload: MergePayload): Promise<MergeWorkerResult> {
  const python = findPythonBin();
  const script = findMergeScriptPath();
  const estimatedSize = estimateMergePayloadSize(payload);
  const timeoutMs = mergeTimeoutMs(payload);
  const payloadPath =
    estimatedSize > 4_000_000
      ? path.join(os.tmpdir(), `mv-docx-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
      : null;

  const runChild = (args: string[]): Promise<MergeWorkerResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(python, args, {
        cwd: process.cwd(),
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.stderr.on("data", (d: Buffer) => errChunks.push(d));
      child.on("error", (err) => reject(new Error(`Python: ${err.message}`)));
      child.on("close", (code, signal) => {
        const stderr = Buffer.concat(errChunks).toString("utf8");
        if (stderr) console.log("[docx-worker]\n" + stderr);
        if (code !== 0) {
          const signalHint = signal ? ` signal=${signal}` : code == null ? " signal=unknown(killed)" : "";
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
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) {
          reject(new Error("docx-worker returned empty output"));
          return;
        }
        resolve({ buffer: buf, stats: parseWorkerStats(stderr) });
      });

      if (payloadPath) {
        // الحمولة كاملة موجودة في الملف الممرَّر كوسيط — لا حاجة لبايثون لقراءة stdin.
        child.stdin.end();
      } else {
        streamMergePayloadJson(payload, child.stdin)
          .then(() => child.stdin.end())
          .catch((err) => reject(new Error(`payload write failed: ${(err as Error).message}`)));
      }
    });

  if (!payloadPath) return runChild([script]);

  // يجب إنهاء كتابة الملف بالكامل قبل تشغيل بايثون، تماماً كما كان الحال مع الكتابة
  // المتزامنة السابقة (`fs.writeFileSync`) — الفرق الآن أن الكتابة تدريجية (سلسلة/سلسلة)
  // فلا تُبنى سلسلة JSON واحدة ضخمة في الذاكرة أولاً.
  const fileStream = fs.createWriteStream(payloadPath);
  return streamMergePayloadJson(payload, fileStream)
    .then(() => closeWriteStream(fileStream))
    .then(() => {
      // حرّر نسخ Node من الصور بعد كتابتها للقرص — يقلّل ضغط الذاكرة قبل تشغيل بايثون.
      payload.assetImagesBase64.length = 0;
      payload.valuationImagesBase64.length = 0;
      payload.clientImagesBase64.length = 0;
      payload.templateBase64 = "";
      return runChild([script, payloadPath]);
    })
    .finally(() => fs.unlink(payloadPath, () => undefined));
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

function installDocxWorkerDependencies(): Promise<boolean> {
  if (dependencyInstallPromise) return dependencyInstallPromise;
  dependencyInstallPromise = new Promise<boolean>((resolve) => {
    const python = findPythonBin();
    const workerDir = path.dirname(findMergeScriptPath());
    const requirementsPath = path.join(workerDir, "requirements.txt");
    if (!fs.existsSync(requirementsPath)) {
      resolve(false);
      return;
    }
    const child = spawn(
      python,
      ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", requirementsPath],
      { cwd: workerDir, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => chunks.push(d));
    child.on("error", (err) => {
      console.error(`[docx-worker] pip install failed to start: ${err.message}`);
      resolve(false);
    });
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) {
        console.log(`[docx-worker] dependencies installed via pip (${python}):\n${output.slice(-2000)}`);
        resolve(true);
      } else {
        console.error(`[docx-worker] pip install exited ${code}:\n${output.slice(-2000)}`);
        resolve(false);
      }
    });
  });
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
 * يشغّل عامل دمج Word، ويُحاول تلقائياً — مرة واحدة فقط — تثبيت متطلبات بايثون الناقصة
 * (‎lxml‎/‎Pillow‎/…) وإعادة الدمج إن فشلت المحاولة الأولى بسبب حزمة غير مثبَّتة، بدل
 * فشل كل عمليات تنزيل/تحديث ملفات Word حتى يتدخّل أحد يدوياً على الخادم.
 */
async function runDocxMergeWorker(payload: MergePayload): Promise<MergeWorkerResult> {
  return enqueueDocxMerge(async () => {
    try {
      return await spawnMergeOnce(payload);
    } catch (err) {
      const message = (err as Error).message || "";
      if (!isMissingPythonDependencyError(message)) throw err;
      console.warn(`[docx-worker] missing Python dependency detected, attempting auto-install: ${message}`);
      const installed = await installDocxWorkerDependencies();
      if (!installed) throw err;
      return spawnMergeOnce(payload);
    }
  });
}

/** يحدّ عدد تنزيلات صور الأصول المتوازية (GridFS/DigitalOcean) أثناء تجهيز دمج Word. */
const MV_MERGE_IMAGE_FETCH_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
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

    let assetImagesBase64: string[] = [...(body.assetImagesBase64 ?? [])];
    let valuationImagesBase64: string[] = [...(body.valuationImagesBase64 ?? [])];
    let clientImagesBase64: string[] = [...(body.clientImagesBase64 ?? [])];
    const assetImageUrlsProvided = Array.isArray(body.assetImageUrls);
    const valuationImageUrlsProvided = Array.isArray(body.valuationImageUrls);
    const clientImageUrlsProvided = Array.isArray(body.clientImageUrls);

    if (assetImagesBase64.length === 0 && (body.assetImageUrls?.length ?? 0) > 0) {
      const loaded = await mapWithConcurrency(
        body.assetImageUrls ?? [],
        MV_MERGE_IMAGE_FETCH_CONCURRENCY,
        (url) => this.fetchImageBuffer(url, ctx),
      );
      for (const buf of loaded) {
        if (buf) assetImagesBase64.push(buf.toString("base64"));
      }
    }
    // عند إرسال قائمة URLs (حتى لو فارغة) لا نرجع لكل صور المشروع — فقط المحددة للتقرير
    if (assetImagesBase64.length === 0 && !assetImageUrlsProvided) {
      assetImagesBase64 = await this.loadStoredAssetImagesBase64(projectId, ctx);
    }
    if (valuationImagesBase64.length === 0 && (body.valuationImageUrls?.length ?? 0) > 0) {
      const loaded = await mapWithConcurrency(
        body.valuationImageUrls ?? [],
        MV_MERGE_IMAGE_FETCH_CONCURRENCY,
        (url) => this.fetchImageBuffer(url, ctx),
      );
      for (const buf of loaded) {
        if (buf) valuationImagesBase64.push(buf.toString("base64"));
      }
    }
    if (valuationImagesBase64.length === 0 && !valuationImageUrlsProvided) {
      valuationImagesBase64 = await this.loadStoredValuationImagesBase64(project, ctx);
    }
    if (clientImagesBase64.length === 0 && (body.clientImageUrls?.length ?? 0) > 0) {
      const loaded = await mapWithConcurrency(
        body.clientImageUrls ?? [],
        MV_MERGE_IMAGE_FETCH_CONCURRENCY,
        (url) => this.fetchImageBuffer(url, ctx),
      );
      for (const buf of loaded) {
        if (buf) clientImagesBase64.push(buf.toString("base64"));
      }
    }
    if (clientImagesBase64.length === 0 && !clientImageUrlsProvided) {
      clientImagesBase64 = await this.loadStoredClientImagesBase64(project, ctx);
    }

    const storedTextValues = buildTextValues(reportData, project.name || "");
    const requestTextValues = sanitizeTextRecord(body.textValues, { dropEmpty: true });
    const textValues =
      Object.keys(requestTextValues).length > 0
        ? { ...storedTextValues, ...requestTextValues }
        : storedTextValues;
    const textByBookmarkName = sanitizeTextRecord(body.textByBookmarkName, { dropEmpty: true });
    const payload: MergePayload = {
      templateBase64: templateBuffer.toString("base64"),
      textValues,
      textByBookmarkName,
      assetImagesBase64,
      valuationImagesBase64,
      clientImagesBase64,
      imageLayout: sanitizeImageLayout(body.imageLayout),
    };

    this.logger.log(
      `Merging Word for ${projectId}: ${assetImagesBase64.length} asset, ${valuationImagesBase64.length} valuation, ${clientImagesBase64.length} client images`,
    );

    let mergeResult: MergeWorkerResult;
    try {
      mergeResult = await runDocxMergeWorker(payload);
    } catch (err) {
      this.logger.error(`docx-worker failed: ${(err as Error).message}`);
      throw new BadRequestException(`تعذر دمج ملف Word: ${(err as Error).message}`);
    }

    const { buffer: docxBuffer, stats } = mergeResult;
    const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(`${safeName}-updated-report.docx`)}"`,
    );
    res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
    res.end(docxBuffer);
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

  private async loadStoredAssetImagesBase64(projectId: string, ctx: MvAccessContext): Promise<string[]> {
    try {
      const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
      const reportImages = files.filter((file) => {
        const mimeType = String(file.mimeType || "").toLowerCase();
        const extension = String(file.extension || "").toLowerCase();
        const isImage =
          !mimeType.startsWith("video/") &&
          (mimeType.startsWith("image/") ||
            ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"].includes(extension));
        return isImage && file.includeInReport === true;
      });
      const loaded = await mapWithConcurrency(reportImages, MV_MERGE_IMAGE_FETCH_CONCURRENCY, async (file) => {
        try {
          const fileId = String(file._id || "").trim();
          if (!fileId) return null;
          const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
          const buffer = await bufferFromStream(download.stream);
          return buffer.byteLength > 0 ? buffer.toString("base64") : null;
        } catch {
          return null;
        }
      });
      return loaded.filter((item): item is string => Boolean(item));
    } catch (err) {
      this.logger.warn(`Could not load stored asset images for Word merge: ${(err as Error).message}`);
      return [];
    }
  }

  private async loadWorkspaceImagesBase64(
    projectId: string,
    workspace: unknown,
    ctx: MvAccessContext,
  ): Promise<string[]> {
    if (!workspace || typeof workspace !== "object") return [];
    const store = workspace as { includeInReport?: boolean; images?: unknown[] };
    if (store.includeInReport === false || !Array.isArray(store.images)) return [];
    const fileIds = store.images
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as { fileId?: unknown; includeInReport?: unknown };
        if (row.includeInReport === false) return "";
        return typeof row.fileId === "string" ? row.fileId.trim() : "";
      })
      .filter(Boolean);
    if (fileIds.length === 0) return [];
    const loaded = await mapWithConcurrency(fileIds, MV_MERGE_IMAGE_FETCH_CONCURRENCY, async (fileId) => {
      try {
        const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
        const buffer = await bufferFromStream(download.stream);
        return buffer.byteLength > 0 ? buffer.toString("base64") : null;
      } catch {
        return null;
      }
    });
    return loaded.filter((item): item is string => Boolean(item));
  }

  private async loadStoredValuationImagesBase64(
    project: { _id?: unknown; valuationAccountingWorkspace?: unknown },
    ctx: MvAccessContext,
  ): Promise<string[]> {
    const projectId = String(project._id ?? "").trim();
    if (!projectId) return [];
    try {
      return await this.loadWorkspaceImagesBase64(projectId, project.valuationAccountingWorkspace, ctx);
    } catch (err) {
      this.logger.warn(`Could not load valuation images for Word merge: ${(err as Error).message}`);
      return [];
    }
  }

  private async loadStoredClientImagesBase64(
    project: { _id?: unknown; clientDocumentsWorkspace?: unknown },
    ctx: MvAccessContext,
  ): Promise<string[]> {
    const projectId = String(project._id ?? "").trim();
    if (!projectId) return [];
    try {
      return await this.loadWorkspaceImagesBase64(projectId, project.clientDocumentsWorkspace, ctx);
    } catch (err) {
      this.logger.warn(`Could not load client document images for Word merge: ${(err as Error).message}`);
      return [];
    }
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
