import sharp from "sharp";
import Tesseract = require("tesseract.js");

export type TextRegion = {
  text: string;
  confidence: number;
  x: number; y: number; width: number; height: number;
};
export type LayoutField = {
  label: string; value: string; section: string; row?: number;
  confidence: "high" | "medium" | "low";
  source: { x: number; y: number; width: number; height: number };
};
export type LayoutPage = { page: number; text: string; confidence: number; fields: LayoutField[] };
export type OcrWorkerFactory = (language?: "mixed" | "ar" | "en") => Promise<Tesseract.Worker>;
type Rect = { x: number; y: number; width: number; height: number };
type Band = { top: number; bottom: number; segments: { left: number; right: number }[] };

const labels = [
  "رقم الوثيقة", "تاريخ الوثيقة", "القيود", "الحالة", "المساحة", "تاريخ الوثيقة السابقة", "رقم الوثيقة السابقة", "نوع العملية",
  "رقم الهوية", "الاسم", "الجنسية", "نسبة التملك", "رقم الهوية العقارية", "نوع العقار", "مساحة العقار (م²)", "نوع الاستخدام",
  "البلك", "المجاورة / الجزء", "الموقع", "نموذج العقار", "رقم القطعة", "رقم المخطط", "الحي", "المدينة",
  "الحد", "النوع", "وصف الحد", "الطول (م)", "رقم الرخصة", "رقم الإقامة", "تاريخ الإصدار", "تاريخ الانتهاء",
  "الرقم التسلسلي", "الشركة المصنعة", "الموديل", "سنة الصنع", "رقم الهيكل", "رقم اللوحة", "القيمة", "الكمية", "الوصف",
  "البيانات الأساسية", "الملاك", "العقار", "الحدود والأطوال",
];
const compact = (s: string) => s.normalize("NFKC").replace(/[\u064b-\u065f\u0670ـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
export const cleanOcrText = (s: string) => s.normalize("NFKC").replace(/[\u0000\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
function editDistance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length]!;
}
// Only labels are corrected against a vocabulary. Names, numbers and values
// are never replaced with guesses or values taken from another document.
export function canonicalLabel(text: string) {
  const cleaned = cleanOcrText(text).replace(/^[|:.,\s]+|[|:.,\s]+$/g, "");
  const key = compact(cleaned.replace(/\n\s*[\d٠-٩]+\s*$/g, ""));
  const candidates = labels.map(label => ({ label, distance: editDistance(key, compact(label)) / Math.max(key.length, compact(label).length) })).sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (best && (best.distance === 0 || (key.length >= 4 && best.distance <= 0.22 && (candidates[1]?.distance ?? 1) - best.distance >= 0.07))) return best.label;
  return cleaned;
}

function groups(values: number[], gap = 1): number[][] {
  const result: number[][] = [];
  for (const value of values) {
    const last = result[result.length - 1];
    if (last && value - last[last.length - 1]! <= gap) last.push(value);
    else result.push([value]);
  }
  return result;
}

export async function detectTables(buffer: Buffer) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const pixel = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!] as const;
  };
  const colored = (x: number, y: number) => {
    const p = pixel(x, y), max = Math.max(...p), min = Math.min(...p);
    return max - min > 40 && max < 205 && min < 130;
  };
  const activeRows: number[] = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (colored(x, y)) count++;
    if (count > width * 0.24) activeRows.push(y);
  }
  const bands: Band[] = groups(activeRows).filter(g => g.length >= Math.max(5, height * 0.006)).map(g => {
    const top = g[0]!, bottom = g[g.length - 1]! + 1;
    const columns: number[] = [];
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let y = top; y < bottom; y++) if (colored(x, y)) count++;
      if (count / (bottom - top) > 0.55) columns.push(x);
    }
    return { top, bottom, segments: groups(columns, Math.max(2, Math.round(width / 550))).filter(g => g.length > width * 0.055).map(g => ({ left: g[0]!, right: g[g.length - 1]! + 1 })) };
  }).filter(b => b.segments.length > 0);
  if (bands.length < 2) return { bands: [], width, height, rowBorders: [] as number[], columnBorders: (_a: number, _b: number) => [] as number[], left: 0, right: width };
  const left = Math.min(...bands.flatMap(b => b.segments.map(s => s.left)));
  const right = Math.max(...bands.flatMap(b => b.segments.map(s => s.right)));
  // Estimate paper colour independently from the coloured table headers.
  const samples: number[][] = [[], [], []];
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 200))) {
    const p = pixel(Math.max(0, left - 5), y);
    p.forEach((v, c) => samples[c]!.push(v));
  }
  const background = samples.map(a => a.sort((a, b) => a - b)[Math.floor(a.length * 0.65)]!);
  const border = (x: number, y: number) => {
    const p = pixel(x, y), delta = p.map((v, c) => background[c]! - v);
    return Math.min(...delta) > 9 && Math.max(...delta) - Math.min(...delta) < 38;
  };
  const rowCandidates: number[] = [];
  for (let y = bands[0]!.top; y < height; y++) {
    let count = 0;
    for (let x = left; x < right; x++) if (border(x, y)) count++;
    if (count > (right - left) * 0.72) rowCandidates.push(y);
  }
  const rowBorders = groups(rowCandidates).map(g => Math.round(g.reduce((a, b) => a + b, 0) / g.length));
  const columnBorders = (top: number, bottom: number) => {
    const candidates: number[] = [];
    for (let x = left; x <= Math.min(width - 1, right); x++) {
      let count = 0;
      for (let y = top; y < bottom; y++) if (border(x, y)) count++;
      if (count > (bottom - top) * 0.75) candidates.push(x);
    }
    return groups(candidates).map(g => Math.round(g.reduce((a, b) => a + b, 0) / g.length));
  };
  return { bands, width, height, left, right, rowBorders, columnBorders };
}

