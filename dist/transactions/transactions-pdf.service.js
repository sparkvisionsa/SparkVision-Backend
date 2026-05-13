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
var TransactionsPdfService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsPdfService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
const mongodb_2 = require("../server/mongodb");
const transactions_model_1 = require("./transactions.model");
const transactions_media_model_1 = require("./transactions-media.model");
const VALUATION_PURPOSES = {
    "1": "التمويل",
    "2": "الشراء",
    "3": "البيع",
    "4": "الرهن",
    "5": "محاسبة",
    "6": "إفلاس",
    "7": "استحواذ",
    "8": "التقرير المالي",
    "9": "الضرائب",
    "10": "الأغراض التأمينية",
    "11": "تقاضي",
    "12": "أغراض داخلية",
    "13": "نزع الملكية",
    "14": "نقل",
    "15": "ورث",
    "16": "اخرى",
    "17": "توزيع تركه",
    "18": "البيع القسري",
    "19": "معرفة القيمة السوقية",
    "20": "معرفة القيمة الإيجارية",
    "21": "التصفية",
    "50": "أغراض إستثمارية",
    "54": "التعويض",
};
const VALUATION_BASES = {
    "1": "القيمة السوقية",
    "2": "القيمة الاستثمارية",
    "3": "القيمة المنصفة",
    "4": "قيمة التصفية",
    "5": "القيمة التكاملية",
    "6": "الايجار السوقي",
    "7": "القيمة السوقية / قيمة الايجار السوقي",
    "8": "القيمة العادلة",
    "10": "الإدراج في القوائم المالية",
};
const OWNERSHIP_TYPES = {
    "1": "الملكية المطلقة",
    "2": "الملكية المشروطة",
    "3": "الملكية المقيدة",
    "4": "ملكية مدى الحياة",
    "5": "منفعة",
    "6": "مشاع",
    "7": "ملكية مرهونة",
};
const VALUATION_HYPOTHESES = {
    "1": "الاستخدام الحالي",
    "2": "الاستخدام الأعلى والأفضل",
    "3": "التصفية المنظمة",
    "4": "البيع القسري",
};
const PROPERTY_TYPES = {
    "1": "أرض",
    "2": "شقة",
    "3": "فيلا سكنية",
    "4": "عمارة",
    "5": "إستراحة",
    "6": "مزرعة",
    "7": "مستودع",
    "9": "محل تجاري",
    "10": "دور",
    "21": "أرض سكنية",
    "22": "أرض تجارية",
    "24": "فندق",
    "28": "مبنى تجاري",
    "67": "عمارة سكنية",
};
const REGIONS = {
    "1": "منطقة الرياض",
    "2": "منطقة مكة المكرمة",
    "3": "منطقة المدينة المنورة",
    "4": "منطقة القصيم",
    "5": "المنطقة الشرقية",
    "6": "منطقة عسير",
    "7": "منطقة تبوك",
    "8": "منطقة حائل",
    "9": "منطقة الحدود الشمالية",
    "10": "منطقة جازان",
    "11": "منطقة نجران",
    "12": "منطقة الباحة",
    "13": "منطقة الجوف",
};
const BUILDING_STATES = {
    "10001": "جديد",
    "10002": "مستخدم",
    "10003": "تحت الإنشاء",
    "10004": "اخرى",
};
const FINISH_LEVELS = {
    "23": "تشطيب فاخر",
    "24": "تشطيب متوسط",
    "25": "تشطيب عادي",
    "10006": "بدون تشطيب",
};
const BUILD_QUALITY = {
    "44": "ممتاز",
    "45": "جيد جداً",
    "46": "ردئ",
    "10058": "جيد",
};
function fileToDataUri(filePath) {
    try {
        const abs = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
        if (!fs.existsSync(abs))
            return null;
        const buf = fs.readFileSync(abs);
        const ext = path.extname(filePath).toLowerCase().replace(".", "");
        const mimeMap = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
        };
        const mime = mimeMap[ext] ?? "image/jpeg";
        return `data:${mime};base64,${buf.toString("base64")}`;
    }
    catch {
        return null;
    }
}
function resolveFilePath(filePath) {
    return path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);
}
function findPythonBin() {
    const venvPaths = [
        path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
        path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
    ];
    for (const p of venvPaths) {
        if (fs.existsSync(p))
            return p;
    }
    return "python3";
}
function findScriptPath() {
    const candidates = [
        path.join(process.cwd(), "pdf-worker", "generate_pdf.py"),
        path.join(__dirname, "generate_pdf.py"),
        path.join(__dirname, "../../pdf-worker/generate_pdf.py"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    throw new Error("generate_pdf.py not found. Expected at pdf-worker/generate_pdf.py");
}
async function runPythonWorker(payload) {
    return new Promise((resolve, reject) => {
        const python = findPythonBin();
        const script = findScriptPath();
        const child = (0, child_process_1.spawn)(python, [script], {
            cwd: process.cwd(),
            timeout: 120_000,
        });
        const chunks = [];
        const errChunks = [];
        child.stdout.on("data", (d) => chunks.push(d));
        child.stderr.on("data", (d) => errChunks.push(d));
        child.on("error", (err) => {
            reject(new Error(`Failed to spawn Python worker: ${err.message}`));
        });
        child.on("close", (code) => {
            const stderr = Buffer.concat(errChunks).toString("utf8");
            if (stderr) {
                console.log("[python worker stderr]\n" + stderr);
            }
            if (code !== 0) {
                reject(new Error(`Python worker exited with code ${code}.\n${stderr}`));
                return;
            }
            resolve(Buffer.concat(chunks));
        });
        const json = JSON.stringify(payload);
        child.stdin.write(json, "utf8");
        child.stdin.end();
    });
}
let TransactionsPdfService = TransactionsPdfService_1 = class TransactionsPdfService {
    constructor() {
        this.logger = new common_1.Logger(TransactionsPdfService_1.name);
    }
    async generatePdf(id, res) {
        this.logger.log(`Starting PDF generation for transaction: ${id}`);
        if (!mongodb_1.ObjectId.isValid(id)) {
            throw new common_1.NotFoundException("المعاملة غير موجودة");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const tx = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!tx)
            throw new common_1.NotFoundException("المعاملة غير موجودة");
        this.logger.log(`Transaction found: ${tx.assignmentNumber || id}`);
        const ev = { ...(0, transactions_model_1.emptyEvalData)(), ...(tx.evalData ?? {}) };
        const attachmentDocs = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .find({ transactionId: id })
            .sort({ uploadedAt: 1 })
            .toArray();
        const imageDocs = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId: id })
            .sort({ sortIndex: 1 })
            .toArray();
        this.logger.log(`Attachments: ${attachmentDocs.length}, images: ${imageDocs.length}`);
        const bl = {};
        for (const [, entry] of Object.entries(tx.templateFieldValues ?? {})) {
            if (entry?.label)
                bl[entry.label] = entry.value ?? "";
        }
        const compRows = (ev.comparisonRows ?? []).filter((r) => r.inReport !== false);
        const seenUris = new Set();
        const images = [];
        for (const img of imageDocs) {
            const dataUri = fileToDataUri(img.filePath);
            if (!dataUri) {
                this.logger.warn(`Image not found: ${img.filePath}`);
                continue;
            }
            const key = dataUri.substring(0, 120);
            if (seenUris.has(key)) {
                this.logger.warn(`Skipping duplicate image: ${img.name || img.originalName}`);
                continue;
            }
            seenUris.add(key);
            images.push({ dataUri, name: img.name || img.originalName });
        }
        const imageAttachments = [];
        const pdfAttachments = [];
        const otherAttachments = [];
        for (const att of attachmentDocs) {
            if (att.mimeType.startsWith("image/")) {
                const dataUri = fileToDataUri(att.filePath);
                if (!dataUri) {
                    this.logger.warn(`Image attachment not found: ${att.filePath}`);
                    continue;
                }
                const key = dataUri.substring(0, 120);
                if (seenUris.has(key))
                    continue;
                seenUris.add(key);
                imageAttachments.push({ dataUri, name: att.name || att.originalName });
            }
            else if (att.mimeType === "application/pdf") {
                const abs = resolveFilePath(att.filePath);
                if (!fs.existsSync(abs)) {
                    this.logger.warn(`PDF attachment not found: ${abs}`);
                    continue;
                }
                pdfAttachments.push({
                    filePath: abs,
                    name: att.name || att.originalName,
                    size: att.size,
                    mimeType: att.mimeType,
                });
            }
            else {
                otherAttachments.push({
                    name: att.name || att.originalName,
                    size: att.size,
                    mimeType: att.mimeType,
                });
            }
        }
        this.logger.log(`Payload: ${images.length} property images, ${imageAttachments.length} image attachments, ` +
            `${pdfAttachments.length} PDF attachments, ${otherAttachments.length} others`);
        const payload = {
            fontDir: path.join(process.cwd(), "assets/fonts"),
            tx: { ...tx, _id: id },
            ev,
            bl,
            compRows,
            images,
            imageAttachments,
            pdfAttachments,
            otherAttachments,
            labelMaps: {
                valuationPurposes: VALUATION_PURPOSES,
                valuationBases: VALUATION_BASES,
                ownershipTypes: OWNERSHIP_TYPES,
                valuationHypotheses: VALUATION_HYPOTHESES,
                propertyTypes: PROPERTY_TYPES,
                regions: REGIONS,
                buildingStates: BUILDING_STATES,
                finishLevels: FINISH_LEVELS,
                buildQuality: BUILD_QUALITY,
            },
        };
        this.logger.log(`Calling Python PDF worker...`);
        let pdfBuffer;
        try {
            pdfBuffer = await runPythonWorker(payload);
        }
        catch (err) {
            this.logger.error(`Python worker failed: ${err.message}`);
            res.status(500).json({
                error: "Failed to generate PDF",
                details: err.message,
            });
            return;
        }
        this.logger.log(`PDF generated: ${pdfBuffer.length} bytes`);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="valuation-${id}.pdf"`);
        res.end(pdfBuffer);
        this.logger.log(`PDF sent successfully`);
    }
};
exports.TransactionsPdfService = TransactionsPdfService;
exports.TransactionsPdfService = TransactionsPdfService = TransactionsPdfService_1 = __decorate([
    (0, common_1.Injectable)()
], TransactionsPdfService);
