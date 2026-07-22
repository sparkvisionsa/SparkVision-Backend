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
var WordTemplateMergeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WordTemplateMergeService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const mongodb_1 = require("mongodb");
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
    const autoPerPage = safeImagesPerRow * (safeImagesPerRow >= 4 ? 5 : 4);
    const safeImagesPerPage = Number.isFinite(providedPerPage) && providedPerPage > 0
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
function findPythonBin() {
    const venvPaths = [
        path.join(process.cwd(), "docx-worker", "venv", "bin", "python"),
        path.join(process.cwd(), "docx-worker", "venv", "Scripts", "python.exe"),
        path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
        path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
    ];
    for (const p of venvPaths) {
        if (fs.existsSync(p))
            return p;
    }
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
function estimateMergePayloadSize(payload) {
    let size = payload.templateBase64.length;
    for (const img of payload.assetImagesBase64)
        size += img.length;
    for (const img of payload.valuationImagesBase64)
        size += img.length;
    for (const img of payload.clientImagesBase64)
        size += img.length;
    return size;
}
function writeAsync(stream, chunk) {
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
async function streamMergePayloadJson(payload, stream) {
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
function closeWriteStream(stream) {
    return new Promise((resolve, reject) => {
        stream.end((err) => (err ? reject(err) : resolve()));
    });
}
function spawnMergeOnce(payload) {
    const python = findPythonBin();
    const script = findMergeScriptPath();
    const estimatedSize = estimateMergePayloadSize(payload);
    const payloadPath = estimatedSize > 4_000_000
        ? path.join(os.tmpdir(), `mv-docx-merge-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
        : null;
    const runChild = (args) => new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(python, args, {
            cwd: process.cwd(),
            timeout: 180_000,
            stdio: ["pipe", "pipe", "pipe"],
        });
        const chunks = [];
        const errChunks = [];
        child.stdout.on("data", (d) => chunks.push(d));
        child.stderr.on("data", (d) => errChunks.push(d));
        child.on("error", (err) => reject(new Error(`Python: ${err.message}`)));
        child.on("close", (code) => {
            const stderr = Buffer.concat(errChunks).toString("utf8");
            if (stderr)
                console.log("[docx-worker]\n" + stderr);
            if (code !== 0) {
                reject(new Error(`docx-worker exited ${code}: ${stderr.slice(0, 500)}`));
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
            child.stdin.end();
        }
        else {
            streamMergePayloadJson(payload, child.stdin)
                .then(() => child.stdin.end())
                .catch((err) => reject(new Error(`payload write failed: ${err.message}`)));
        }
    });
    if (!payloadPath)
        return runChild([script]);
    const fileStream = fs.createWriteStream(payloadPath);
    return streamMergePayloadJson(payload, fileStream)
        .then(() => closeWriteStream(fileStream))
        .then(() => runChild([script, payloadPath]))
        .finally(() => fs.unlink(payloadPath, () => undefined));
}
function isMissingPythonDependencyError(message) {
    return /ModuleNotFoundError|No module named|ImportError/i.test(message);
}
let dependencyInstallPromise = null;
function installDocxWorkerDependencies() {
    if (dependencyInstallPromise)
        return dependencyInstallPromise;
    dependencyInstallPromise = new Promise((resolve) => {
        const python = findPythonBin();
        const workerDir = path.dirname(findMergeScriptPath());
        const requirementsPath = path.join(workerDir, "requirements.txt");
        if (!fs.existsSync(requirementsPath)) {
            resolve(false);
            return;
        }
        const child = (0, child_process_1.spawn)(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "-r", requirementsPath], { cwd: workerDir, timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] });
        const chunks = [];
        child.stdout.on("data", (d) => chunks.push(d));
        child.stderr.on("data", (d) => chunks.push(d));
        child.on("error", (err) => {
            console.error(`[docx-worker] pip install failed to start: ${err.message}`);
            resolve(false);
        });
        child.on("close", (code) => {
            const output = Buffer.concat(chunks).toString("utf8");
            if (code === 0) {
                console.log(`[docx-worker] dependencies installed via pip (${python}):\n${output.slice(-2000)}`);
                resolve(true);
            }
            else {
                console.error(`[docx-worker] pip install exited ${code}:\n${output.slice(-2000)}`);
                resolve(false);
            }
        });
    });
    return dependencyInstallPromise;
}
async function runDocxMergeWorker(payload) {
    try {
        return await spawnMergeOnce(payload);
    }
    catch (err) {
        const message = err.message || "";
        if (!isMissingPythonDependencyError(message))
            throw err;
        console.warn(`[docx-worker] missing Python dependency detected, attempting auto-install: ${message}`);
        const installed = await installDocxWorkerDependencies();
        if (!installed)
            throw err;
        return spawnMergeOnce(payload);
    }
}
const MV_MERGE_IMAGE_FETCH_CONCURRENCY = 12;
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
            results[i] = await fn(items[i]);
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
        let assetImagesBase64 = [...(body.assetImagesBase64 ?? [])];
        let valuationImagesBase64 = [...(body.valuationImagesBase64 ?? [])];
        let clientImagesBase64 = [...(body.clientImagesBase64 ?? [])];
        const assetImageUrlsProvided = Array.isArray(body.assetImageUrls);
        const valuationImageUrlsProvided = Array.isArray(body.valuationImageUrls);
        const clientImageUrlsProvided = Array.isArray(body.clientImageUrls);
        if (assetImagesBase64.length === 0 && (body.assetImageUrls?.length ?? 0) > 0) {
            const loaded = await mapWithConcurrency(body.assetImageUrls ?? [], MV_MERGE_IMAGE_FETCH_CONCURRENCY, (url) => this.fetchImageBuffer(url, ctx));
            for (const buf of loaded) {
                if (buf)
                    assetImagesBase64.push(buf.toString("base64"));
            }
        }
        if (assetImagesBase64.length === 0 && !assetImageUrlsProvided) {
            assetImagesBase64 = await this.loadStoredAssetImagesBase64(projectId, ctx);
        }
        if (valuationImagesBase64.length === 0 && (body.valuationImageUrls?.length ?? 0) > 0) {
            const loaded = await mapWithConcurrency(body.valuationImageUrls ?? [], MV_MERGE_IMAGE_FETCH_CONCURRENCY, (url) => this.fetchImageBuffer(url, ctx));
            for (const buf of loaded) {
                if (buf)
                    valuationImagesBase64.push(buf.toString("base64"));
            }
        }
        if (valuationImagesBase64.length === 0 && !valuationImageUrlsProvided) {
            valuationImagesBase64 = await this.loadStoredValuationImagesBase64(project, ctx);
        }
        if (clientImagesBase64.length === 0 && (body.clientImageUrls?.length ?? 0) > 0) {
            const loaded = await mapWithConcurrency(body.clientImageUrls ?? [], MV_MERGE_IMAGE_FETCH_CONCURRENCY, (url) => this.fetchImageBuffer(url, ctx));
            for (const buf of loaded) {
                if (buf)
                    clientImagesBase64.push(buf.toString("base64"));
            }
        }
        if (clientImagesBase64.length === 0 && !clientImageUrlsProvided) {
            clientImagesBase64 = await this.loadStoredClientImagesBase64(project, ctx);
        }
        const storedTextValues = buildTextValues(reportData, project.name || "");
        const requestTextValues = sanitizeTextRecord(body.textValues, { dropEmpty: true });
        const textValues = Object.keys(requestTextValues).length > 0
            ? { ...storedTextValues, ...requestTextValues }
            : storedTextValues;
        const textByBookmarkName = sanitizeTextRecord(body.textByBookmarkName, { dropEmpty: true });
        const payload = {
            templateBase64: templateBuffer.toString("base64"),
            textValues,
            textByBookmarkName,
            assetImagesBase64,
            valuationImagesBase64,
            clientImagesBase64,
            imageLayout: sanitizeImageLayout(body.imageLayout),
        };
        this.logger.log(`Merging Word for ${projectId}: ${assetImagesBase64.length} asset, ${valuationImagesBase64.length} valuation, ${clientImagesBase64.length} client images`);
        let mergeResult;
        try {
            mergeResult = await runDocxMergeWorker(payload);
        }
        catch (err) {
            this.logger.error(`docx-worker failed: ${err.message}`);
            throw new common_1.BadRequestException(`تعذر دمج ملف Word: ${err.message}`);
        }
        const { buffer: docxBuffer, stats } = mergeResult;
        const safeName = (project.name || "report").replace(/[\\/:*?"<>|]+/g, "-");
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`${safeName}-updated-report.docx`)}"`);
        res.setHeader("X-Word-Merge-Stats", encodeURIComponent(JSON.stringify(stats)));
        res.end(docxBuffer);
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
    async loadStoredAssetImagesBase64(projectId, ctx) {
        try {
            const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
            const reportImages = files.filter((file) => {
                const mimeType = String(file.mimeType || "").toLowerCase();
                const extension = String(file.extension || "").toLowerCase();
                const isImage = !mimeType.startsWith("video/") &&
                    (mimeType.startsWith("image/") ||
                        ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"].includes(extension));
                return isImage && file.includeInReport === true;
            });
            const loaded = await mapWithConcurrency(reportImages, MV_MERGE_IMAGE_FETCH_CONCURRENCY, async (file) => {
                try {
                    const fileId = String(file._id || "").trim();
                    if (!fileId)
                        return null;
                    const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
                    const buffer = await bufferFromStream(download.stream);
                    return buffer.byteLength > 0 ? buffer.toString("base64") : null;
                }
                catch {
                    return null;
                }
            });
            return loaded.filter((item) => Boolean(item));
        }
        catch (err) {
            this.logger.warn(`Could not load stored asset images for Word merge: ${err.message}`);
            return [];
        }
    }
    async loadWorkspaceImagesBase64(projectId, workspace, ctx) {
        if (!workspace || typeof workspace !== "object")
            return [];
        const store = workspace;
        if (store.includeInReport === false || !Array.isArray(store.images))
            return [];
        const fileIds = store.images
            .map((item) => {
            if (!item || typeof item !== "object")
                return "";
            const row = item;
            if (row.includeInReport === false)
                return "";
            return typeof row.fileId === "string" ? row.fileId.trim() : "";
        })
            .filter(Boolean);
        if (fileIds.length === 0)
            return [];
        const loaded = await mapWithConcurrency(fileIds, MV_MERGE_IMAGE_FETCH_CONCURRENCY, async (fileId) => {
            try {
                const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
                const buffer = await bufferFromStream(download.stream);
                return buffer.byteLength > 0 ? buffer.toString("base64") : null;
            }
            catch {
                return null;
            }
        });
        return loaded.filter((item) => Boolean(item));
    }
    async loadStoredValuationImagesBase64(project, ctx) {
        const projectId = String(project._id ?? "").trim();
        if (!projectId)
            return [];
        try {
            return await this.loadWorkspaceImagesBase64(projectId, project.valuationAccountingWorkspace, ctx);
        }
        catch (err) {
            this.logger.warn(`Could not load valuation images for Word merge: ${err.message}`);
            return [];
        }
    }
    async loadStoredClientImagesBase64(project, ctx) {
        const projectId = String(project._id ?? "").trim();
        if (!projectId)
            return [];
        try {
            return await this.loadWorkspaceImagesBase64(projectId, project.clientDocumentsWorkspace, ctx);
        }
        catch (err) {
            this.logger.warn(`Could not load client document images for Word merge: ${err.message}`);
            return [];
        }
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
