import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { Response } from "express";
import * as path from "path";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import { PDFDocument } from "pdf-lib";
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
import { buildReportData, type SignatoryMap } from "./build-report-data";
import { COMPANIES_COLLECTION } from "@/server/auth-tracking/collections";
import { type CompanyDoc } from "@/server/auth-tracking/types";
import { renderReportHtml } from "./report-template";
import type { ReportImage, PdfAttachment, ImageAttachment, OtherAttachment } from "./report-types";

function resolveFilePath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function buildSignatoryMap(company: CompanyDoc | null): SignatoryMap {
  const map: SignatoryMap = new Map();
  if (!company) return map;

  for (const s of company.reportOnlySignatories ?? []) {
    if (!s?.id) continue;
    map.set(s.id, {
      name: s.name ?? "—",
      jobTitle: s.jobTitle ?? "—",
      membershipNo: s.membershipNo ?? "—",
      signatureImageDataUrl: s.signatureImageDataUrl ?? null,
    });
  }

  return map;
}

async function fileToDataUri(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absPath);
    const ext = path.extname(absPath).toLowerCase().replace(".", "");
    const mime = MIME_MAP[ext] ?? "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function toCloudinaryReportUrl(url: string): string | null {
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (!idx || !url.includes("res.cloudinary.com")) return null;
  if (idx === -1) return null;

  const insertAt = idx + marker.length;
  // Avoid double-inserting if this URL already carries a transformation
  // (defensive — shouldn't normally happen for stored delivery URLs).
  const rest = url.slice(insertAt);
  if (/^[a-z]_[^/]+\//.test(rest)) return null;

  return `${url.slice(0, insertAt)}w_700,q_auto:good,f_jpg/${rest}`;
}

async function toReportImageDataUri(buf: Buffer): Promise<string> {
  try {
    const resized = await sharp(buf)
      .rotate() // respect EXIF orientation before resizing
      .resize(700, null, { withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    return `data:image/jpeg;base64,${resized.toString("base64")}`;
  } catch (e) {
    // If sharp can't process it (corrupt/unsupported format), fall back to
    // embedding the original bytes rather than dropping the image.
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }
}

// ── free, keyless static map image ──────────────────────────────────────
// Tries a couple of free, no-API-key static-map renderers in order and
// falls back to a text note on the maps page if both are unreachable. The
// previous single-provider version (staticmap.openstreetmap.de only) was
// silently failing — that community server is flaky/rate-limited and was
// sometimes returning a non-2xx or an HTML error page instead of an image,
// which we weren't validating for.
//
// 1) Wikimedia Maps — free, no key, backed by Wikimedia's own infra (more
//    reliable uptime than staticmap.openstreetmap.de). No marker pin support,

// ─── Python worker invocation ──────────────────────────────────────────────────

/**
 * Finds the Python executable to use.
 * Looks for a venv at <cwd>/pdf-worker/.venv first, then falls back to
 * <cwd>/pdf-worker/venv and finally `python3` / `python` on PATH.
 */
function findPythonBin(): string {
  const venvPaths = [
    path.join(process.cwd(), "pdf-worker", ".venv", "bin", "python"),
    path.join(process.cwd(), "pdf-worker", ".venv", "Scripts", "python.exe"), // Windows
    path.join(process.cwd(), "pdf-worker", "venv", "bin", "python"),
    path.join(process.cwd(), "pdf-worker", "venv", "Scripts", "python.exe"),
  ];

  for (const p of venvPaths) {
    if (fsSync.existsSync(p)) return p;
  }

  return process.platform === "win32" ? "python" : "python3";
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "SparkVisionValuationReport/1.0" },
    });

    if (!r.ok) {
      console.warn(`Map fetch failed (${r.status} ${r.statusText}): ${url}`);
      return null;
    }

    const contentType = r.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      console.warn(
        `Map fetch returned non-image content-type "${contentType}": ${url}`,
      );
      return null;
    }

    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500) {
      console.warn(
        `Map fetch returned suspiciously small image (${buf.length} bytes)`,
      );
      return null;
    }

    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch (e) {
    console.warn(`Map fetch threw for ${url}: ${(e as Error).message}`);
    return null;
  }
}

import sharp from "sharp";

