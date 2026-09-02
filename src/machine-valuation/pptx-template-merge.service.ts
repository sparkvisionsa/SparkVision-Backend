import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Response } from "express";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { ObjectId } from "mongodb";
import sharp from "sharp";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import { loadOwnedCompanyPptxTemplateBufferFromGridFs } from "@/server/auth-tracking/service";
import { getMongoDb } from "@/server/mongodb";
import { MachineValuationService } from "./machine-valuation.service";
import type { MvAccessContext } from "./types";
import {
  convertPptxToPdf,
  isPptxPdfConversionAvailable,
  machineValuationPdfTimeoutMs,
} from "./docx-to-pdf";
import { storePendingPdfExport, takePendingPdfExport } from "./pending-pdf-export";

type PptxMergeRequest = {
  /** Selects one of the owning company's saved PowerPoint templates. */
  templateId?: string;
  /** Kept explicit in the API contract: the merge always reads the saved project state. */
  useStoredProjectState?: boolean;
  /** Convert the merged PowerPoint to PDF and expose a download token. */
  alsoPdf?: boolean;
  /** Optional per-export overrides; saved report settings remain the defaults. */
  imageLayout?: {
    assetImagesPerRow?: number;
    clientImagesPerRow?: number;
  };
};

type PptxWorkerStats = {
  variablesFound: string[];
  variablesFilled: number;
  assetImagesInserted: number;
  assetImageMarkers: number;
  valuationImagesInserted: number;
  valuationImageMarkers: number;
  clientImagesInserted: number;
  clientImageMarkers: number;
  slidesAdded: number;
  warnings: string[];
};

type PptxImageLayout = {
  assetImagesPerRow: number;
  clientImagesPerRow: number;
};

type PptxWorkerManifest = {
  templatePath: string;
  outputPath: string;
  textValues: Record<string, string>;
  assetImagePaths: string[];
  valuationImagePaths: string[];
  clientImagePaths: string[];
  imageLayout: PptxImageLayout;
  /** Values intentionally left unchanged in this company's template. */
  excludedVariableNames?: string[];
  /** Placeholder names that act as image anchors on a slide. */
  assetImageMarkerVariables?: string[];
  valuationImageMarkerVariables?: string[];
  clientImageMarkerVariables?: string[];
};

type StoredTemplateVariableMapping = {
  variable: string;
  sourceKey: string;
  staticValue?: string;
};

type StoredCompanyPresentationTemplate = {
  id?: string;
  fileName?: string;
  fileUrl?: string | null;
  gridFsFileId?: string | null;
  variableMappings?: unknown;
  excludedVariableNames?: unknown;
};

type CompanyPptxTemplateConfiguration = {
  /** The owning company is part of the storage boundary, not browser input. */
  companyId: string | null;
  template: StoredCompanyPresentationTemplate | null;
  mappings: StoredTemplateVariableMapping[];
  excludedVariableNames: string[];
};

const MAX_PPTX_ASSET_IMAGES = 500;
const MAX_PPTX_WORKSPACE_IMAGES = 200;

function sanitizePptxImageLayout(value: unknown): PptxImageLayout {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const perRow = (raw: unknown, fallback: number) => {
    const value = Math.trunc(Number(raw));
    return Number.isFinite(value) ? Math.max(1, Math.min(6, value)) : fallback;
  };
  return {
    assetImagesPerRow: perRow(input.assetImagesPerRow, 3),
    clientImagesPerRow: perRow(input.clientImagesPerRow, 2),
  };
}

