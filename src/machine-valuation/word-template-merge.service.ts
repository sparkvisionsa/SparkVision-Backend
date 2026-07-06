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
  PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAME,
  PRO_OPTION_BUNDLED_WORD_TEMPLATE_URL,
  resolveCompanyReportDefaults,
} from "@/server/auth-tracking/service";
import { getMongoDb } from "@/server/mongodb";

type MergePayload = {
  templateBase64: string;
  textValues: Record<string, string>;
  textByBookmarkName: Record<string, string>;
  assetImagesBase64: string[];
  valuationImagesBase64: string[];
};

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
    bookmarksFound: [],
  };
}

async function runDocxMergeWorker(payload: MergePayload): Promise<MergeWorkerResult> {
  return new Promise((resolve, reject) => {
    const python = findPythonBin();
    const script = findMergeScriptPath();
    const json = JSON.stringify(payload);
    let payloadPath: string | null = null;
    let args = [script];

    if (json.length > 4_000_000) {
      payloadPath = path.join(os.tmpdir(), `mv-docx-merge-${Date.now()}.json`);
      fs.writeFileSync(payloadPath, json, "utf8");
      args = [script, payloadPath];
    }

    const child = spawn(python, args, {
      cwd: process.cwd(),
      timeout: 180_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => errChunks.push(d));
    child.on("error", (err) => {
      if (payloadPath) fs.unlink(payloadPath, () => undefined);
      reject(new Error(`Python: ${err.message}`));
    });
    child.on("close", (code) => {
      if (payloadPath) fs.unlink(payloadPath, () => undefined);
      const stderr = Buffer.concat(errChunks).toString("utf8");
      if (stderr) console.log("[docx-worker]\n" + stderr);
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

    if (!payloadPath) {
      child.stdin.write(json, "utf8");
    }
    child.stdin.end();
  });
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

function resolveBundledWordTemplatePath(uploadUrl: string): string | null {
  const trimmed = uploadUrl.trim();
  if (trimmed !== PRO_OPTION_BUNDLED_WORD_TEMPLATE_URL) return null;
  const candidates = [
    path.resolve(process.cwd(), "public", "files", PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAME),
    path.resolve(process.cwd(), "..", "Spark-Vision", "public", "files", PRO_OPTION_BUNDLED_WORD_TEMPLATE_FILE_NAME),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
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
  const raw =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";
  if (!raw) return "";
  const dateOnly = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? raw;
  const date = new Date(`${dateOnly}T12:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
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

function formatFinalValue(value: unknown, currency?: string | null): string {
  const formatted = formatFinalValueAmount(value);
  if (!formatted) return "";
  const suffix = currency?.trim() ? ` ${currency.trim()}` : " ر.س";
  return `${formatted}${suffix}`;
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
      assetImagesBase64?: string[];
      valuationImagesBase64?: string[];
      textValues?: Record<string, string>;
      textByBookmarkName?: Record<string, string>;
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
      throw new BadRequestException("لم يُرفع قالب Word للمشروع أو للشركة.");
    }

    let assetImagesBase64: string[] = [...(body.assetImagesBase64 ?? [])];
    const valuationImagesBase64: string[] = [...(body.valuationImagesBase64 ?? [])];

    if (assetImagesBase64.length === 0 && (body.assetImageUrls?.length ?? 0) > 0) {
      const loaded = await Promise.all(
        (body.assetImageUrls ?? []).map((url) => this.fetchImageBuffer(url, ctx)),
      );
      for (const buf of loaded) {
        if (buf) assetImagesBase64.push(buf.toString("base64"));
      }
    }
    const storedAssetImagesBase64 = await this.loadStoredAssetImagesBase64(projectId, ctx);
    if (storedAssetImagesBase64.length > assetImagesBase64.length) {
      assetImagesBase64 = storedAssetImagesBase64;
    }
    if (valuationImagesBase64.length === 0 && (body.valuationImageUrls?.length ?? 0) > 0) {
      const loaded = await Promise.all(
        (body.valuationImageUrls ?? []).map((url) => this.fetchImageBuffer(url, ctx)),
      );
      for (const buf of loaded) {
        if (buf) valuationImagesBase64.push(buf.toString("base64"));
      }
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
    };

    this.logger.log(
      `Merging Word for ${projectId}: ${assetImagesBase64.length} asset, ${valuationImagesBase64.length} valuation images`,
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
    const filePath = wordTemplate?.fileUrl ? resolveCompanyWordTemplatePath(wordTemplate.fileUrl) : null;
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.promises.readFile(filePath);
  }

  private async loadStoredAssetImagesBase64(projectId: string, ctx: MvAccessContext): Promise<string[]> {
    try {
      const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
      const reportImages = files.filter(
        (file) => {
          const mimeType = String(file.mimeType || "").toLowerCase();
          const extension = String(file.extension || "").toLowerCase();
          return (
            !mimeType.startsWith("video/") &&
            (mimeType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"].includes(extension))
          );
        },
      );
      const loaded = await Promise.all(
        reportImages.map(async (file) => {
          try {
            const fileId = String(file._id || "").trim();
            if (!fileId) return null;
            const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
            const buffer = await bufferFromStream(download.stream);
            return buffer.byteLength > 0 ? buffer.toString("base64") : null;
          } catch {
            return null;
          }
        }),
      );
      return loaded.filter((item): item is string => Boolean(item));
    } catch (err) {
      this.logger.warn(`Could not load stored asset images for Word merge: ${(err as Error).message}`);
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