const TILE_SIZE = 256;
const MAP_WIDTH = 700;
const MAP_HEIGHT = 340;
const ZOOM = 16;

function latLngToPixel(lat: number, lng: number, zoom: number) {
  const scale = TILE_SIZE * Math.pow(2, zoom);

  const x = ((lng + 180) / 360) * scale;

  const latRad = (lat * Math.PI) / 180;
  const y =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    scale;

  return { x, y };
}

async function fetchTile(
  x: number,
  y: number,
  zoom: number,
): Promise<Buffer> {
  const max = Math.pow(2, zoom);

  // Wrap longitude around the world.
  const wrappedX = ((x % max) + max) % max;

  // Latitude cannot wrap.
  if (y < 0 || y >= max) {
    throw new Error(`Invalid OSM tile Y coordinate: ${y}`);
  }

  const url = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "SparkVisionValuationReport/1.0 (contact: aasimq194@gmail.com)",
    },
  });

  if (!response.ok) {
    throw new Error(
      `OSM tile fetch failed (${response.status} ${response.statusText}): ${url}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

async function fetchMapImage(
  lat: string | number,
  lng: string | number,
): Promise<string | null> {
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    console.warn(`Map skipped: invalid lat/lng ("${lat}", "${lng}")`);
    return null;
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    console.warn("Map skipped: GEOAPIFY_API_KEY is not configured");
    return null;
  }

  const url =
    `https://maps.geoapify.com/v1/staticmap` +
    `?style=osm-bright` +
    `&width=700` +
    `&height=340` +
    `&center=lonlat:${lngNum},${latNum}` +
    `&zoom=16` +
    `&marker=lonlat:${lngNum},${latNum};type:material;color:%23ff0000;size:medium` +
    `&apiKey=${encodeURIComponent(apiKey)}`;

  return fetchImageAsDataUri(url);
}

// Puppeteer's launch is somewhat expensive — reuse a single browser instance
// across requests within this process rather than spawning one per PDF.
let browserPromise: Promise<any> | null = null;
function getBrowser(): Promise<any> {
  if (!browserPromise) {
    browserPromise = import("puppeteer").then(({ default: puppeteer }) =>
      puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
    );
  }
  return browserPromise;
}

@Injectable()
export class TransactionsPdfHtmlService {
  private readonly logger = new Logger(TransactionsPdfHtmlService.name);

  async generatePdf(
    id: string,
    res: Response,
    disposition: "inline" | "attachment" = "attachment", // ← new param
  ): Promise<void> {
    this.logger.log(`Starting PDF generation for transaction: ${id}`);

    if (!ObjectId.isValid(id)) throw new NotFoundException("المعاملة غير موجودة");

    const db = await getMongoDb();
    const tx = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });
    if (!tx) throw new NotFoundException("المعاملة غير موجودة");

    const company = tx.companyId
         ? await db.collection<CompanyDoc>(COMPANIES_COLLECTION).findOne({ _id: new ObjectId(tx.companyId) })
         : null;
       const signatories = buildSignatoryMap(company);

       const ev = { ...emptyEvalData(), ...(tx.evalData ?? {}) };

    const [attachmentDocs, imageDocs, mapImageDataUri] = await Promise.all([
      db
        .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
        .find({ transactionId: id })
        .sort({ uploadedAt: 1 })
        .toArray(),
      db
        .collection<ImageDoc>(IMAGES_COLLECTION)
         .find({
           transactionId: ObjectId.isValid(id)
             ? { $in: [id, new ObjectId(id)] }
             : id,
         } as any)
         .sort({ sortIndex: 1 })
         .toArray(),
      fetchMapImage(ev.lat, ev.lng),
    ]);

    // ── property images (rendered inline, 3/row grid) ──
    const images: ReportImage[] = (
      await Promise.all(
        imageDocs.map(async (img): Promise<ReportImage | null> => {
          try {
            if (img.url) {
              const cloudinaryUrl = toCloudinaryReportUrl(img.url);
              if (cloudinaryUrl) {
                const r = await fetch(cloudinaryUrl);
                if (!r.ok) {
                  this.logger.warn(`Cloudinary fetch failed (${r.status}): ${cloudinaryUrl}`);
                  return null;
                }
                const buf = Buffer.from(await r.arrayBuffer());
                return {
                  dataUri: `data:image/jpeg;base64,${buf.toString("base64")}`,
                  name: img.name || img.originalName,
                };
              }
              // Non-Cloudinary remote URL — fall back to fetch + local resize.
              const r = await fetch(img.url);
              if (!r.ok) {
                this.logger.warn(`Failed to fetch remote image (${r.status}): ${img.url}`);
                return null;
              }
              const buf = Buffer.from(await r.arrayBuffer());
              const dataUri = await toReportImageDataUri(buf);
              return { dataUri, name: img.name || img.originalName };
            }

            if (img.filePath) {
              let buf: Buffer;
              try {
                buf = await fs.readFile(resolveFilePath(img.filePath));
              } catch {
                this.logger.warn(`Image not found: ${img.filePath}`);
                return null;
              }
              const dataUri = await toReportImageDataUri(buf);
              return { dataUri, name: img.name || img.originalName };
            }

            return null;
          } catch (e) {
            this.logger.warn(`Failed to process image ${img._id}: ${(e as Error).message}`);
            return null;
          }
        }),
      )
    ).filter((x): x is ReportImage => x !== null);
    // ── attachments, split by kind ──
    const pdfAttachments: PdfAttachment[] = [];
       const imageAttachments: ImageAttachment[] = [];
       const otherAttachments: OtherAttachment[] = [];

       await Promise.all(
         attachmentDocs.map(async (att) => {
           const abs = resolveFilePath(att.filePath);
           if (att.mimeType === "application/pdf") {
             try {
               const bytes = await fs.readFile(abs);
               pdfAttachments.push({ name: att.name || att.originalName, bytes });
             } catch {
               this.logger.warn(`PDF attachment not found: ${abs}`);
             }
           } else if (att.mimeType.startsWith("image/")) {
             try {
               const buf = await fs.readFile(abs);
               const dataUri = await toReportImageDataUri(buf);
               imageAttachments.push({ dataUri, name: att.name || att.originalName });
             } catch {
               this.logger.warn(`Image attachment not found: ${abs}`);
             }
           } else {
             otherAttachments.push({
               name: att.name || att.originalName,
               size: att.size,
               mimeType: att.mimeType,
             });
           }
         }),
       );

    // ── build report data + HTML ──
    const reportData = buildReportData(tx, ev, {
      images,
      pdfAttachments,
      imageAttachments,
      otherAttachments,
      mapImageDataUri,
    }, signatories);
    const html = renderReportHtml(reportData);

    // ── render main report to PDF via Puppeteer ──
    const browser = await getBrowser();
    const page = await browser.newPage();
    let mainPdfBytes: Buffer;
    try {
      await page.setContent(html, { waitUntil: "load" });
      // NB: pages no longer clip overflow (see report-template.ts CSS
      // changes), so a card/table that runs long now correctly spills onto
      // an extra physical PDF page instead of being cut off.
      const pdfBytes = await page.pdf({
        width: "794px",
        height: "1123px",
        printBackground: true,
        margin: { top: "0", bottom: "0", left: "0", right: "0" },
      });
      mainPdfBytes = Buffer.from(pdfBytes);
    } finally {
      await page.close();
    }

    // ── merge in the real attachment PDFs, page-for-page ──
    const finalDoc = await PDFDocument.load(mainPdfBytes);
    for (const att of pdfAttachments) {
      try {
        const attDoc = await PDFDocument.load(att.bytes, { ignoreEncryption: true });
        const copiedPages = await finalDoc.copyPages(attDoc, attDoc.getPageIndices());
        copiedPages.forEach((p) => finalDoc.addPage(p));
      } catch (e) {
        this.logger.warn(`Failed to merge attachment PDF "${att.name}": ${(e as Error).message}`);
      }
    }

    const finalBytes = await finalDoc.save();
        this.logger.log(`PDF generated: ${finalBytes.length} bytes`);

        // Only allow the two known values — never trust the query string verbatim.
        const safeDisposition = disposition === "inline" ? "inline" : "attachment";

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `${safeDisposition}; filename="valuation-${id}.pdf"`,
        );
        res.end(Buffer.from(finalBytes));
        this.logger.log("PDF sent successfully");
  }
}