const PPTX_TEMPLATE_VARIABLE_KEYS = [
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

type PptxTemplateVariableKey = (typeof PPTX_TEMPLATE_VARIABLE_KEYS)[number];

/** Arabic Word-template variables remain valid in PowerPoint templates. */
const PPTX_TEMPLATE_VARIABLE_ALIASES: Record<string, PptxTemplateVariableKey> = {
  "\u0639\u0646\u0648\u0627\u0646_\u0627\u0644\u062a\u0642\u0631\u064a\u0631": "reportTitle",
  "\u0627\u0644\u0639\u0645\u064a\u0644": "clientName",
  "\u062a\u0627\u0631\u064a\u062e_\u0625\u0635\u062f\u0627\u0631_\u0627\u0644\u062a\u0642\u0631\u064a\u0631": "reportIssueDate",
  "\u0627\u0644\u0631\u0642\u0645_\u0627\u0644\u0645\u0631\u062c\u0639\u064a": "reportReference",
  "\u0627\u0633\u0644\u0648\u0628_\u0627\u0644\u062a\u0642\u064a\u064a\u0645": "valuationMethod",
  "\u0623\u0633\u0644\u0648\u0628_\u0627\u0644\u062a\u0642\u064a\u064a\u0645": "valuationMethod",
  "\u0627\u0644\u0623\u0633\u0644\u0648\u0628_\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645": "valuationMethod",
  "\u0627\u0644\u063a\u0631\u0636_\u0645\u0646_\u0627\u0644\u062a\u0642\u064a\u064a\u0645": "valuationPurpose",
  "\u0627\u0633\u0627\u0633_\u0627\u0644\u0642\u064a\u0645\u0629": "valuationBasis",
  "\u0623\u0633\u0627\u0633_\u0627\u0644\u0642\u064a\u0645\u0629": "valuationBasis",
  "\u062a\u0627\u0631\u064a\u062e_\u0627\u0644\u062a\u0642\u064a\u064a\u0645": "valuationDate",
  "\u062a\u0627\u0631\u064a\u062e_\u0627\u0644\u0627\u062a\u0641\u0627\u0642\u064a\u0629": "agreementDate",
  "\u062a\u0627\u0631\u064a\u062e_\u0627\u0644\u0645\u0639\u0627\u064a\u0646\u0629": "inspectionDate",
  "\u0623\u0635\u0644\u0623\u0635\u0648\u0644": "assetSingularPlural",
  "\u0646\u0634\u0627\u0637_\u0627\u0644\u0634\u0631\u0643\u0629": "clientActivity",
  "\u0645\u0645\u062b\u0644_\u0627\u0644\u0639\u0645\u064a\u0644": "clientRepresentativeName",
  "\u0635\u0641\u0629": "clientRepresentativeRole",
  "\u0647\u0648\u064a\u0629_\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\u064a\u0646_\u0627\u0644\u0623\u062e\u0631\u064a\u0646": "intendedUsers",
  "\u0627\u0644\u0623\u0635\u0644_\u0627\u0644\u0645\u0639\u0646\u064a\u0629_\u0627\u0644\u0623\u0635\u0644_\u0645\u062d\u0644_\u0627\u0644\u062a\u0642\u064a\u064a\u0645": "assetSubjectDescription",
  "\u0623\u0633\u0627\u0633_\u0627\u0644\u0642\u064a\u0645\u0629_\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645": "valuationBasisDefinition",
  "\u0641\u0631\u0636\u064a\u0629_\u0627\u0644\u0642\u064a\u0645\u0629": "valuePremiseDefinition",
  "\u0627\u0644\u0645\u062f\u064a\u0646\u0629": "inspectionLocation",
  "\u0631\u0627\u0628\u0637_\u0642\u0648\u0642\u0644_\u0645\u0627\u0628": "inspectionMapUrl",
  "\u0631\u0623\u064a_\u0627\u0644\u0642\u064a\u0645\u0629_\u0631\u0642\u0645\u0627_\u0648\u0643\u062a\u0627\u0628\u0629": "finalValueOpinion",
};

function sanitizeForXml(value: string): string {
  return value
    .replace(/[\uD800-\uDFFF]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "")
    .trim();
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
    .replace(/[\u0660-\u0669]/g, (digit) => String("\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669".indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String("\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9".indexOf(digit)))
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
  const withCurrency = `(${amount} \u0631.\u0633)`;
  return words ? `${withCurrency}${words}` : withCurrency;
}

function buildClientIdentity(reportData: Record<string, unknown>): string {
  return [
    String(reportData.clientLegalType || "").trim(),
    String(reportData.clientRepresentativeName || "").trim(),
    String(reportData.clientRepresentativeRole || "").trim(),
    String(reportData.intendedUsers || "").trim(),
  ]
    .filter(Boolean)
    .join(" — ");
}

/** Keep arbitrary values required by a company's own PowerPoint template. */
function sanitizeVariableOverrides(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, 300)) {
    const safeKey = normalizeTemplateVariableName(key);
    if (!safeKey) continue;
    if (value != null && typeof value !== "string" && typeof value !== "number") continue;
    out[safeKey] = sanitizeForXml(String(value ?? "")).slice(0, 50_000);
  }
  return out;
}

function normalizeTemplateVariableName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim()
    .slice(0, 180);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStoredTemplateMappings(value: unknown): StoredTemplateVariableMapping[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: StoredTemplateVariableMapping[] = [];
  for (const row of value.slice(0, 300)) {
    const item = asRecord(row);
    if (!item) continue;
    const variable = normalizeTemplateVariableName(item.variable);
    const sourceKey = normalizeTemplateVariableName(item.sourceKey ?? item.source);
    if (!variable || !sourceKey || seen.has(variable)) continue;
    seen.add(variable);
    const staticValue =
      typeof item.staticValue === "string" || typeof item.staticValue === "number"
        ? sanitizeForXml(String(item.staticValue)).slice(0, 50_000)
        : undefined;
    output.push({ variable, sourceKey, ...(staticValue !== undefined ? { staticValue } : {}) });
  }
  return output;
}

function readExcludedTemplateVariableNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .slice(0, 300)
      .map(normalizeTemplateVariableName)
      .filter(Boolean),
  )];
}

