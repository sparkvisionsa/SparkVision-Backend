import { Injectable, BadRequestException } from "@nestjs/common";
import * as ExcelJS from "exceljs";
import type { ParsedSheet, ParsedFileResult } from "./types";

@Injectable()
export class FileParserService {
  async parse(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<ParsedFileResult> {
    const ext = originalName.split(".").pop()?.toLowerCase() ?? "";

    if (
      ["xlsx", "xls"].includes(ext) ||
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel")
    ) {
      return this.parseExcel(buffer, originalName);
    }

    if (ext === "csv" || mimeType === "text/csv") {
      return this.parseCsv(buffer, originalName);
    }

    if (ext === "pdf" || mimeType === "application/pdf") {
      return this.parsePdf(buffer, originalName);
    }

    if (
      ["doc", "docx"].includes(ext) ||
      mimeType.includes("word") ||
      mimeType.includes("msword")
    ) {
      return this.parseWord(buffer, originalName);
    }

    throw new BadRequestException(`Unsupported file type: ${ext}`);
  }

  private async parseExcel(
    buffer: Buffer,
    fileName: string,
  ): Promise<ParsedFileResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    const sheets: ParsedSheet[] = [];

    workbook.eachSheet((worksheet) => {
      const headers: string[] = [];
      const rows: Record<string, string | number | null>[] = [];

      const headerRow = worksheet.getRow(1);
      headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const val = cell.value;
        headers[colNumber - 1] =
          val != null ? String(val).trim() : `Column ${colNumber}`;
      });

      if (headers.length === 0) return;

      for (let r = 2; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        const rowObj: Record<string, string | number | null> = {};
        let hasData = false;

        headers.forEach((header, idx) => {
          const cell = row.getCell(idx + 1);
          let val: string | number | null = null;
          if (cell.value != null) {
            if (typeof cell.value === "number") {
              val = cell.value;
            } else if (cell.value instanceof Date) {
              val = cell.value.toISOString().split("T")[0];
            } else if (typeof cell.value === "object" && "result" in cell.value) {
              val = cell.value.result != null ? String(cell.value.result) : null;
            } else {
              val = String(cell.value);
            }
            if (val != null) hasData = true;
          }
          rowObj[header] = val;
        });

        if (hasData) rows.push(rowObj);
      }

      sheets.push({ name: worksheet.name, headers, rows });
    });

    return { sheets, sourceFileName: fileName };
  }

  private async parseCsv(
    buffer: Buffer,
    fileName: string,
  ): Promise<ParsedFileResult> {
    const text = buffer.toString("utf-8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length === 0) {
      return { sheets: [{ name: "Sheet1", headers: [], rows: [] }], sourceFileName: fileName };
    }

    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));

    const rows: Record<string, string | number | null>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
      const rowObj: Record<string, string | number | null> = {};
      headers.forEach((h, idx) => {
        const v = values[idx] ?? null;
        if (v === null || v === "") {
          rowObj[h] = null;
        } else {
          const num = Number(v);
          rowObj[h] = !isNaN(num) && v !== "" ? num : v;
        }
      });
      rows.push(rowObj);
    }

    return {
      sheets: [{ name: "Sheet1", headers, rows }],
      sourceFileName: fileName,
    };
  }

  private async parsePdf(
    buffer: Buffer,
    fileName: string,
  ): Promise<ParsedFileResult> {
    const pdfModule = await import("pdf-parse");
    const pdfParse = (pdfModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfModule;
    const data = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer);
    const text = data.text || "";

    const lines = text
      .split(/\r?\n/)
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    if (lines.length === 0) {
      return { sheets: [{ name: "PDF Data", headers: ["Content"], rows: [] }], sourceFileName: fileName };
    }

    const tabularLines = lines.filter((l: string) => l.includes("\t") || /\s{2,}/.test(l));

    if (tabularLines.length > 1) {
      const splitter = tabularLines[0].includes("\t")
        ? "\t"
        : /\s{2,}/;
      const headers = tabularLines[0].split(splitter).map((h: string) => h.trim()).filter(Boolean);

      const rows: Record<string, string | number | null>[] = [];
      for (let i = 1; i < tabularLines.length; i++) {
        const values = tabularLines[i].split(splitter).map((v: string) => v.trim());
        const rowObj: Record<string, string | number | null> = {};
        headers.forEach((h: string, idx: number) => {
          const v = values[idx] ?? null;
          if (!v) {
            rowObj[h] = null;
          } else {
            const num = Number(v);
            rowObj[h] = !isNaN(num) ? num : v;
          }
        });
        rows.push(rowObj);
      }

      return { sheets: [{ name: "PDF Data", headers, rows }], sourceFileName: fileName };
    }

    const rows = lines.map((line: string, idx: number) => ({
      "#": idx + 1,
      Content: line,
    }));
    return {
      sheets: [{ name: "PDF Data", headers: ["#", "Content"], rows }],
      sourceFileName: fileName,
    };
  }

  private async parseWord(
    buffer: Buffer,
    fileName: string,
  ): Promise<ParsedFileResult> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";

    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return {
        sheets: [{ name: "Word Data", headers: ["Content"], rows: [] }],
        sourceFileName: fileName,
      };
    }

    const tabularLines = lines.filter((l) => l.includes("\t"));

    if (tabularLines.length > 1) {
      const headers = tabularLines[0].split("\t").map((h) => h.trim()).filter(Boolean);
      const rows: Record<string, string | number | null>[] = [];
      for (let i = 1; i < tabularLines.length; i++) {
        const values = tabularLines[i].split("\t").map((v) => v.trim());
        const rowObj: Record<string, string | number | null> = {};
        headers.forEach((h, idx) => {
          const v = values[idx] ?? null;
          if (!v) {
            rowObj[h] = null;
          } else {
            const num = Number(v);
            rowObj[h] = !isNaN(num) ? num : v;
          }
        });
        rows.push(rowObj);
      }
      return { sheets: [{ name: "Word Data", headers, rows }], sourceFileName: fileName };
    }

    const rows = lines.map((line, idx) => ({
      "#": idx + 1,
      Content: line,
    }));
    return {
      sheets: [{ name: "Word Data", headers: ["#", "Content"], rows }],
      sourceFileName: fileName,
    };
  }
}
