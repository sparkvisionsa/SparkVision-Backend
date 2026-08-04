"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var WordTemplateMergeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WordTemplateMergeService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const mongodb_1 = require("mongodb");
const sharp_1 = __importDefault(require("sharp"));
const collections_1 = require("../server/auth-tracking/collections");
const mongodb_2 = require("../server/mongodb");
const machine_valuation_service_1 = require("./machine-valuation.service");
const docx_to_pdf_1 = require("./docx-to-pdf");
const pendingPdfExports = new Map();
const PDF_EXPORT_TTL_MS = 10 * 60_000;
function cleanupExpiredPdfExports() {
    const now = Date.now();
    for (const [token, row] of pendingPdfExports.entries()) {
        if (row.expiresAt > now)
            continue;
        pendingPdfExports.delete(token);
        fs.rm(row.filePath, { force: true }, () => undefined);
    }
}
function storePendingPdfExport(opts) {
    cleanupExpiredPdfExports();
    const token = (0, crypto_1.randomUUID)();
    const persistPath = path.join(os.tmpdir(), `mv-merge-pdf-${token}.pdf`);
    try {
        fs.renameSync(opts.sourcePdfPath, persistPath);
    }
    catch {
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
function sanitizeImageLayout(value) {
    const input = value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    const imagesPerRow = Math.trunc(Number(input.imagesPerRow));
    const safeImagesPerRow = Number.isFinite(imagesPerRow)
        ? Math.max(1, Math.min(6, imagesPerRow))
        : 4;
    const providedPerPage = Math.trunc(Number(input.imagesPerPage));
    const autoPerPage = safeImagesPerRow <= 1
        ? 2
        : safeImagesPerRow === 2
            ? 4
            : safeImagesPerRow * (safeImagesPerRow >= 4 ? 5 : 4);
    const safeImagesPerPage = safeImagesPerRow <= 2
        ? autoPerPage
        : Number.isFinite(providedPerPage) && providedPerPage > 0
            ? Math.max(safeImagesPerRow, Math.min(60, providedPerPage))
            : autoPerPage;
    const clientRaw = Math.trunc(Number(input.clientImagesPerRow));
    const clientImagesPerRow = clientRaw === 1 || clientRaw === 2 || clientRaw === 3 ? clientRaw : 2;
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
const WORD_IMAGE_CACHE_VERSION = "v1";
const WORD_IMAGE_CACHE_TTL_MS = 6 * 60 * 60_000;
const WORD_IMAGE_CACHE_CLEANUP_INTERVAL_MS = 60 * 60_000;
const wordImageCacheInflight = new Map();
let lastWordImageCacheCleanupAt = 0;
function wordImageCacheRoot() {
    return path.join(os.tmpdir(), "mv-word-image-cache");
}
function imageSourceIdentity(source) {
    if (source.kind === "fileId")
        return `file:${source.fileId}`;
    if (source.kind === "url")
        return `url:${source.url}`;
    return `buffer:${(0, crypto_1.createHash)("sha256").update(source.buffer).digest("hex")}`;
}
function optimizedImageCacheKey(projectId, source, settings, accessScope) {
    return (0, crypto_1.createHash)("sha256")
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
async function cachedImageIsFresh(filePath) {
    try {
        const stat = await fs.promises.stat(filePath);
        return stat.size > 32 && Date.now() - stat.mtimeMs <= WORD_IMAGE_CACHE_TTL_MS;
    }
    catch {
        return false;
    }
}
function scheduleWordImageCacheCleanup() {
    const now = Date.now();
    if (now - lastWordImageCacheCleanupAt < WORD_IMAGE_CACHE_CLEANUP_INTERVAL_MS)
        return;
    lastWordImageCacheCleanupAt = now;
    const root = wordImageCacheRoot();
    void fs.promises
        .readdir(root, { withFileTypes: true })
        .then(async (entries) => {
        await Promise.all(entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jpg"))
            .map(async (entry) => {
            const filePath = path.join(root, entry.name);
            try {
                const stat = await fs.promises.stat(filePath);
                if (now - stat.mtimeMs > WORD_IMAGE_CACHE_TTL_MS) {
                    await fs.promises.rm(filePath, { force: true });
                }
            }
            catch {
            }
        }));
    })
        .catch(() => undefined);
}
function adaptiveAssetImageSettings(imageCount, quality) {
    const qualityCeiling = imageCount <= 80 ? 92 : imageCount <= 250 ? 86 : imageCount <= 800 ? 80 : imageCount <= 2000 ? 76 : 70;
    const effectiveQuality = Math.min(quality, qualityCeiling);
    if (imageCount <= 80)
        return { maxWidth: 1000, maxHeight: 1000, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
    if (imageCount <= 250)
        return { maxWidth: 820, maxHeight: 820, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
    if (imageCount <= 800)
        return { maxWidth: 720, maxHeight: 720, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
    if (imageCount <= 2000)
        return { maxWidth: 640, maxHeight: 640, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
    return { maxWidth: 560, maxHeight: 560, quality: effectiveQuality, chromaSubsampling: "4:2:0" };
}
function valuationPrintImageSettings(quality) {
    return {
        maxWidth: 6000,
        maxHeight: 18000,
        quality: Math.max(98, quality),
        chromaSubsampling: "4:4:4",
    };
}
function clientDocumentImageSettings(quality) {
    return {
        maxWidth: 4800,
        maxHeight: 14000,
        quality: Math.max(quality, 92),
        chromaSubsampling: "4:4:4",
    };
}
function findDocxWorkerVenvPython() {
    const venvPaths = [
        path.join(process.cwd(), "docx-worker", "venv", "bin", "python"),
        path.join(process.cwd(), "docx-worker", "venv", "Scripts", "python.exe"),
    ];
    for (const p of venvPaths) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
function findPythonBin() {
    const dedicated = findDocxWorkerVenvPython();
    if (dedicated)
        return dedicated;
    const fallbacks = [
        path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
        path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
    ];
    for (const p of fallbacks) {
        if (fs.existsSync(p))
            return p;
    }
    return process.platform === "win32" ? "python" : "python3";
}
function systemPythonBin() {
    return process.platform === "win32" ? "python" : "python3";
}
function findMergeScriptPath() {
    const candidates = [
        path.join(process.cwd(), "docx-worker", "merge_docx.py"),
        path.join(__dirname, "../../docx-worker/merge_docx.py"),
        path.join(__dirname, "../../../docx-worker/merge_docx.py"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    throw new Error("merge_docx.py not found in docx-worker/");
}
function parseWorkerStats(stderr) {
    const lines = stderr.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{"))
            continue;
        try {
            const parsed = JSON.parse(trimmed);
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
        }
        catch {
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
function mergeTimeoutMs(imageCount) {
    return Math.min(45 * 60_000, Math.max(240_000, 120_000 + imageCount * 900));
}
async function writeOptimizedJpegFile(input, destPath, settings) {
    const isPrintImage = settings.chromaSubsampling === "4:4:4";
    try {
        let pipeline = (0, sharp_1.default)(input, { failOn: "none", sequentialRead: true }).rotate();
        if (isPrintImage) {
            pipeline = pipeline.toColourspace("srgb");
        }
        await pipeline
            .resize({
            width: settings.maxWidth,
            height: settings.maxHeight,
            fit: isPrintImage ? "inside" : "fill",
            withoutEnlargement: true,
            kernel: isPrintImage ? sharp_1.default.kernel.lanczos3 : sharp_1.default.kernel.cubic,
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
    }
    catch {
        try {
            await fs.promises.writeFile(destPath, input);
            return true;
        }
        catch {
            return false;
        }
    }
}
function spawnDiskMergeOnce(manifest, timeoutMs) {
    const python = findPythonBin();
    const script = findMergeScriptPath();
    const manifestPath = path.join(path.dirname(manifest.outputPath), "manifest.json");
    return fs.promises
        .writeFile(manifestPath, JSON.stringify(manifest), "utf8")
        .then(() => new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(python, [script, manifestPath], {
            cwd: process.cwd(),
            timeout: timeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...process.env,
                PYTHONUNBUFFERED: "1",
            },
        });
        const errChunks = [];
        child.stderr.on("data", (d) => errChunks.push(d));
        child.on("error", (err) => reject(new Error(`Python: ${err.message}`)));
        child.on("close", (code, signal) => {
            const stderr = Buffer.concat(errChunks).toString("utf8");
            if (stderr)
                console.log("[docx-worker]\n" + stderr);
            if (code !== 0) {
                const signalHint = signal
                    ? ` signal=${signal}`
                    : code == null
                        ? " signal=unknown(killed)"
                        : "";
                const timeoutHint = signal === "SIGTERM" || signal === "SIGKILL"
                    ? ` (likely timeout ${timeoutMs}ms or OOM)`
                    : "";
                reject(new Error(`docx-worker exited ${code}${signalHint}${timeoutHint}: ${stderr.slice(0, 500)}`));
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
    }));
}
function pipeFileToResponse(filePath, res) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
        let settled = false;
        const done = (err) => {
            if (settled)
                return;
            settled = true;
            if (err)
                reject(err);
            else
                resolve();
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
function isMissingPythonDependencyError(message) {
    return /ModuleNotFoundError|No module named|ImportError/i.test(message);
}
let dependencyInstallPromise = null;
function runProcess(command, args, options) {
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: options.cwd,
            timeout: options.timeout ?? 180_000,
            stdio: ["ignore", "pipe", "pipe"],
        });
        const chunks = [];
        child.stdout.on("data", (d) => chunks.push(d));
        child.stderr.on("data", (d) => chunks.push(d));
        child.on("error", (err) => {
            resolve({ code: 1, output: err.message });
        });
        child.on("close", (code) => {
            resolve({ code, output: Buffer.concat(chunks).toString("utf8") });
        });
    });
}
async function ensureDocxWorkerVenv() {
    const existing = findDocxWorkerVenvPython();
    if (existing)
        return existing;
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
function installDocxWorkerDependencies() {
    if (dependencyInstallPromise)
        return dependencyInstallPromise;
    dependencyInstallPromise = (async () => {
        const workerDir = path.dirname(findMergeScriptPath());
        const requirementsPath = path.join(workerDir, "requirements.txt");
        if (!fs.existsSync(requirementsPath))
            return false;
        const python = (await ensureDocxWorkerVenv()) ?? findPythonBin();
        const result = await runProcess(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", requirementsPath], { cwd: workerDir, timeout: 300_000 });
        if (result.code === 0) {
            console.log(`[docx-worker] dependencies installed via pip (${python}):\n${result.output.slice(-2000)}`);
            return true;
        }
        console.error(`[docx-worker] pip install exited ${result.code}:\n${result.output.slice(-2000)}`);
        return false;
    })();
    return dependencyInstallPromise;
}
let mergeQueueTail = Promise.resolve();
function enqueueDocxMerge(task) {
    const run = mergeQueueTail.then(task, task);
    mergeQueueTail = run.then(() => undefined, () => undefined);
    return run;
}
async function runDiskDocxMergeWorker(manifest, imageCount) {
    return enqueueDocxMerge(async () => {
        const timeoutMs = mergeTimeoutMs(imageCount);
        try {
            return await spawnDiskMergeOnce(manifest, timeoutMs);
        }
        catch (err) {
            const message = err.message || "";
            if (!isMissingPythonDependencyError(message))
                throw err;
            console.warn(`[docx-worker] missing Python dependency detected, attempting auto-install: ${message}`);
            const installed = await installDocxWorkerDependencies();
            if (!installed)
                throw err;
            return spawnDiskMergeOnce(manifest, timeoutMs);
        }
    });
}
const MV_MERGE_ASSET_FETCH_CONCURRENCY = Math.max(8, Math.min(24, typeof os.cpus === "function" ? os.cpus().length * 3 : 8));
const MV_MERGE_PRINT_FETCH_CONCURRENCY = Math.max(4, Math.min(10, MV_MERGE_ASSET_FETCH_CONCURRENCY));
async function mapWithConcurrency(items, limit, fn) {
    if (items.length === 0)
        return [];
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        for (;;) {
            const i = nextIndex++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
    return results;
}
function bufferFromStream(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (c) => chunks.push(c));
        stream.on("error", reject);
        stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
}
const BUNDLED_WORD_TEMPLATE_FILE_NAME = "تقرير تقييم.docx";
function bundledWordTemplateCandidates() {
    const cwd = process.cwd();
    const candidates = [
        path.resolve(cwd, "..", "Spark-Vision", "public", "files", BUNDLED_WORD_TEMPLATE_FILE_NAME),
        path.resolve(cwd, "Spark-Vision", "public", "files", BUNDLED_WORD_TEMPLATE_FILE_NAME),
        path.resolve(__dirname, "..", "..", "..", "Spark-Vision", "public", "files", BUNDLED_WORD_TEMPLATE_FILE_NAME),
        path.resolve(cwd, "assets", BUNDLED_WORD_TEMPLATE_FILE_NAME),
        path.resolve(__dirname, "..", "..", "assets", BUNDLED_WORD_TEMPLATE_FILE_NAME),
    ];
    return [...new Set(candidates)];
}
function findBundledWordTemplateOnDisk() {
    for (const candidate of bundledWordTemplateCandidates()) {
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
function formatDateAr(value) {
    if (value == null)
        return "";
    const raw = typeof value === "string" ? value.trim() : "";
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = value instanceof Date
        ? value
        : typeof value === "number"
            ? new Date(value)
            : iso
                ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
                : new Date(raw);
    if (Number.isNaN(date.getTime()))
        return raw;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getFullYear()}`;
}
function coerceFiniteNumber(value) {
    if (typeof value === "number")
        return Number.isFinite(value) ? value : null;
    if (typeof value !== "string")
        return null;
    const normalized = value
        .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
        .replace(/[^\d.-]/g, "");
    if (!normalized.trim())
        return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}
function formatFinalValueAmount(value) {
    const amount = coerceFiniteNumber(value);
    if (amount == null)
        return "";
    return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0,
        useGrouping: true,
    }).format(amount);
}
function formatFinalValueOpinion(reportData) {
    const amount = formatFinalValueAmount(reportData.finalValue);
    const words = String(reportData.finalValueWords || "").trim();
    if (!amount)
        return words;
    const numeric = `(${amount} ر.س)`;
    return words ? `${numeric}${words}` : numeric;
}
function sanitizeForXml(text) {
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
];
const WORD_TEMPLATE_VARIABLE_KEY_SET = new Set(WORD_TEMPLATE_VARIABLE_KEYS);
function sanitizeVariableOverrides(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (!WORD_TEMPLATE_VARIABLE_KEY_SET.has(key))
            continue;
        if (value != null && typeof value !== "string" && typeof value !== "number")
            continue;
        out[key] = sanitizeForXml(String(value ?? "")).slice(0, 50_000);
    }
    return out;
}
function buildTextValues(reportData, projectName, displayNumber) {
    const raw = {
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
        assetSubjectDescription: String(reportData.assetSubjectDescription || "الات ومعدات واجهزة متنوعه").trim(),
        valuationBasisDefinition: String(reportData.valuationBasisDefinition || "").trim(),
        valuePremiseDefinition: String(reportData.valuePremiseDefinition || "").trim(),
        inspectionLocation: String(reportData.inspectionLocation || "").trim(),
        inspectionMapUrl: String(reportData.inspectionMapUrl || "").trim(),
        finalValueOpinion: formatFinalValueOpinion(reportData),
    };
    const out = {};
    for (const key of WORD_TEMPLATE_VARIABLE_KEYS) {
        const val = raw[key];
        out[key] = sanitizeForXml(val);
    }
    return {
        ...out,
        ...sanitizeVariableOverrides(reportData.reportTextOverrides),
    };
}
const REPORT_MANAGER_ROLE = "الإدارة التنفيذية وتعميد ومراجعة المخرجات النهائية";
const REPORT_PREPARER_ROLE = "إعداد التقرير";
const REPORT_INSPECTION_ROLE = "المعاينة";
function cleanReportText(value, maxLength) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function safeReportPersonName(value) {
    const name = cleanReportText(value, 200);
    if (!name)
        return "";
    if (/[0-9\u0660-\u0669\u06f0-\u06f9]/.test(name))
        return "";
    return /[A-Za-z\u00c0-\u024f\u0600-\u06ff]/.test(name) ? name : "";
}
function asObjectId(value) {
    if (value instanceof mongodb_1.ObjectId)
        return value;
    const text = cleanReportText(value, 100);
    return mongodb_1.ObjectId.isValid(text) ? new mongodb_1.ObjectId(text) : null;
}
function readStoredReportTeam(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const rows = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            continue;
        const row = item;
        const id = cleanReportText(row.id, 100);
        if (!id || seen.has(id))
            continue;
        seen.add(id);
        rows.push({
            id,
            name: safeReportPersonName(row.name),
            title: cleanReportText(row.title, 200),
            membershipNo: cleanReportText(row.membershipNo, 100),
            role: cleanReportText(row.role, 500),
        });
        if (rows.length >= 12)
            break;
    }
    return rows;
}
let WordTemplateMergeService = WordTemplateMergeService_1 = class WordTemplateMergeService {
    constructor(mvService) {
        this.mvService = mvService;
        this.logger = new common_1.Logger(WordTemplateMergeService_1.name);
    }
    async resolveReportPreparers(reportData, projectCompanyId, ctx) {
        const companyId = asObjectId(projectCompanyId ?? ctx.companyId);
        if (!companyId)
            return [];
        try {
            const db = await (0, mongodb_2.getMongoDb)();
            const { companies, users, userCompanyMemberships } = (0, collections_1.getAuthCollections)(db);
            const [company, memberships] = await Promise.all([
                companies.findOne({ _id: companyId }),
                userCompanyMemberships.find({ companyId }).toArray(),
            ]);
            const eligibleMemberships = memberships.filter((membership) => membership.role === "company_admin" ||
                !Array.isArray(membership.productIds) ||
                membership.productIds.length === 0 ||
                membership.productIds.includes("machine-valuation"));
            const membershipByUserId = new Map(eligibleMemberships.map((membership) => [
                membership.userId.toString(),
                membership,
            ]));
            const managerMembership = eligibleMemberships.find((membership) => membership.role === "company_admin") ??
                memberships.find((membership) => membership.role === "company_admin");
            const managerId = managerMembership?.userId.toString() ??
                company?.adminUserId?.toString() ??
                "";
            const storedTeam = readStoredReportTeam(reportData.valuationTeam);
            const storedById = new Map(storedTeam.map((row) => [row.id, row]));
            const reportOnlyById = new Map((Array.isArray(company?.reportOnlySignatories) ? company.reportOnlySignatories : [])
                .filter((row) => Boolean(row) && typeof row === "object" && typeof row.id === "string")
                .map((row) => {
                const item = row;
                return [String(item.id), item];
            }));
            const orderedIds = [];
            if (managerId)
                orderedIds.push(managerId);
            for (const row of storedTeam) {
                if (row.id === managerId || orderedIds.includes(row.id))
                    continue;
                if (!membershipByUserId.has(row.id) && !reportOnlyById.has(row.id))
                    continue;
                orderedIds.push(row.id);
            }
            const userObjectIds = orderedIds
                .map(asObjectId)
                .filter((value) => value !== null);
            const userRows = userObjectIds.length > 0
                ? await users.find({ _id: { $in: userObjectIds } }).toArray()
                : [];
            const userById = new Map(userRows.map((user) => [user._id.toString(), user]));
            const preparers = [];
            let nonManagerIndex = 0;
            for (const entryId of orderedIds) {
                const reportOnly = reportOnlyById.get(entryId);
                if (reportOnly) {
                    const stored = storedById.get(entryId);
                    const reportRole = cleanReportText(stored?.role, 500) ||
                        (nonManagerIndex === 0 ? REPORT_PREPARER_ROLE : REPORT_INSPECTION_ROLE);
                    nonManagerIndex += 1;
                    const signature = typeof reportOnly.signatureImageDataUrl === "string" &&
                        reportOnly.signatureImageDataUrl.startsWith("data:image/")
                        ? reportOnly.signatureImageDataUrl
                        : "";
                    preparers.push({
                        userId: entryId,
                        reportDisplayName: safeReportPersonName(reportOnly.name) ||
                            safeReportPersonName(stored?.name),
                        jobTitle: cleanReportText(reportOnly.jobTitle, 200) ||
                            cleanReportText(stored?.title, 200),
                        membershipNo: cleanReportText(reportOnly.membershipNo, 100) ||
                            cleanReportText(stored?.membershipNo, 100),
                        reportRole,
                        signatureImageDataUrl: signature,
                    });
                    continue;
                }
                const user = userById.get(entryId);
                if (!user)
                    continue;
                const isManager = entryId === managerId;
                if (!isManager && !membershipByUserId.has(entryId))
                    continue;
                const stored = storedById.get(entryId);
                const currentDisplayName = safeReportPersonName(user.valuationReportDisplayName);
                const legacyDisplayName = safeReportPersonName(user.username);
                const reportRole = cleanReportText(stored?.role, 500) ||
                    (isManager
                        ? REPORT_MANAGER_ROLE
                        : nonManagerIndex === 0
                            ? REPORT_PREPARER_ROLE
                            : REPORT_INSPECTION_ROLE);
                if (!isManager)
                    nonManagerIndex += 1;
                const signature = typeof user.valuationReportSignatureDataUrl === "string" &&
                    user.valuationReportSignatureDataUrl.startsWith("data:image/")
                    ? user.valuationReportSignatureDataUrl
                    : "";
                preparers.push({
                    userId: entryId,
                    reportDisplayName: currentDisplayName ||
                        safeReportPersonName(stored?.name) ||
                        legacyDisplayName,
                    jobTitle: cleanReportText(user.valuationReportJobTitle, 200) ||
                        cleanReportText(stored?.title, 200),
                    membershipNo: cleanReportText(user.valuationReportMembershipNo, 100) ||
                        cleanReportText(stored?.membershipNo, 100),
                    reportRole,
                    signatureImageDataUrl: signature,
                });
            }
            return preparers.slice(0, 12);
        }
        catch (error) {
            this.logger.warn(`Could not resolve Word report preparers: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    }
    async mergeAndRespond(projectId, ctx, body, res) {
        const loaded = await this.mvService.getProject(projectId, ctx);
        const project = loaded.project;
        const reportData = (project.reportData ?? {});
        const sourceTemplatePath = findBundledWordTemplateOnDisk();
        if (!sourceTemplatePath) {
            throw new common_1.BadRequestException("لم يُعثر على قالب Word الأساسي «تقرير تقييم.docx» في Spark-Vision/public/files أو assets على السيرفر.");
        }
        let templateBuffer = await fs.promises.readFile(sourceTemplatePath);
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
        const assetSettings = adaptiveAssetImageSettings(assetSources.length || imageCount, imageLayout.imageQuality);
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
            this.logger.log(`Preparing Word merge for ${projectId}: ${assetSources.length} asset, ${valuationSources.length} valuation, ${clientSources.length} client images (disk pipeline, asset≤${assetSettings.maxWidth}px, concurrency=${MV_MERGE_ASSET_FETCH_CONCURRENCY}/${MV_MERGE_PRINT_FETCH_CONCURRENCY})`);
            const [assetImagePaths, valuationImagePaths, clientImagePaths, reportPreparers] = await Promise.all([
                this.materializeImagesToDisk(assetSources, assetDir, "a", assetSettings, projectId, ctx),
                this.materializeImagesToDisk(valuationSources, valuationDir, "v", valuationSettings, projectId, ctx),
                this.materializeImagesToDisk(clientSources, clientDir, "c", clientSettings, projectId, ctx),
                this.resolveReportPreparers(reportData, project.companyId, ctx),
            ]);
            this.logger.log(`Prepared Word images for ${projectId} in ${Date.now() - prepareStartedAt}ms (asset=${assetImagePaths.length}, valuation=${valuationImagePaths.length}, client=${clientImagePaths.length})`);
            const storedTextValues = buildTextValues(reportData, project.name || "", project.displayNumber);
            const requestTextValues = sanitizeVariableOverrides(body.textValues);
            const textValues = { ...storedTextValues, ...requestTextValues };
            if (!String(textValues.assetSingularPlural || "").trim()) {
                textValues.assetSingularPlural =
                    storedTextValues.assetSingularPlural || "أصل/أصول";
            }
            if (!String(textValues.assetSubjectDescription || "").trim()) {
                textValues.assetSubjectDescription =
                    storedTextValues.assetSubjectDescription || "الات ومعدات واجهزة متنوعه";
            }
            const manifest = {
                templatePath,
                outputPath,
                textValues,
                assetImagePaths,
                valuationImagePaths,
                clientImagePaths,
                reportPreparers,
                imageLayout,
            };
            this.logger.log(`Merging Word for ${projectId}: ${assetImagePaths.length} asset, ${valuationImagePaths.length} valuation, ${clientImagePaths.length} client images, ${reportPreparers.length} report preparers`);
            let mergeResult;
            try {
                mergeResult = await runDiskDocxMergeWorker(manifest, imageCount);
            }
            catch (err) {
                this.logger.error(`docx-worker failed: ${err.message}`);
                throw new common_1.BadRequestException(`تعذر دمج ملف Word: ${err.message}`);
            }
            const stats = mergeResult.stats;
            const imageWarnings = [];
            const appendImageWarning = (label, requested, inserted) => {
                if (inserted >= requested)
                    return;
                imageWarnings.push(`${label}: تم إدراج ${inserted} من أصل ${requested} صورة.`);
            };
            appendImageWarning("صور الأصول", assetSources.length, stats.assetImagesInserted);
            appendImageWarning("صور حسابات القيمة", valuationSources.length, stats.valuationImagesInserted);
            appendImageWarning("صور ملفات العميل", clientSources.length, stats.clientImagesInserted);
            if (imageWarnings.length > 0) {
                this.logger.warn(`Word merge completed with image warnings for ${projectId}: ${imageWarnings.join(" ")}`);
            }
            const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
            const docxName = `${safeName}-merged-report.docx`;
            const pdfName = `${safeName}-merged-report.pdf`;
            res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
            if (imageWarnings.length > 0) {
                res.setHeader("X-Word-Merge-Warnings", encodeURIComponent(JSON.stringify(imageWarnings)));
            }
            const wantPdf = body.alsoPdf === true;
            if (wantPdf) {
                try {
                    const pdfPath = await (0, docx_to_pdf_1.convertDocxToPdf)(mergeResult.outputPath, workDir, {
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
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.logger.warn(`Word→PDF conversion failed for ${projectId}: ${msg}`);
                    res.setHeader("X-Word-Merge-Pdf", "0");
                    res.setHeader("X-Word-Merge-Pdf-Error", encodeURIComponent(msg.slice(0, 300)));
                }
            }
            else {
                res.setHeader("X-Word-Merge-Pdf-Available", (0, docx_to_pdf_1.isLibreOfficeAvailable)() ? "1" : "0");
            }
            const fileStat = await fs.promises.stat(mergeResult.outputPath);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(docxName)}"`);
            res.setHeader("Content-Length", String(fileStat.size));
            await pipeFileToResponse(mergeResult.outputPath, res);
        }
        finally {
            fs.rm(workDir, { recursive: true, force: true }, () => undefined);
        }
    }
    async respondWithPendingPdf(projectId, token, res) {
        cleanupExpiredPdfExports();
        const row = pendingPdfExports.get(token);
        if (!row || row.projectId !== projectId) {
            throw new common_1.NotFoundException("انتهت صلاحية ملف PDF أو الرمز غير صالح. أعد تنزيل التقرير.");
        }
        if (!fs.existsSync(row.filePath)) {
            pendingPdfExports.delete(token);
            throw new common_1.NotFoundException("تعذر العثور على ملف PDF. أعد تنزيل التقرير.");
        }
        const fileStat = await fs.promises.stat(row.filePath);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
        res.setHeader("Content-Length", String(fileStat.size));
        try {
            await pipeFileToResponse(row.filePath, res);
        }
        finally {
            pendingPdfExports.delete(token);
            fs.rm(row.filePath, { force: true }, () => undefined);
        }
    }
    async resolveImageSources(opts) {
        const fromBase64 = [];
        for (const item of opts.base64List ?? []) {
            try {
                const buffer = Buffer.from(item, "base64");
                if (buffer.byteLength > 0)
                    fromBase64.push({ kind: "buffer", buffer });
            }
            catch {
            }
        }
        if (fromBase64.length > 0)
            return fromBase64;
        const trimmedUrls = (opts.urls ?? []).map((url) => url.trim()).filter(Boolean);
        if (trimmedUrls.length > 0) {
            return trimmedUrls.map((url) => ({ kind: "url", url }));
        }
        if (opts.fallback === "assets") {
            const fileIds = await this.listReportAssetFileIds(opts.projectId, opts.ctx);
            return fileIds.map((fileId) => ({ kind: "fileId", fileId }));
        }
        if (opts.fallback === "valuation") {
            const fileIds = this.listWorkspaceImageFileIds(opts.project?.valuationAccountingWorkspace);
            return fileIds.map((fileId) => ({ kind: "fileId", fileId }));
        }
        const fileIds = this.listWorkspaceImageFileIds(opts.project?.clientDocumentsWorkspace);
        this.logger.log(`Word merge client images fallback for ${opts.projectId}: ${fileIds.length} fileId(s) from workspace`);
        return fileIds.map((fileId) => ({ kind: "fileId", fileId }));
    }
    async materializeImagesToDisk(sources, destDir, prefix, settings, projectId, ctx) {
        if (sources.length === 0)
            return [];
        const concurrency = settings.chromaSubsampling === "4:4:4"
            ? MV_MERGE_PRINT_FETCH_CONCURRENCY
            : MV_MERGE_ASSET_FETCH_CONCURRENCY;
        const paths = await mapWithConcurrency(sources, concurrency, async (source, index) => {
            try {
                const destPath = path.join(destDir, `${prefix}-${String(index + 1).padStart(5, "0")}.jpg`);
                const cachedPath = await this.getOrCreateOptimizedImageCacheFile(source, settings, projectId, ctx);
                if (!cachedPath)
                    return null;
                try {
                    await fs.promises.link(cachedPath, destPath);
                }
                catch {
                    await fs.promises.copyFile(cachedPath, destPath);
                }
                return destPath;
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
                if (name === "NoSuchKey" || /NoSuchKey|not found|404/i.test(msg)) {
                    this.logger.warn(`Word merge skipped missing image ${prefix}-${index + 1} for ${projectId}: ${name || msg}`);
                }
                else {
                    this.logger.warn(`Word merge skipped image ${prefix}-${index + 1} for ${projectId}: ${msg}`);
                }
                return null;
            }
        });
        return paths.filter((item) => Boolean(item));
    }
    async getOrCreateOptimizedImageCacheFile(source, settings, projectId, ctx) {
        const cacheRoot = wordImageCacheRoot();
        await fs.promises.mkdir(cacheRoot, { recursive: true });
        scheduleWordImageCacheCleanup();
        const accessScope = `${ctx.companyId ?? ""}:${ctx.userId ?? "anonymous"}:${ctx.isSuperAdmin ? "1" : "0"}`;
        const key = optimizedImageCacheKey(projectId, source, settings, accessScope);
        const cachePath = path.join(cacheRoot, `${key}.jpg`);
        if (await cachedImageIsFresh(cachePath))
            return cachePath;
        const running = wordImageCacheInflight.get(key);
        if (running)
            return running;
        const task = (async () => {
            if (await cachedImageIsFresh(cachePath))
                return cachePath;
            let buffer = null;
            if (source.kind === "buffer") {
                buffer = source.buffer;
            }
            else if (source.kind === "fileId") {
                const download = await this.mvService.getProjectFileDownload(projectId, source.fileId, ctx);
                buffer = await bufferFromStream(download.stream);
            }
            else {
                buffer = await this.fetchImageBuffer(source.url, ctx);
            }
            if (!buffer || buffer.byteLength === 0)
                return null;
            const tempPath = path.join(cacheRoot, `${key}.${(0, crypto_1.randomUUID)()}.tmp`);
            try {
                const ok = await writeOptimizedJpegFile(buffer, tempPath, settings);
                buffer = null;
                if (!ok)
                    return null;
                await fs.promises.rm(cachePath, { force: true });
                await fs.promises.rename(tempPath, cachePath);
                return cachePath;
            }
            finally {
                buffer = null;
                await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
            }
        })();
        wordImageCacheInflight.set(key, task);
        void task.then(() => {
            if (wordImageCacheInflight.get(key) === task)
                wordImageCacheInflight.delete(key);
        }, () => {
            if (wordImageCacheInflight.get(key) === task)
                wordImageCacheInflight.delete(key);
        });
        return task;
    }
    async listReportAssetFileIds(projectId, ctx) {
        try {
            const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
            return files
                .filter((file) => {
                const mimeType = String(file.mimeType || "").toLowerCase();
                const extension = String(file.extension || "").toLowerCase();
                const isImage = !mimeType.startsWith("video/") &&
                    (mimeType.startsWith("image/") ||
                        ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"].includes(extension));
                return isImage && file.includeInReport === true;
            })
                .map((file) => String(file._id || "").trim())
                .filter(Boolean);
        }
        catch (err) {
            this.logger.warn(`Could not list asset images for Word merge: ${err.message}`);
            return [];
        }
    }
    listWorkspaceImageFileIds(workspace) {
        if (!workspace || typeof workspace !== "object")
            return [];
        const store = workspace;
        if (store.includeInReport === false || !Array.isArray(store.images))
            return [];
        return store.images
            .map((item) => {
            if (!item || typeof item !== "object")
                return "";
            const row = item;
            if (row.includeInReport === false)
                return "";
            return typeof row.fileId === "string" ? row.fileId.trim() : "";
        })
            .filter(Boolean);
    }
    async fetchImageBuffer(url, ctx) {
        const trimmed = url.trim();
        if (!trimmed)
            return null;
        try {
            const fileMatch = trimmed.match(/\/api\/mv\/projects\/([^/]+)\/files\/([^/?#]+)\/download/);
            if (fileMatch) {
                const [, pid, fid] = fileMatch;
                const dl = await this.mvService.getProjectFileDownload(pid, fid, ctx);
                return bufferFromStream(dl.stream);
            }
            if (trimmed.startsWith("data:")) {
                const b64 = trimmed.split(",")[1];
                if (b64)
                    return Buffer.from(b64, "base64");
            }
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                const res = await fetch(trimmed);
                if (!res.ok)
                    return null;
                return Buffer.from(await res.arrayBuffer());
            }
        }
        catch {
            return null;
        }
        return null;
    }
};
exports.WordTemplateMergeService = WordTemplateMergeService;
exports.WordTemplateMergeService = WordTemplateMergeService = WordTemplateMergeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [machine_valuation_service_1.MachineValuationService])
], WordTemplateMergeService);