const IMAGE_MARKER_SOURCE_KEYS = new Set(["images.asset", "images.valuation", "images.client"]);

function dynamicPptxTemplateValues(
  baseValues: Record<string, string>,
  mappings: readonly StoredTemplateVariableMapping[],
): {
  textValues: Record<string, string>;
  assetImageMarkerVariables: string[];
  valuationImageMarkerVariables: string[];
  clientImageMarkerVariables: string[];
} {
  const textValues = { ...baseValues };
  const assetImageMarkerVariables: string[] = [];
  const valuationImageMarkerVariables: string[] = [];
  const clientImageMarkerVariables: string[] = [];
  for (const mapping of mappings) {
    if (IMAGE_MARKER_SOURCE_KEYS.has(mapping.sourceKey)) {
      // Do not put an empty scalar under this key: the PPTX worker needs the
      // visible placeholder to locate the image anchor shape.
      delete textValues[mapping.variable];
      if (mapping.sourceKey === "images.asset") {
        assetImageMarkerVariables.push(mapping.variable);
      } else if (mapping.sourceKey === "images.valuation") {
        valuationImageMarkerVariables.push(mapping.variable);
      } else {
        clientImageMarkerVariables.push(mapping.variable);
      }
      continue;
    }
    // `field:<name>` is a deliberately flat, safe escape hatch for a report
    // text override or a future catalogue field. It never dereferences a
    // client-provided object path; it can only read an already-built value.
    const fieldKey = mapping.sourceKey.startsWith("field:")
      ? normalizeTemplateVariableName(mapping.sourceKey.slice("field:".length))
      : mapping.sourceKey;
    const value =
      mapping.sourceKey === "static"
        ? mapping.staticValue ?? ""
        : Object.prototype.hasOwnProperty.call(baseValues, fieldKey)
          ? baseValues[fieldKey] ?? ""
          : mapping.staticValue ?? "";
    textValues[mapping.variable] = sanitizeForXml(value).slice(0, 50_000);
  }
  return {
    textValues,
    assetImageMarkerVariables: [...new Set(assetImageMarkerVariables)],
    valuationImageMarkerVariables: [...new Set(valuationImageMarkerVariables)],
    clientImageMarkerVariables: [...new Set(clientImageMarkerVariables)],
  };
}

