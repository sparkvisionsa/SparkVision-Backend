import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Response } from "express";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import { getMongoDb } from "@/server/mongodb";
import {
  TRANSACTIONS_COLLECTION,
  type TransactionDoc,
  emptyEvalData,
} from "./transactions.model";
import {
  ATTACHMENTS_COLLECTION,
  IMAGES_COLLECTION,
  type AttachmentDoc,
  type ImageDoc,
} from "./transactions-media.model";

// ─── Label maps (kept here so the Python script doesn't need them hard-coded) ──

const VALUATION_PURPOSES: Record<string, string> = {
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
const VALUATION_BASES: Record<string, string> = {
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
const OWNERSHIP_TYPES: Record<string, string> = {
  "1": "الملكية المطلقة",
  "2": "الملكية المشروطة",
  "3": "الملكية المقيدة",
  "4": "ملكية مدى الحياة",
  "5": "منفعة",
  "6": "مشاع",
  "7": "ملكية مرهونة",
};
const VALUATION_HYPOTHESES: Record<string, string> = {
  "1": "الاستخدام الحالي",
  "2": "الاستخدام الأعلى والأفضل",
  "3": "التصفية المنظمة",
  "4": "البيع القسري",
};
const PROPERTY_TYPES: Record<string, string> = {
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
const REGIONS: Record<string, string> = {
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
const BUILDING_STATES: Record<string, string> = {
  "10001": "جديد",
  "10002": "مستخدم",
  "10003": "تحت الإنشاء",
  "10004": "اخرى",
};
const FINISH_LEVELS: Record<string, string> = {
  "23": "تشطيب فاخر",
  "24": "تشطيب متوسط",
  "25": "تشطيب عادي",
  "10006": "بدون تشطيب",
};
const BUILD_QUALITY: Record<string, string> = {
  "44": "ممتاز",
  "45": "جيد جداً",
  "46": "ردئ",
  "10058": "جيد",
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fileToDataUri(filePath: string): string | null {
  try {
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return null;
    const buf = fs.readFileSync(abs);
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };
    const mime = mimeMap[ext] ?? "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);
}

// ─── Python worker invocation ──────────────────────────────────────────────────

/**
 * Finds the Python executable to use.
 * Looks for a venv at <cwd>/pdf-worker/venv first, then falls back to
 * `python3` / `python` on PATH.
 */
function findPythonBin(): string {
  const venvPaths = [
    path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
    path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"), // Windows
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "python3"; // fallback — must be on PATH
}

function findScriptPath(): string {
  const candidates = [
    path.join(process.cwd(), "pdf-worker", "generate_pdf.py"),
    path.join(__dirname, "generate_pdf.py"),
    path.join(__dirname, "../../pdf-worker/generate_pdf.py"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "generate_pdf.py not found. Expected at pdf-worker/generate_pdf.py",
  );
}

async function runPythonWorker(payload: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const python = findPythonBin();
    const script = findScriptPath();

    const child = spawn(python, [script], {
      cwd: process.cwd(),
      timeout: 120_000, // 2 min hard limit
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Python worker: ${err.message}`));
    });

    child.on("close", (code) => {
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (stderr) {
        // Log Python's stderr (debug info + errors) but don't fail on it
        console.log("[python worker stderr]\n" + stderr);
      }
      if (code !== 0) {
        reject(new Error(`Python worker exited with code ${code}.\n${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    // Write JSON payload to stdin and close it
    const json = JSON.stringify(payload);
    child.stdin.write(json, "utf8");
    child.stdin.end();
  });
}

// ─── PDF Service ───────────────────────────────────────────────────────────────

@Injectable()
export class TransactionsPdfService {
  private readonly logger = new Logger(TransactionsPdfService.name);

  async generatePdf(id: string, res: Response): Promise<void> {
    this.logger.log(`Starting PDF generation for transaction: ${id}`);

    if (!ObjectId.isValid(id)) {
      throw new NotFoundException("المعاملة غير موجودة");
    }

    const db = await getMongoDb();
    const tx = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });

    if (!tx) throw new NotFoundException("المعاملة غير موجودة");

    this.logger.log(`Transaction found: ${tx.assignmentNumber || id}`);

    const ev = { ...emptyEvalData(), ...(tx.evalData ?? {}) };

    // ── Attachments ────────────────────────────────────────────────────────────
    const attachmentDocs = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .find({ transactionId: id })
      .sort({ uploadedAt: 1 })
      .toArray();

    const imageDocs = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ transactionId: id })
      .sort({ sortIndex: 1 })
      .toArray();

    this.logger.log(
      `Attachments: ${attachmentDocs.length}, images: ${imageDocs.length}`,
    );

    // ── Build label map ────────────────────────────────────────────────────────
    const bl: Record<string, string> = {};
    for (const [, entry] of Object.entries(tx.templateFieldValues ?? {})) {
      if (entry?.label) bl[entry.label] = entry.value ?? "";
    }

    // ── Comparison rows ────────────────────────────────────────────────────────
    const compRows = (ev.comparisonRows ?? []).filter(
      (r: any) => r.inReport !== false,
    );

    // ── Load image data URIs — property images ─────────────────────────────────
    const seenUris = new Set<string>();
    const images: { dataUri: string; name: string }[] = [];

    for (const img of imageDocs) {
      const dataUri = fileToDataUri(img.filePath);
      if (!dataUri) {
        this.logger.warn(`Image not found: ${img.filePath}`);
        continue;
      }
      // Deduplicate by first 120 chars of base64 to avoid identical files
      const key = dataUri.substring(0, 120);
      if (seenUris.has(key)) {
        this.logger.warn(
          `Skipping duplicate image: ${img.name || img.originalName}`,
        );
        continue;
      }
      seenUris.add(key);
      images.push({ dataUri, name: img.name || img.originalName });
    }

    // ── Load image attachment data URIs ────────────────────────────────────────
    const imageAttachments: { dataUri: string; name: string }[] = [];
    const pdfAttachments: {
      filePath: string;
      name: string;
      size: number;
      mimeType: string;
    }[] = [];
    const otherAttachments: { name: string; size: number; mimeType: string }[] =
      [];

    for (const att of attachmentDocs) {
      if (att.mimeType.startsWith("image/")) {
        const dataUri = fileToDataUri(att.filePath);
        if (!dataUri) {
          this.logger.warn(`Image attachment not found: ${att.filePath}`);
          continue;
        }
        const key = dataUri.substring(0, 120);
        if (seenUris.has(key)) continue;
        seenUris.add(key);
        imageAttachments.push({ dataUri, name: att.name || att.originalName });
      } else if (att.mimeType === "application/pdf") {
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
      } else {
        otherAttachments.push({
          name: att.name || att.originalName,
          size: att.size,
          mimeType: att.mimeType,
        });
      }
    }

    this.logger.log(
      `Payload: ${images.length} property images, ${imageAttachments.length} image attachments, ` +
        `${pdfAttachments.length} PDF attachments, ${otherAttachments.length} others`,
    );

    // ── Build payload for Python ───────────────────────────────────────────────
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

    // ── Call Python worker ─────────────────────────────────────────────────────
    this.logger.log(`Calling Python PDF worker...`);
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await runPythonWorker(payload);
    } catch (err) {
      this.logger.error(`Python worker failed: ${(err as Error).message}`);
      res.status(500).json({
        error: "Failed to generate PDF",
        details: (err as Error).message,
      });
      return;
    }

    this.logger.log(`PDF generated: ${pdfBuffer.length} bytes`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="valuation-${id}.pdf"`,
    );
    res.end(pdfBuffer);
    this.logger.log(`PDF sent successfully`);
  }
}