async function readCell(buffer: Buffer, rect: Rect, dark: boolean, language: "ar" | "mixed", getWorker: OcrWorkerFactory, multiline = false, numeric = false) {
  const inset = Math.max(1, Math.round(rect.height / 24));
  let pipeline = sharp(buffer).extract({ left: rect.x + inset, top: rect.y + inset, width: Math.max(1, rect.width - 2 * inset), height: Math.max(1, rect.height - 2 * inset) }).removeAlpha();
  pipeline = pipeline.resize({ height: Math.min(900, Math.max(100, rect.height * 5)), kernel: "lanczos3" }).grayscale();
  if (dark) pipeline = pipeline.negate();
  // Fixed paper threshold removes the security-print background. Normalising
  // an empty cell amplifies that texture into imaginary letters.
  const grayscale = await pipeline.png().toBuffer();
  const binary = await sharp(grayscale).threshold(dark ? 130 : 165).png().toBuffer();
  const stats = await sharp(binary).stats();
  if (stats.channels[0]!.mean > 253.5) return { text: "", confidence: 100 };
  const normalized = await sharp(grayscale).normalize().png().toBuffer();
  const pad = (b: Buffer) => sharp(b).extend({ top: 16, bottom: 16, left: 16, right: 16, background: "white" }).png().toBuffer();
  const prepared = await pad(normalized);
  const worker = await getWorker(language);
  await worker.setParameters({ tessedit_pageseg_mode: multiline ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SINGLE_LINE, preserve_interword_spaces: "1" });
  let result = (await worker.recognize(prepared)).data;
  const score = (r: Tesseract.Page) => r.confidence + (dark && labels.includes(canonicalLabel(r.text)) ? 25 : 0) - (/[a-z]/i.test(r.text) && language === "ar" ? 20 : 0);
  if (result.confidence < 90 || (dark && !labels.includes(canonicalLabel(result.text)))) {
    const retry = (await worker.recognize(await pad(binary))).data;
    if (score(retry) > score(result)) result = retry;
  }
  const text = cleanOcrText(result.text);
  if (!dark && language === "ar" && (numeric || !/[\u0621-\u064a]/.test(text) || /^[\d\s.,%/\-٠-٩]+$/.test(text))) {
    const english = await getWorker("en");
    await english.setParameters({ tessedit_pageseg_mode: multiline ? Tesseract.PSM.SINGLE_BLOCK : Tesseract.PSM.SINGLE_LINE });
    const retry = (await english.recognize(prepared)).data;
    if ((retry.confidence >= result.confidence - 5 || numeric && retry.confidence >= 65) && /^[\d\s.,%/\-]+$/.test(retry.text.trim())) result = retry;
  }
  return { text: cleanOcrText(result.text).replace(/^[|_]+|[|_]+$/g, "").trim(), confidence: result.confidence };
}