/** Same project-to-template field mapping used by the Word merge path. */
function buildPptxTextValues(
  reportData: Record<string, unknown>,
  projectName: string,
  displayNumber?: unknown,
): Record<string, string> {
  const raw: Record<PptxTemplateVariableKey, string> = {
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
    assetSingularPlural: String(reportData.assetSingularPlural || "\u0623\u0635\u0644/\u0623\u0635\u0648\u0644").trim(),
    clientActivity: String(reportData.clientActivity || "").trim(),
    clientRepresentativeName: String(reportData.clientRepresentativeName || "").trim(),
    clientRepresentativeRole: String(reportData.clientRepresentativeRole || "").trim(),
    intendedUsers: String(reportData.intendedUsers || "").trim(),
    assetSubjectDescription: String(
      reportData.assetSubjectDescription || "\u0627\u0644\u0627\u062a \u0648\u0645\u0639\u062f\u0627\u062a \u0648\u0627\u062c\u0647\u0632\u0629 \u0645\u062a\u0646\u0648\u0639\u0647",
    ).trim(),
    valuationBasisDefinition: String(reportData.valuationBasisDefinition || "").trim(),
    valuePremiseDefinition: String(reportData.valuePremiseDefinition || "").trim(),
    inspectionLocation: String(reportData.inspectionLocation || "").trim(),
    inspectionMapUrl: String(reportData.inspectionMapUrl || "").trim(),
    finalValueOpinion: formatFinalValueOpinion(reportData),
  };

  const values: Record<string, string> = {};
  for (const key of PPTX_TEMPLATE_VARIABLE_KEYS) values[key] = sanitizeForXml(raw[key]);
  Object.assign(values, sanitizeVariableOverrides(reportData.reportTextOverrides));
  const numericDisplayNumber =
    typeof displayNumber === "number" && Number.isFinite(displayNumber)
      ? String(displayNumber)
      : "";
  const finalValueAmount = formatFinalValueAmount(reportData.finalValue);
  Object.assign(values, {
    projectName: sanitizeForXml(projectName),
    displayNumber: numericDisplayNumber,
    clientId: sanitizeForXml(String(reportData.clientId || "")),
    clientEmail: sanitizeForXml(String(reportData.clientEmail || "")),
    clientPhone: sanitizeForXml(String(reportData.clientPhone || "")),
    clientLegalType: sanitizeForXml(String(reportData.clientLegalType || "")),
    clientIdentity: sanitizeForXml(buildClientIdentity(reportData)),
    intendedUse: sanitizeForXml(String(reportData.intendedUse || "")),
    assetDetailedDescription: sanitizeForXml(String(reportData.assetDetailedDescription || "")),
    reportTypeLabel: sanitizeForXml(String(reportData.reportTypeLabel || "")),
    standardsVersion: sanitizeForXml(String(reportData.standardsVersion || "")),
    currencyLabel: sanitizeForXml(String(reportData.currencyLabel || "")),
    valuePremise: sanitizeForXml(String(reportData.valuePremise || "")),
    finalValue: finalValueAmount,
    finalValueAmount,
    finalValueWords: sanitizeForXml(String(reportData.finalValueWords || "")),
    valuationFirmName: sanitizeForXml(String(reportData.valuationFirmName || "")),
    valuationFirmLicense: sanitizeForXml(String(reportData.valuationFirmLicense || "")),
    valuationFirmAddress: sanitizeForXml(String(reportData.valuationFirmAddress || "")),
    leadValuerName: sanitizeForXml(String(reportData.leadValuerName || "")),
    leadValuerTitle: sanitizeForXml(String(reportData.leadValuerTitle || "")),
    leadValuerMembershipNo: sanitizeForXml(String(reportData.leadValuerMembershipNo || "")),
    scopeOfWorkDetails: sanitizeForXml(String(reportData.scopeOfWorkDetails || "")),
    useRestriction: sanitizeForXml(String(reportData.useRestriction || "")),
    externalSpecialistUse: sanitizeForXml(String(reportData.externalSpecialistUse || "")),
    esgConsiderations: sanitizeForXml(String(reportData.esgConsiderations || "")),
    informationSources: sanitizeForXml(String(reportData.informationSources || "")),
    methodologyRationale: sanitizeForXml(String(reportData.methodologyRationale || "")),
    costApproachDetails: sanitizeForXml(String(reportData.costApproachDetails || "")),
    importantAssumptions: sanitizeForXml(String(reportData.importantAssumptions || "")),
    generalAssumptions: sanitizeForXml(String(reportData.generalAssumptions || "")),
    specialAssumptions: sanitizeForXml(String(reportData.specialAssumptions || "")),
  });
  // Match the Word merge catalogue: model-defined custom report fields are
  // resolved through their stable `field:<id>` source key.
  if (Array.isArray(reportData.customFields)) {
    for (const rawField of reportData.customFields.slice(0, 120)) {
      if (!rawField || typeof rawField !== "object") continue;
      const field = rawField as Record<string, unknown>;
      const key = normalizeTemplateVariableName(field.id);
      if (!key || Object.prototype.hasOwnProperty.call(values, key)) continue;
      const value = field.value;
      values[key] =
        typeof value === "string" || typeof value === "number"
          ? sanitizeForXml(String(value)).slice(0, 50_000)
          : "";
    }
  }
  for (const [alias, key] of Object.entries(PPTX_TEMPLATE_VARIABLE_ALIASES)) {
    values[alias] = values[key] ?? "";
  }
  return values;
}

function bufferFromStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const output = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      output[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), values.length) }, () => worker()),
  );
  return output;
}

function asObjectId(value: unknown): ObjectId | null {
  if (value instanceof ObjectId) return value;
  const text = typeof value === "string" ? value.trim() : "";
  return ObjectId.isValid(text) ? new ObjectId(text) : null;
}

function companyTemplateFilePath(
  fileUrl: unknown,
  extension: ".docx" | ".pptx",
  companyId: string | null,
): string | null {
  if (typeof fileUrl !== "string" || !fileUrl.trim() || !companyId) return null;
  const raw = fileUrl.trim().replace(/\\/g, "/");
  if (!raw.toLowerCase().endsWith(extension)) return null;
  const resolveInside = (root: string, relative: string): string | null => {
    const base = path.resolve(root);
    const candidate = path.resolve(base, relative.replace(/^[/\\]+/, ""));
    return candidate === base || candidate.startsWith(`${base}${path.sep}`) ? candidate : null;
  };
  const safeCompanyId = companyId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeCompanyId) return null;
  const companyPrefix = `/uploads/company-report-templates/${safeCompanyId}/`;
  if (!raw.startsWith(companyPrefix)) return null;
  return resolveInside(
    path.join(process.cwd(), "uploads", "company-report-templates", safeCompanyId),
    raw.slice(companyPrefix.length),
  );
}

