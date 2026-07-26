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
const mongodb_1 = require("mongodb");
const sharp_1 = __importDefault(require("sharp"));
const machine_valuation_service_1 = require("./machine-valuation.service");
const collections_1 = require("../server/auth-tracking/collections");
const service_1 = require("../server/auth-tracking/service");
const mongodb_2 = require("../server/mongodb");
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
    return {
        imagesPerRow: safeImagesPerRow,
        imagesPerPage: safeImagesPerPage,
        clientImagesPerRow,
        clientImagesPerPage: clientImagesPerRow * clientImagesPerRow,
    };
}
function adaptiveAssetImageSettings(imageCount) {
    if (imageCount <= 80)
        return { maxWidth: 1100, maxHeight: 1100, quality: 82, chromaSubsampling: "4:2:0" };
    if (imageCount <= 250)
        return { maxWidth: 900, maxHeight: 900, quality: 78, chromaSubsampling: "4:2:0" };
    if (imageCount <= 800)
        return { maxWidth: 780, maxHeight: 780, quality: 74, chromaSubsampling: "4:2:0" };
    if (imageCount <= 2000)
        return { maxWidth: 680, maxHeight: 680, quality: 70, chromaSubsampling: "4:2:0" };
    return { maxWidth: 600, maxHeight: 600, quality: 66, chromaSubsampling: "4:2:0" };
}
function valuationPrintImageSettings() {
    return {
        maxWidth: 4800,
        maxHeight: 14000,
        quality: 95,
        chromaSubsampling: "4:4:4",
    };
}
function clientDocumentImageSettings() {
    return {
        maxWidth: 3600,
        maxHeight: 10000,
        quality: 92,
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
                textFilled: Number(parsed.textFilled ?? 0),
                assetImagesInserted: Number(parsed.assetImagesInserted ?? 0),
                valuationImagesInserted: Number(parsed.valuationImagesInserted ?? 0),
                clientImagesInserted: Number(parsed.clientImagesInserted ?? 0),
                bookmarksFound: Array.isArray(parsed.bookmarksFound) ? parsed.bookmarksFound.map(String) : [],
            };
        }
        catch {
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
            fit: "inside",
            withoutEnlargement: true,
            kernel: isPrintImage ? sharp_1.default.kernel.lanczos3 : sharp_1.default.kernel.mitchell,
        })
            .jpeg(isPrintImage
            ? {
                quality: settings.quality,
                mozjpeg: false,
                chromaSubsampling: "4:4:4",
                progressive: false,
                optimizeScans: false,
                trellisQuantisation: false,
                overshootDeringing: false,
                force: true,
            }
            : {
                quality: settings.quality,
                mozjpeg: true,
                chromaSubsampling: "4:2:0",
                progressive: false,
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
const MV_MERGE_ASSET_FETCH_CONCURRENCY = Math.max(4, Math.min(10, typeof os.cpus === "function" ? os.cpus().length : 4));
const MV_MERGE_PRINT_FETCH_CONCURRENCY = Math.max(2, Math.min(4, MV_MERGE_ASSET_FETCH_CONCURRENCY));
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
const COMPANY_REPORT_TEMPLATE_UPLOAD_PREFIX = "/uploads/company-report-templates/";
function bundledWordTemplateSearchDirs() {
    const cwd = process.cwd();
    const dirs = [
        path.resolve(cwd, "assets"),
        path.resolve(cwd, "public", "files"),
        path.resolve(cwd, "..", "Spark-Vision", "public", "files"),
        path.resolve(__dirname, "..", "..", "assets"),
        path.resolve(__dirname, "..", "..", "public", "files"),
        path.resolve(__dirname, "..", "..", "..", "Spark-Vision", "public", "files"),
    ];
    return [...new Set(dirs)];
}
function findBundledWordTemplateOnDisk() {
    for (const dir of bundledWordTemplateSearchDirs()) {
        for (const fileName of service_1.PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAMES) {
            const candidate = path.resolve(dir, fileName);
            if (fs.existsSync(candidate))
                return candidate;
        }
    }
    return null;
}
function resolveBundledWordTemplatePath(uploadUrl) {
    const trimmed = (uploadUrl ?? "").trim();
    if (trimmed && !service_1.PRO_OPTION_BUNDLED_WORD_TEMPLATE_URLS.has(trimmed))
        return null;
    return findBundledWordTemplateOnDisk();
}
function resolveCompanyWordTemplatePath(uploadUrl) {
    const trimmed = uploadUrl.trim();
    const bundledPath = resolveBundledWordTemplatePath(trimmed);
    if (bundledPath)
        return bundledPath;
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
    return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(amount);
}
function formatFinalValue(value, _currency) {
    return formatFinalValueAmount(value);
}
function sanitizeForXml(text) {
    return text
        .replace(/[\uD800-\uDFFF]/g, "")
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
        .trim();
}
function sanitizeTextRecord(input, options = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input))
        return {};
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        const safeKey = sanitizeForXml(String(key));
        const safeValue = sanitizeForXml(String(value ?? ""));
        if (!safeKey || (options.dropEmpty && !safeValue))
            continue;
        out[safeKey] = safeValue;
    }
    return out;
}
function buildTextValues(reportData, projectName) {
    const clientIdentity = [
        reportData.clientLegalType,
        reportData.clientRepresentativeName,
        reportData.clientRepresentativeRole,
        reportData.intendedUsers,
    ]
        .filter((v) => typeof v === "string" && v.trim())
        .join(" — ");
    const raw = {
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
        finalValue: formatFinalValue(reportData.finalValue, reportData.currencyLabel),
        finalValueAmount: formatFinalValueAmount(reportData.finalValue),
        finalValueWords: String(reportData.finalValueWords || "").trim(),
        inspectionLocation: String(reportData.inspectionLocation || "").trim(),
        inspectionMapUrl: String(reportData.inspectionMapUrl || "").trim(),
    };
    const out = {};
    for (const [key, val] of Object.entries(raw)) {
        out[key] = sanitizeForXml(val);
    }
    return out;
}
let WordTemplateMergeService = WordTemplateMergeService_1 = class WordTemplateMergeService {
    constructor(mvService) {
        this.mvService = mvService;
        this.logger = new common_1.Logger(WordTemplateMergeService_1.name);
    }
    async mergeAndRespond(projectId, ctx, body, res) {
        const loaded = await this.mvService.getProject(projectId, ctx);
        const project = loaded.project;
        const reportData = (project.reportData ?? {});
        const templateFileId = body.templateFileId?.trim() || String(reportData.wordReportTemplateFileId || "").trim();
        let templateBuffer = null;
        if (templateFileId) {
            const download = await this.mvService.getProjectFileDownload(projectId, templateFileId, ctx);
            templateBuffer = await bufferFromStream(download.stream);
        }
        else {
            templateBuffer = await this.loadCompanyWordTemplateBuffer(project, ctx);
        }
        if (!templateBuffer) {
            throw new common_1.BadRequestException("لم يُعثر على قالب Word المضمّن أو المرفوع. تأكد من وجود assets/mv-word-template.docx على السيرفر، أو ارفع قالباً من إعدادات الشركة ثم أعد المحاولة.");
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
        const assetSettings = adaptiveAssetImageSettings(assetSources.length || imageCount);
        const valuationSettings = valuationPrintImageSettings();
        const clientSettings = clientDocumentImageSettings();
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
            this.logger.log(`Preparing Word merge for ${projectId}: ${assetSources.length} asset, ${valuationSources.length} valuation, ${clientSources.length} client images (disk pipeline, asset≤${assetSettings.maxWidth}px, valuation≤${valuationSettings.maxWidth}x${valuationSettings.maxHeight}@q${valuationSettings.quality})`);
            const [assetImagePaths, valuationImagePaths, clientImagePaths] = await Promise.all([
                this.materializeImagesToDisk(assetSources, assetDir, "a", assetSettings, projectId, ctx),
                this.materializeImagesToDisk(valuationSources, valuationDir, "v", valuationSettings, projectId, ctx),
                this.materializeImagesToDisk(clientSources, clientDir, "c", clientSettings, projectId, ctx),
            ]);
            const storedTextValues = buildTextValues(reportData, project.name || "");
            const requestTextValues = sanitizeTextRecord(body.textValues, { dropEmpty: true });
            const textValues = Object.keys(requestTextValues).length > 0
                ? { ...storedTextValues, ...requestTextValues }
                : storedTextValues;
            const textByBookmarkName = sanitizeTextRecord(body.textByBookmarkName, { dropEmpty: true });
            const manifest = {
                templatePath,
                outputPath,
                textValues,
                textByBookmarkName,
                assetImagePaths,
                valuationImagePaths,
                clientImagePaths,
                imageLayout: sanitizeImageLayout(body.imageLayout),
            };
            this.logger.log(`Merging Word for ${projectId}: ${assetImagePaths.length} asset, ${valuationImagePaths.length} valuation, ${clientImagePaths.length} client images`);
            let mergeResult;
            try {
                mergeResult = await runDiskDocxMergeWorker(manifest, imageCount);
            }
            catch (err) {
                this.logger.error(`docx-worker failed: ${err.message}`);
                throw new common_1.BadRequestException(`تعذر دمج ملف Word: ${err.message}`);
            }
            const stats = mergeResult.stats;
            const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
            const fileStat = await fs.promises.stat(mergeResult.outputPath);
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`${safeName}-updated-report.docx`)}"`);
            res.setHeader("Content-Length", String(fileStat.size));
            res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
            await pipeFileToResponse(mergeResult.outputPath, res);
        }
        finally {
            fs.rm(workDir, { recursive: true, force: true }, () => undefined);
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
        if ((opts.urls?.length ?? 0) > 0) {
            return (opts.urls ?? [])
                .map((url) => url.trim())
                .filter(Boolean)
                .map((url) => ({ kind: "url", url }));
        }
        if (opts.urlsProvided)
            return [];
        if (opts.fallback === "assets") {
            const fileIds = await this.listReportAssetFileIds(opts.projectId, opts.ctx);
            return fileIds.map((fileId) => ({ kind: "fileId", fileId }));
        }
        if (opts.fallback === "valuation") {
            const fileIds = this.listWorkspaceImageFileIds(opts.project?.valuationAccountingWorkspace);
            return fileIds.map((fileId) => ({ kind: "fileId", fileId }));
        }
        const fileIds = this.listWorkspaceImageFileIds(opts.project?.clientDocumentsWorkspace);
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
                const destPath = path.join(destDir, `${prefix}-${String(index + 1).padStart(5, "0")}.jpg`);
                const ok = await writeOptimizedJpegFile(buffer, destPath, settings);
                buffer = null;
                return ok ? destPath : null;
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
    resolveCompanyId(project, ctx) {
        const raw = project.companyId ?? ctx.companyId;
        if (raw instanceof mongodb_1.ObjectId)
            return raw;
        if (typeof raw !== "string" || !raw.trim() || !mongodb_1.ObjectId.isValid(raw.trim()))
            return null;
        return new mongodb_1.ObjectId(raw.trim());
    }
    async loadCompanyWordTemplateBuffer(project, ctx) {
        const companyId = this.resolveCompanyId(project, ctx);
        if (!companyId)
            return null;
        const db = await (0, mongodb_2.getMongoDb)();
        const { companies, users, userCompanyMemberships } = (0, collections_1.getAuthCollections)(db);
        const company = await companies.findOne({ _id: companyId });
        const adminMembership = await userCompanyMemberships.findOne({ companyId, role: "company_admin" });
        const adminUserId = adminMembership?.userId ?? company?.adminUserId ?? null;
        const adminUser = adminUserId ? await users.findOne({ _id: adminUserId }) : null;
        const wordTemplate = (0, service_1.resolveCompanyReportDefaults)(company?.reportDefaults, {
            companyName: company?.name,
            adminPhone: adminUser?.phone,
            adminUsername: adminUser?.username,
        }).wordTemplate;
        const gridFsId = typeof wordTemplate?.gridFsFileId === "string" ? wordTemplate.gridFsFileId.trim() : "";
        if (gridFsId) {
            const fromGrid = await (0, service_1.loadCompanyWordTemplateBufferFromGridFs)(gridFsId);
            if (fromGrid?.byteLength)
                return fromGrid;
        }
        const filePath = wordTemplate?.fileUrl ? resolveCompanyWordTemplatePath(wordTemplate.fileUrl) : null;
        if (filePath && fs.existsSync(filePath)) {
            return fs.promises.readFile(filePath);
        }
        const bundledPath = findBundledWordTemplateOnDisk();
        if (bundledPath) {
            if (wordTemplate?.fileUrl && !service_1.PRO_OPTION_BUNDLED_WORD_TEMPLATE_URLS.has(wordTemplate.fileUrl.trim())) {
                this.logger.warn(`Company Word template missing (url=${wordTemplate.fileUrl}, gridFs=${gridFsId || "none"}); falling back to bundled ${path.basename(bundledPath)} for company ${String(companyId)}`);
            }
            return fs.promises.readFile(bundledPath);
        }
        if (wordTemplate?.fileUrl) {
            this.logger.warn(`Company Word template metadata exists (url=${wordTemplate.fileUrl}, gridFs=${gridFsId || "none"}) but file is missing on disk/GridFS for company ${String(companyId)}`);
        }
        return null;
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
