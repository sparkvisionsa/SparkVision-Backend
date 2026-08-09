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
import { IMAGES_COLLECTION, type ImageDoc } from "./transactions-media.model";
import { RealEstateReportTemplateService } from "./real-estate-report-template.service";

// ─── Label maps used to turn stored IDs into the Arabic labels the template
// expects. Kept intentionally small — extend as the template grows. ─────────

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

const OWNERSHIP_TYPES: Record<string, string> = {
  "1": "الملكية المطلقة",
  "2": "الملكية المشروطة",
  "3": "الملكية المقيدة",
  "4": "ملكية مدى الحياة",
  "5": "منفعة",
  "6": "مشاع",
  "7": "ملكية مرهونة",
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

function labelOrRaw(map: Record<string, string>, value: string | undefined | null): string {
  const v = (value ?? "").toString().trim();
  if (!v) return "";
  return map[v] ?? v;
}

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

// ─── Python worker invocation (same convention as pdf-worker) ────────────────

function findPythonBin(): string {
  const venvPaths = [
    path.join(process.cwd(), "docx-worker", ".venv", "bin", "python"),
    path.join(process.cwd(), "docx-worker", ".venv", "Scripts", "python.exe"),
  ];
  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "python3";
}

function findScriptPath(): string {
  const candidates = [
    path.join(process.cwd(), "docx-worker", "merge_real_estate_docx.py"),
    path.join(__dirname, "merge_real_estate_docx.py"),
    path.join(__dirname, "../../docx-worker/merge_real_estate_docx.py"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "merge_real_estate_docx.py not found. Expected at docx-worker/merge_real_estate_docx.py",
  );
}

async function runPythonWorker(payload: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const python = findPythonBin();
    const script = findScriptPath();

    const child = spawn(python, [script], {
      cwd: process.cwd(),
      timeout: 120_000,
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn Word worker: ${err.message}`));
    });

    child.on("close", (code) => {
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (stderr) {
        console.log("[word worker stderr]\n" + stderr);
      }
      if (code !== 0) {
        reject(new Error(`Word worker exited with code ${code}.\n${stderr}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    const json = JSON.stringify(payload);
    child.stdin.on("error", (err) => {
      console.error("stdin error:", err);
    });
    child.stdin.end(json, "utf8");
  });
}

// ─── Service ───────────────────────────────────────────────────────────────

@Injectable()
export class TransactionsRealEstateReportService {
  private readonly logger = new Logger(TransactionsRealEstateReportService.name);

  constructor(private readonly templateSvc: RealEstateReportTemplateService) {}

  async generateReport(id: string, res: Response): Promise<void> {
    this.logger.log(`Starting real-estate Word report for transaction: ${id}`);

    if (!ObjectId.isValid(id)) {
      throw new NotFoundException("المعاملة غير موجودة");
    }

    const db = await getMongoDb();
    const tx = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });

    if (!tx) throw new NotFoundException("المعاملة غير موجودة");

    if (!tx.companyId) {
      res.status(400).json({ error: "لا يمكن إنشاء التقرير: المعاملة غير مرتبطة بشركة." });
      return;
    }

    const template = await this.templateSvc.getTemplateForRender(tx.companyId);
    if (!template) {
      res.status(400).json({
        error: "لم يتم رفع قالب Word للتقارير العقارية لهذه الشركة بعد.",
      });
      return;
    }

    const ev = { ...emptyEvalData(), ...(tx.evalData ?? {}) };

    // ── Map transaction fields → template placeholder keys ────────────────────
    // See merge_real_estate_docx.py PLACEHOLDER_FIELDS for the Arabic ↔ key map.
    const textValues: Record<string, string> = {
      clientName: ev.ownerName || ev.clientName || "",
      clientActivity: ev.landUse || "",
      legalEntityType: "", // no dedicated field yet — extend EvalData when needed
      propertyType: ev.propertyType || labelOrRaw(PROPERTY_TYPES, ev.propertyTypeId),
      city: ev.cityName || "",
      reportNumber: tx.assignmentNumber || ev.propertyCode || "",
      valuationDate: ev.evalDate || "",
      neighborhood: ev.neighborhoodName || "",
      ownershipType: labelOrRaw(OWNERSHIP_TYPES, tx.ownershipType),
      valuationBasis: labelOrRaw(VALUATION_BASES, tx.valuationBasis),
    };

    // ── Property images (same source as the PDF worker used) ──────────────────
    const imageDocs = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ transactionId: id })
      .sort({ sortIndex: 1 })
      .toArray();

    const imagePaths: string[] = [];
    const imagesBase64: string[] = [];
    for (const img of imageDocs) {
      if (img.url) {
        try {
          const response = await fetch(img.url);
          const arrayBuffer = await response.arrayBuffer();
          imagesBase64.push(Buffer.from(arrayBuffer).toString("base64"));
        } catch {
          this.logger.warn(`Failed to fetch remote image: ${img.url}`);
        }
      } else if (img.filePath) {
        const abs = resolveFilePath(img.filePath);
        if (fs.existsSync(abs)) {
          imagePaths.push(abs);
        } else {
          this.logger.warn(`Image not found: ${img.filePath}`);
        }
      }
    }

    this.logger.log(
      `Payload: ${imagePaths.length} local images, ${imagesBase64.length} remote images`,
    );

    // ── Build payload for the Word worker ──────────────────────────────────────
    const payload = {
      templatePath: template.absolutePath,
      textValues,
      ...(imagePaths.length ? { imagePaths } : {}),
      ...(imagesBase64.length ? { imagesBase64 } : {}),
      imageLayout: {
        imagesPerRow: 3, // default — can be made a param on the endpoint later
      },
    };

    this.logger.log(`Calling Word report worker...`);
    let docxBuffer: Buffer;
    try {
      docxBuffer = await runPythonWorker(payload);
    } catch (err) {
      this.logger.error(`Word worker failed: ${(err as Error).message}`);
      res.status(500).json({
        error: "Failed to generate Word report",
        details: (err as Error).message,
      });
      return;
    }

    this.logger.log(`Word report generated: ${docxBuffer.length} bytes`);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="real-estate-report-${id}.docx"`,
    );
    res.end(docxBuffer);
    this.logger.log(`Word report sent successfully`);
  }
}