function findPythonBin(): string {
  const candidates = [
    path.join(process.cwd(), "docx-worker", "venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "docx-worker", "venv", "bin", "python"),
    path.join(process.cwd(), "docx-worker", ".venv", "Scripts", "python.exe"),
    path.join(process.cwd(), "docx-worker", ".venv", "bin", "python"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function findPptxWorkerPath(): string {
  const candidates = [
    path.join(process.cwd(), "pptx-worker", "merge_pptx.py"),
    path.join(__dirname, "..", "..", "pptx-worker", "merge_pptx.py"),
    path.join(__dirname, "..", "..", "..", "pptx-worker", "merge_pptx.py"),
  ];
  const worker = candidates.find((candidate) => fs.existsSync(candidate));
  if (!worker) throw new Error("pptx-worker/merge_pptx.py not found.");
  return worker;
}

function parseWorkerStats(stderr: string): PptxWorkerStats {
  const fallback: PptxWorkerStats = {
    variablesFound: [],
    variablesFilled: 0,
    assetImagesInserted: 0,
    assetImageMarkers: 0,
    valuationImagesInserted: 0,
    valuationImageMarkers: 0,
    clientImagesInserted: 0,
    clientImageMarkers: 0,
    slidesAdded: 0,
    warnings: [],
  };
  for (const line of stderr.trim().split(/\r?\n/).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as Partial<PptxWorkerStats>;
      return {
        variablesFound: Array.isArray(parsed.variablesFound) ? parsed.variablesFound.map(String) : [],
        variablesFilled: Number(parsed.variablesFilled ?? 0),
        assetImagesInserted: Number(parsed.assetImagesInserted ?? 0),
        assetImageMarkers: Number(parsed.assetImageMarkers ?? 0),
        valuationImagesInserted: Number(parsed.valuationImagesInserted ?? 0),
        valuationImageMarkers: Number(parsed.valuationImageMarkers ?? 0),
        clientImagesInserted: Number(parsed.clientImagesInserted ?? 0),
        clientImageMarkers: Number(parsed.clientImageMarkers ?? 0),
        slidesAdded: Number(parsed.slidesAdded ?? 0),
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).filter(Boolean) : [],
      };
    } catch {
      // Keep searching: Python can emit a traceback before the final JSON status line.
    }
  }
  return fallback;
}

function runPptxMergeWorker(manifest: PptxWorkerManifest): Promise<PptxWorkerStats> {
  const manifestPath = path.join(path.dirname(manifest.outputPath), "manifest.json");
  const imageCount =
    manifest.assetImagePaths.length + manifest.valuationImagePaths.length + manifest.clientImagePaths.length;
  const timeoutMs = Math.min(15 * 60_000, Math.max(180_000, 90_000 + imageCount * 1_500));
  return fs.promises.writeFile(manifestPath, JSON.stringify(manifest), "utf8").then(
    () => new Promise<PptxWorkerStats>((resolve, reject) => {
      const child = spawn(findPythonBin(), [findPptxWorkerPath(), manifestPath], {
        cwd: process.cwd(),
        timeout: timeoutMs,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      const stderr: Buffer[] = [];
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.on("error", (error) => reject(new Error(`Python: ${error.message}`)));
      child.on("close", (code, signal) => {
        const output = Buffer.concat(stderr).toString("utf8");
        if (output) console.log(`[pptx-worker]\n${output}`);
        if (code !== 0) {
          const signalHint = signal ? ` signal=${signal}` : "";
          reject(new Error(`pptx-worker exited ${code ?? "unknown"}${signalHint}: ${output.slice(0, 700)}`));
          return;
        }
        if (!fs.existsSync(manifest.outputPath)) {
          reject(new Error("pptx-worker finished but the output file is missing."));
          return;
        }
        resolve(parseWorkerStats(output));
      });
    }),
  );
}

function pipeFileToResponse(filePath: string, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    stream.on("error", done);
    res.on("finish", () => done());
    res.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
        done(new Error("response closed before the PowerPoint download finished"));
      }
    });
    stream.pipe(res);
  });
}

let pptxMergeQueueTail: Promise<unknown> = Promise.resolve();