export async function recognizeDocumentPage(input: Buffer, page: number, getWorker: OcrWorkerFactory): Promise<LayoutPage> {
  const buffer = await sharp(input, { limitInputPixels: 50_000_000 }).rotate().flatten({ background: "white" }).resize({ width: 2400, height: 3400, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const layout = await detectTables(buffer);
  const prepared = await sharp(buffer).resize({ width: 2200, height: 3100, fit: "inside" }).grayscale().normalize().sharpen().png().toBuffer();
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
  let scanned = (await worker.recognize(prepared, {}, { text: true, blocks: true })).data;
  const initialArabicCount = (scanned.text.match(/[\u0621-\u064a]/g) ?? []).length;
  if (scanned.confidence < 82 || initialArabicCount >= 12) {
    // The combined ara+eng model is useful for mixed forms, but on dense Arabic
    // letters it can trade accuracy for script detection. Retry with the
    // Arabic-only model and retain the reading with stronger confidence and
    // Arabic coverage.
    const arabicWorker = await getWorker("ar");
    await arabicWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT, preserve_interword_spaces: "1" });
    const arabic = (await arabicWorker.recognize(prepared, {}, { text: true, blocks: true })).data;
    const arabicCount = (arabic.text.match(/[\u0621-\u064a]/g) ?? []).length;
    if (
      arabicCount >= Math.max(12, initialArabicCount * 0.7) &&
      (arabic.confidence >= scanned.confidence - 2 || arabicCount > initialArabicCount * 1.2)
    ) scanned = arabic;
  }
  const language = /[\u0621-\u064a]/.test(scanned.text) ? "ar" : "mixed";
  const metadata = await sharp(prepared).metadata();
  const scale = layout.width / metadata.width!;
  const regions: TextRegion[] = (scanned.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.map(l => ({
    text: cleanOcrText(l.text), confidence: l.confidence, x: l.bbox.x0 * scale, y: l.bbox.y0 * scale,
    width: (l.bbox.x1 - l.bbox.x0) * scale, height: (l.bbox.y1 - l.bbox.y0) * scale,
  }))));
  const fields: LayoutField[] = [];
  const sections: string[] = [];
  const { bands, left, right, rowBorders } = layout;
  const add = (label: string, value: { text: string; confidence: number }, section: string, rect: Rect, row?: number, labelConfidence = 90) => {
    if (!/[\p{L}\p{N}]/u.test(value.text)) return;
    const name = canonicalLabel(label);
    if (!/[\p{L}]/u.test(name)) return;
    const confidence = Math.min(value.confidence, labelConfidence);
    fields.push({ label: name, value: value.text, section, ...(row ? { row } : {}), confidence: confidence < 65 ? "low" : confidence < 88 || (layout.width < 1000 && /[\u0621-\u064a]/.test(value.text)) ? "medium" : "high", source: { x: rect.x / layout.width, y: rect.y / layout.height, width: rect.width / layout.width, height: rect.height / layout.height } });
  };
  let previousEnd = 0;
  let previousColumns: number[] = [];
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]!;
    const title = regions.filter(r => r.y >= previousEnd + 2 && r.y + r.height <= band.top + 2 && r.x > right - (right - left) * 0.4 && r.confidence >= 45 && /[\p{L}]/u.test(r.text)).sort((a, b) => b.y - a.y)[0];
    const section = title && /[\u0621-\u064a]/.test(title.text) && band.top - previousEnd > 8 && band.top - title.y < Math.max(35, band.bottom - band.top) ? canonicalLabel(title.text) : sections[sections.length - 1] || (language === "ar" ? "بيانات المستند" : "Document details");
    sections.push(section);
    if (band.segments.length > 1 && band.segments.every(s => s.right - s.left < (right - left) * 0.55)) {
      // Alternating label/value cells in the same row, ordered right-to-left.
      for (let j = band.segments.length - 1; j >= 0; j--) {
        const s = band.segments[j]!;
        const x = j === 0 ? left : band.segments[j - 1]!.right;
        if (s.left - x < 12) continue;
        const labelRect = { x: s.left, y: band.top, width: s.right - s.left, height: band.bottom - band.top };
        const valueRect = { x, y: band.top, width: s.left - x, height: band.bottom - band.top };
        const label = await readCell(buffer, labelRect, true, language, getWorker);
        const value = await readCell(buffer, valueRect, false, language, getWorker, false, /رقم|تاريخ|مساح/.test(canonicalLabel(label.text)));
        add(label.text, value, section, valueRect, undefined, label.confidence);
      }
      previousEnd = band.bottom;
      continue;
    }
    const nextTop = bands[i + 1]?.top ?? layout.height;
    const rows = rowBorders.filter(y => y >= band.bottom + 5 && y < nextTop);
    if (!rows.length && nextTop - band.bottom >= 8 && nextTop - band.bottom < (band.bottom - band.top) * 2) rows.push(nextTop);
    if (!rows.length) { previousEnd = band.bottom; continue; }
    const firstBottom = rows[0]!;
    let columns = layout.columnBorders(band.bottom + 3, firstBottom - 1);
    if (columns.length < 3 && previousColumns.length >= 3) columns = previousColumns;
    columns = [left, ...columns.filter(x => x > left + 5 && x < right - 5), right];
    if (columns.length < 3) { previousEnd = band.bottom; continue; }
    previousColumns = columns;
    const headers: { text: string; confidence: number }[] = [];
    for (let c = 0; c < columns.length - 1; c++) headers.push(await readCell(buffer, { x: columns[c]!, y: band.top, width: columns[c + 1]! - columns[c]!, height: band.bottom - band.top }, true, language, getWorker));
    let top = band.bottom;
    for (let r = 0; r < rows.length; r++) {
      const bottom = rows[r]!;
      if (bottom - top > (band.bottom - band.top) * 5) break; // A footer line is not another table row.
      if (r > 0 && layout.columnBorders(top + 3, bottom - 2).length < 2) break;
      for (let c = columns.length - 2; c >= 0; c--) {
        const rect = { x: columns[c]!, y: top, width: columns[c + 1]! - columns[c]!, height: bottom - top };
        const header = headers[c]!;
        // A merged header spans adjacent columns. Retain both textual and
        // numeric length columns under the visible header.
        const resolved = /[\p{L}]/u.test(header.text) ? header : headers.find(h => /[\p{L}]/u.test(h.text));
        if (resolved) {
          const value = await readCell(buffer, rect, false, language, getWorker, bottom - top > (band.bottom - band.top) * 1.4, /رقم|تاريخ|مساح|طول/.test(canonicalLabel(resolved.text)));
          const tableSection = headers.some(h => canonicalLabel(h.text) === "وصف الحد") ? "الحدود والأطوال" : section;
          let fieldLabel = resolved.text;
          if (canonicalLabel(resolved.text) === "الطول (م)" && /[\u0621-\u064a]/.test(value.text)) fieldLabel = "وصف الطول";
          add(fieldLabel, value, tableSection, rect, rows.length > 1 ? r + 1 : undefined, resolved.confidence);
        }
      }
      top = bottom;
    }
    previousEnd = top;
  }
  if (fields.length) {
    // Printed metadata above tables and notes below them must not disappear
    // just because the main body has structured cells.
    for (const region of regions.filter(r => r.y < (bands[0]?.top ?? 0))) {
      const date = region.text.match(/(?:19|20)\d{2}\/\d{1,2}\/\d{1,2}/)?.[0];
      if (date) add("التاريخ الميلادي", { text: date, confidence: region.confidence }, "بيانات المستند", region);
    }
    const footer = regions.filter(r => r.y >= previousEnd + 5 && /[\u0621-\u064a]/.test(r.text) && r.confidence > 45).sort((a, b) => a.y - b.y);
    for (const [index, region] of footer.entries()) {
      const rect = { x: Math.max(0, Math.floor(region.x) - 2), y: Math.max(0, Math.floor(region.y) - 2), width: Math.min(layout.width - Math.max(0, Math.floor(region.x) - 2), Math.ceil(region.width) + 4), height: Math.min(layout.height - Math.max(0, Math.floor(region.y) - 2), Math.ceil(region.height) + 4) };
      const value = await readCell(buffer, rect, false, language, getWorker);
      add(index === 0 ? "ملاحظات المستند" : "نص إضافي", value, "ملاحظات", rect);
    }
  }
  // Keep every recognised line for source review and export, even where a
  // reliable label/value relationship cannot be established.
  return { page, text: cleanOcrText(scanned.text), confidence: scanned.confidence, fields };
}