function enqueuePptxMerge<T>(task: () => Promise<T>): Promise<T> {
  const run = pptxMergeQueueTail.then(task, task);
  pptxMergeQueueTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

@Injectable()
export class PptxTemplateMergeService {
  private readonly logger = new Logger(PptxTemplateMergeService.name);

  constructor(private readonly mvService: MachineValuationService) {}

  private async resolveCompanyPptxTemplateConfiguration(
    projectCompanyId: unknown,
    ctx: MvAccessContext,
    requestedTemplateId?: string,
  ): Promise<CompanyPptxTemplateConfiguration> {
    const companyId = asObjectId(projectCompanyId ?? ctx.companyId);
    if (!companyId) {
      return { companyId: null, template: null, mappings: [], excludedVariableNames: [] };
    }
    try {
      const db = await getMongoDb();
      const { companies } = getAuthCollections(db);
      const company = await companies.findOne({ _id: companyId });
      const reportDefaults = asRecord((company as unknown as Record<string, unknown> | null)?.reportDefaults);
      const topLevelMappings = asRecord(reportDefaults?.variableMappings)?.pptx;
      const topLevelExclusions = asRecord(reportDefaults?.excludedVariables)?.pptx;
      const templateRows = Array.isArray(reportDefaults?.pptxTemplates)
        ? reportDefaults.pptxTemplates.map(asRecord).filter((row): row is Record<string, unknown> => row != null)
        : [];
      const legacyTemplate = asRecord(reportDefaults?.pptxTemplate);
      const templateData = requestedTemplateId
        ? templateRows.find((row) => normalizeTemplateVariableName(row.id) === requestedTemplateId) ??
          (templateRows.length === 0 && legacyTemplate && (
            normalizeTemplateVariableName(legacyTemplate.id) === requestedTemplateId ||
            (!normalizeTemplateVariableName(legacyTemplate.id) && requestedTemplateId === "pptx-template-1")
          )
            ? legacyTemplate
            : null)
        : templateRows[0] ?? legacyTemplate;
      if (!templateData) {
        return {
          companyId: companyId.toString(),
          template: null,
          mappings: readStoredTemplateMappings(topLevelMappings),
          excludedVariableNames: readExcludedTemplateVariableNames(topLevelExclusions),
        };
      }
      const template: StoredCompanyPresentationTemplate = {
        id: typeof templateData.id === "string" ? templateData.id : undefined,
        fileName: typeof templateData.fileName === "string" ? templateData.fileName : undefined,
        fileUrl: typeof templateData.fileUrl === "string" ? templateData.fileUrl : null,
        gridFsFileId: typeof templateData.gridFsFileId === "string" ? templateData.gridFsFileId : null,
        variableMappings: templateData.variableMappings,
        excludedVariableNames: templateData.excludedVariableNames,
      };
      return {
        companyId: companyId.toString(),
        template,
        mappings: readStoredTemplateMappings(template.variableMappings ?? topLevelMappings),
        excludedVariableNames: readExcludedTemplateVariableNames(
          template.excludedVariableNames ?? topLevelExclusions,
        ),
      };
    } catch (error) {
      this.logger.warn(
        `Could not load company PowerPoint template configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        companyId: companyId.toString(),
        template: null,
        mappings: [],
        excludedVariableNames: [],
      };
    }
  }

  private async loadTemplateBufferFromGridFs(
    fileId: string,
    companyId: string | null,
  ): Promise<Buffer | null> {
    if (!companyId) return null;
    try {
      return await loadOwnedCompanyPptxTemplateBufferFromGridFs(fileId, companyId);
    } catch (error) {
      this.logger.warn(
        `Could not load company PowerPoint template from GridFS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async loadConfiguredPptxTemplate(
    config: CompanyPptxTemplateConfiguration,
  ): Promise<Buffer | null> {
    const stored = config.template;
    if (stored?.gridFsFileId) {
      const buffer = await this.loadTemplateBufferFromGridFs(stored.gridFsFileId, config.companyId);
      if (buffer?.subarray(0, 2).toString("utf8") === "PK") return buffer;
    }
    const storedPath = companyTemplateFilePath(stored?.fileUrl, ".pptx", config.companyId);
    if (storedPath && fs.existsSync(storedPath)) {
      try {
        const buffer = await fs.promises.readFile(storedPath);
        if (buffer.subarray(0, 2).toString("utf8") === "PK") return buffer;
      } catch (error) {
        this.logger.warn(`Could not read company PowerPoint template ${storedPath}: ${String(error)}`);
      }
    }
    return null;
  }

  async mergeAndRespond(
    projectId: string,
    ctx: MvAccessContext,
    body: PptxMergeRequest,
    res: Response,
  ): Promise<void> {
    const loaded = await this.mvService.getProject(projectId, ctx);
    const project = loaded.project;
    const reportData = (project.reportData ?? {}) as Record<string, unknown>;
    const requestedTemplateId = normalizeTemplateVariableName(body.templateId) ||
      normalizeTemplateVariableName(reportData.pptxTemplateId);
    const companyTemplateConfig = await this.resolveCompanyPptxTemplateConfiguration(
      project.companyId,
      ctx,
      requestedTemplateId || undefined,
    );
    const configuredTemplate = await this.loadConfiguredPptxTemplate(companyTemplateConfig);
    if (!configuredTemplate) {
      throw new BadRequestException(
        companyTemplateConfig.template
          ? "تعذر قراءة قالب PowerPoint المحفوظ لهذه الشركة. أعد رفع القالب من بيانات إعداد التقرير النهائي ثم أعد المحاولة."
          : requestedTemplateId
            ? "قالب PowerPoint المحدد لم يعد متاحاً لهذه الشركة. اختر قالباً آخر من صفحة التقرير النهائي."
          : "لم يتم إعداد قالب PowerPoint لهذه الشركة بعد. ارفع قالب PowerPoint من بيانات إعداد التقرير النهائي ثم أعد المحاولة.",
      );
    }

    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `mv-pptx-${projectId.slice(-8)}-`));
    const templatePath = path.join(workDir, "template.pptx");
    const outputPath = path.join(workDir, "output.pptx");
    try {
      await fs.promises.writeFile(templatePath, configuredTemplate);

      const assetDir = path.join(workDir, "asset-images");
      const valuationDir = path.join(workDir, "valuation-images");
      const clientDir = path.join(workDir, "client-images");
      await fs.promises.mkdir(assetDir, { recursive: true });
      await fs.promises.mkdir(valuationDir, { recursive: true });
      await fs.promises.mkdir(clientDir, { recursive: true });
      const [imageMaterialization, valuationMaterialization, clientMaterialization] = await Promise.all([
        this.materializeReportAssetImages(projectId, ctx, assetDir),
        this.materializeWorkspaceImages(
          projectId,
          ctx,
          (project as { valuationAccountingWorkspace?: unknown }).valuationAccountingWorkspace,
          valuationDir,
          "valuation",
        ),
        this.materializeWorkspaceImages(
          projectId,
          ctx,
          (project as { clientDocumentsWorkspace?: unknown }).clientDocumentsWorkspace,
          clientDir,
          "client",
        ),
      ]);
      const imageLayout = sanitizePptxImageLayout({
        assetImagesPerRow: reportData.pptxAssetImagesPerRow,
        clientImagesPerRow: reportData.pptxClientImagesPerRow,
        ...(body.imageLayout ?? {}),
      });
      const configuredValues = dynamicPptxTemplateValues(
        buildPptxTextValues(
          reportData,
          String(project.name || ""),
          project.displayNumber,
        ),
        companyTemplateConfig.mappings,
      );
      const stats = await enqueuePptxMerge(() => runPptxMergeWorker({
        templatePath,
        outputPath,
        textValues: configuredValues.textValues,
        assetImagePaths: imageMaterialization.paths,
        valuationImagePaths: valuationMaterialization.paths,
        clientImagePaths: clientMaterialization.paths,
        imageLayout,
        excludedVariableNames: companyTemplateConfig.excludedVariableNames,
        assetImageMarkerVariables: configuredValues.assetImageMarkerVariables,
        valuationImageMarkerVariables: configuredValues.valuationImageMarkerVariables,
        clientImageMarkerVariables: configuredValues.clientImageMarkerVariables,
      }));

      const warnings = [
        ...imageMaterialization.warnings,
        ...valuationMaterialization.warnings,
        ...clientMaterialization.warnings,
        ...stats.warnings,
      ];
      if (stats.assetImagesInserted < imageMaterialization.paths.length) {
        warnings.push(
          `Inserted ${stats.assetImagesInserted} of ${imageMaterialization.paths.length} prepared asset image(s).`,
        );
      }
      if (imageMaterialization.requested > 0 && stats.assetImageMarkers === 0) {
        warnings.push("No PowerPoint image marker was found, so asset images were not placed.");
      }
      if (warnings.length > 0) {
        this.logger.warn(`PPTX merge warnings for ${projectId}: ${warnings.join(" ")}`);
      }

      const safeName = String(project.name || "report").replace(/[\\/:*?"<>|]+/g, "-") || "report";
      const fileName = `${safeName}-merged-presentation.pptx`;
      const pdfName = `${safeName}-merged-presentation.pdf`;
      const fileStat = await fs.promises.stat(outputPath);
      res.setHeader("X-Pptx-Merge-Stats", encodeURIComponent(JSON.stringify({ ...stats, warnings })));
      if (warnings.length > 0) {
        res.setHeader("X-Pptx-Merge-Warnings", encodeURIComponent(JSON.stringify(warnings)));
      }

      const exposeHeaders = [
        "Content-Disposition",
        "X-Pptx-Merge-Stats",
        "X-Pptx-Merge-Warnings",
        "X-Pptx-Merge-Pdf",
        "X-Pptx-Merge-Pdf-Token",
        "X-Pptx-Merge-Pdf-Error",
        "X-Pptx-Merge-Pdf-Available",
      ];

      if (body.alsoPdf === true) {
        try {
          const pdfStartedAt = Date.now();
          const pdfPath = await convertPptxToPdf(outputPath, workDir, {
            timeoutMs: machineValuationPdfTimeoutMs(
              imageMaterialization.paths.length +
                valuationMaterialization.paths.length +
                clientMaterialization.paths.length,
            ),
          });
          this.logger.log(
            `PowerPoint→PDF conversion completed for ${projectId} in ${Date.now() - pdfStartedAt}ms`,
          );
          const pdfToken = storePendingPdfExport({
            projectId,
            sourcePdfPath: pdfPath,
            fileName: pdfName,
          });
          res.setHeader("X-Pptx-Merge-Pdf", "1");
          res.setHeader("X-Pptx-Merge-Pdf-Token", pdfToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`PowerPoint→PDF conversion failed for ${projectId}: ${msg}`);
          res.setHeader("X-Pptx-Merge-Pdf", "0");
          res.setHeader("X-Pptx-Merge-Pdf-Error", encodeURIComponent(msg.slice(0, 300)));
        }
      } else {
        res.setHeader(
          "X-Pptx-Merge-Pdf-Available",
          isPptxPdfConversionAvailable() ? "1" : "0",
        );
      }

      res.setHeader("Access-Control-Expose-Headers", exposeHeaders.join(", "));
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
      res.setHeader("Content-Length", String(fileStat.size));
      await pipeFileToResponse(outputPath, res);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`PPTX merge failed for ${projectId}: ${message}`);
      throw new BadRequestException(`Could not merge the PowerPoint template: ${message}`);
    } finally {
      fs.rm(workDir, { recursive: true, force: true }, () => undefined);
    }
  }

  async respondWithPendingPdf(
    projectId: string,
    token: string,
    res: Response,
  ): Promise<void> {
    const row = takePendingPdfExport(projectId, token);
    if (!row) {
      throw new NotFoundException("انتهت صلاحية ملف PDF أو الرمز غير صالح. أعد تنزيل التقرير.");
    }
    if (!fs.existsSync(row.filePath)) {
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
      fs.rm(row.filePath, { force: true }, () => undefined);
    }
  }

  private async materializeReportAssetImages(
    projectId: string,
    ctx: MvAccessContext,
    destinationDir: string,
  ): Promise<{ requested: number; paths: string[]; warnings: string[] }> {
    let fileIds: string[] = [];
    try {
      const files = await this.mvService.listProjectAssetImageFiles(projectId, ctx);
      fileIds = files
        .filter((file) => {
          const mimeType = String(file.mimeType || "").toLowerCase();
          const extension = String(file.extension || "").toLowerCase();
          const isImage =
            !mimeType.startsWith("video/") &&
            (mimeType.startsWith("image/") ||
              ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff", "heic", "heif"].includes(extension));
          return isImage && file.includeInReport === true;
        })
        .map((file) => String(file._id || "").trim())
        .filter(Boolean)
        .slice(0, MAX_PPTX_ASSET_IMAGES);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { requested: 0, paths: [], warnings: [`Could not list project asset images: ${detail}`] };
    }

    const warnings: string[] = [];
    const paths = await mapWithConcurrency(fileIds, 6, async (fileId, index) => {
      try {
        const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
        const source = await bufferFromStream(download.stream);
        if (source.byteLength < 32) throw new Error("empty image file");
        const destination = path.join(destinationDir, `asset-${String(index + 1).padStart(5, "0")}.jpeg`);
        await sharp(source, { failOn: "none", sequentialRead: true })
          .rotate()
          .resize({ width: 3200, height: 3200, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .withMetadata({ density: 150 })
          .jpeg({ quality: 92, progressive: false, chromaSubsampling: "4:4:4", mozjpeg: false })
          .toFile(destination);
        return destination;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`PPTX merge skipped asset image ${index + 1} for ${projectId}: ${detail}`);
        warnings.push(`Skipped asset image ${index + 1}.`);
        return null;
      }
    });
    return {
      requested: fileIds.length,
      paths: paths.filter((item): item is string => Boolean(item)),
      warnings,
    };
  }

  /**
   * Reads images persisted in the project workspaces, never browser URLs or
   * transient base64. This intentionally mirrors the saved-state Word export.
   */
  private async materializeWorkspaceImages(
    projectId: string,
    ctx: MvAccessContext,
    workspace: unknown,
    destinationDir: string,
    label: "valuation" | "client",
  ): Promise<{ requested: number; paths: string[]; warnings: string[] }> {
    const fileIds = this.listWorkspaceImageFileIds(workspace).slice(0, MAX_PPTX_WORKSPACE_IMAGES);
    const warnings: string[] = [];
    const paths = await mapWithConcurrency(fileIds, 4, async (fileId, index) => {
      try {
        const download = await this.mvService.getProjectFileDownload(projectId, fileId, ctx);
        const source = await bufferFromStream(download.stream);
        if (source.byteLength < 32) throw new Error("empty image file");
        const destination = path.join(destinationDir, `${label}-${String(index + 1).padStart(5, "0")}.jpeg`);
        const maxSide = label === "valuation" ? 4800 : 3200;
        await sharp(source, { failOn: "none", sequentialRead: true })
          .rotate()
          .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
          .flatten({ background: "#ffffff" })
          .withMetadata({ density: 150 })
          .jpeg({
            quality: label === "valuation" ? 96 : 92,
            progressive: false,
            chromaSubsampling: "4:4:4",
            mozjpeg: false,
          })
          .toFile(destination);
        return destination;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.warn(`PPTX merge skipped ${label} image ${index + 1} for ${projectId}: ${detail}`);
        warnings.push(`Skipped ${label} image ${index + 1}.`);
        return null;
      }
    });
    return { requested: fileIds.length, paths: paths.filter((item): item is string => Boolean(item)), warnings };
  }

  private listWorkspaceImageFileIds(workspace: unknown): string[] {
    if (!workspace || typeof workspace !== "object") return [];
    const store = workspace as { includeInReport?: unknown; images?: unknown[] };
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
}
