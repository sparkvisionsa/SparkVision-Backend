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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileParserService = void 0;
const common_1 = require("@nestjs/common");
const ExcelJS = __importStar(require("exceljs"));
function excelArgbToHex(argb) {
    if (typeof argb !== "string")
        return undefined;
    const clean = argb.trim();
    if (/^[0-9a-fA-F]{8}$/.test(clean))
        return `#${clean.slice(2).toUpperCase()}`;
    if (/^[0-9a-fA-F]{6}$/.test(clean))
        return `#${clean.toUpperCase()}`;
    return undefined;
}
function excelWidthToPx(width) {
    if (typeof width !== "number" || !Number.isFinite(width))
        return undefined;
    return Math.max(84, Math.min(480, Math.round(width * 9 + 16)));
}
function inferColumnFormatFromNumFmt(format) {
    if (typeof format !== "string" || format.trim() === "")
        return undefined;
    const fmt = format.toLowerCase();
    if (fmt.includes("%"))
        return "percent";
    if (fmt.includes("$") ||
        fmt.includes("sar") ||
        fmt.includes("usd") ||
        fmt.includes("€") ||
        fmt.includes("£")) {
        return "currency";
    }
    if (/(yy|yyyy|dd|mm|mmm|hh|ss)/.test(fmt))
        return "date";
    if (/[#0]/.test(fmt))
        return "number";
    return undefined;
}
function compactCellStyle(style) {
    if (!style.backgroundColor &&
        !style.textColor &&
        !style.fontSize &&
        !style.fontFamily &&
        !style.fontWeight &&
        !style.textAlign) {
        return null;
    }
    return style;
}
function buildCellStyle(cell) {
    const horizontal = cell.alignment?.horizontal;
    const fill = cell.fill;
    return compactCellStyle({
        backgroundColor: excelArgbToHex(fill?.fgColor?.argb),
        textColor: excelArgbToHex(cell.font?.color?.argb),
        fontSize: typeof cell.font?.size === "number" && Number.isFinite(cell.font.size)
            ? Math.max(10, Math.min(28, Math.round(cell.font.size)))
            : undefined,
        fontFamily: typeof cell.font?.name === "string"
            ? /mono|courier|consolas/i.test(cell.font.name)
                ? "mono"
                : /serif|georgia|times/i.test(cell.font.name)
                    ? "serif"
                    : /grotesk|display|headline/i.test(cell.font.name)
                        ? "display"
                        : "sans"
            : undefined,
        fontWeight: cell.font?.bold ? "bold" : undefined,
        textAlign: horizontal === "center"
            ? "center"
            : horizontal === "right"
                ? "end"
                : horizontal === "left"
                    ? "start"
                    : undefined,
    });
}
let FileParserService = class FileParserService {
    async parse(buffer, originalName, mimeType) {
        const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
        if (["xlsx", "xls"].includes(ext) ||
            mimeType.includes("spreadsheet") ||
            mimeType.includes("excel")) {
            return this.parseExcel(buffer, originalName);
        }
        if (ext === "csv" || mimeType === "text/csv") {
            return this.parseCsv(buffer, originalName);
        }
        if (ext === "pdf" || mimeType === "application/pdf") {
            return this.parsePdf(buffer, originalName);
        }
        if (["doc", "docx"].includes(ext) ||
            mimeType.includes("word") ||
            mimeType.includes("msword")) {
            return this.parseWord(buffer, originalName);
        }
        if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ||
            mimeType.startsWith("image/")) {
            return this.parseImage(originalName, mimeType);
        }
        throw new common_1.BadRequestException(`Unsupported file type: ${ext}`);
    }
    async parseExcel(buffer, fileName) {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer);
        const sheets = [];
        workbook.eachSheet((worksheet) => {
            const headers = [];
            const rows = [];
            const styleRows = [];
            const columnFormats = [];
            const headerRow = worksheet.getRow(1);
            headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const val = cell.value;
                headers[colNumber - 1] =
                    val != null ? String(val).trim() : `Column ${colNumber}`;
                columnFormats[colNumber - 1] =
                    inferColumnFormatFromNumFmt(cell.numFmt) ?? "general";
            });
            if (headers.length === 0)
                return;
            const columnWidths = headers.map((_, idx) => excelWidthToPx(worksheet.getColumn(idx + 1).width));
            for (let r = 2; r <= worksheet.rowCount; r++) {
                const row = worksheet.getRow(r);
                const rowObj = {};
                const styleRow = [];
                let hasData = false;
                headers.forEach((header, idx) => {
                    const cell = row.getCell(idx + 1);
                    let val = null;
                    if (cell.value != null) {
                        if (typeof cell.value === "number") {
                            val = cell.value;
                        }
                        else if (cell.value instanceof Date) {
                            val = cell.value.toISOString().split("T")[0];
                        }
                        else if (typeof cell.value === "object" &&
                            cell.value &&
                            "formula" in cell.value &&
                            typeof cell.value.formula === "string") {
                            val = `=${cell.value.formula}`;
                        }
                        else if (typeof cell.value === "object" && "result" in cell.value) {
                            val = cell.value.result != null ? String(cell.value.result) : null;
                        }
                        else {
                            val = String(cell.value);
                        }
                        if (val != null)
                            hasData = true;
                    }
                    rowObj[header] = val;
                    styleRow[idx] = buildCellStyle(cell);
                    if (columnFormats[idx] === "general") {
                        columnFormats[idx] =
                            inferColumnFormatFromNumFmt(cell.numFmt) ?? "general";
                    }
                });
                if (hasData || styleRow.some(Boolean)) {
                    rows.push(rowObj);
                    styleRows.push(styleRow);
                }
            }
            const spreadsheetMeta = {};
            if (columnWidths.some((width) => width !== undefined)) {
                spreadsheetMeta.columnWidths = columnWidths.map((width) => width ?? 160);
            }
            if (columnFormats.some((fmt) => fmt !== "general")) {
                spreadsheetMeta.columnFormats = headers.map((_, idx) => columnFormats[idx] ?? "general");
            }
            if (styleRows.some((row) => row.some(Boolean))) {
                spreadsheetMeta.cellStyles = styleRows;
            }
            sheets.push({
                name: worksheet.name,
                headers,
                rows,
                spreadsheetMeta: spreadsheetMeta.columnWidths ||
                    spreadsheetMeta.columnFormats ||
                    spreadsheetMeta.cellStyles
                    ? spreadsheetMeta
                    : undefined,
            });
        });
        return { sheets, sourceFileName: fileName };
    }
    async parseCsv(buffer, fileName) {
        const text = buffer.toString("utf-8");
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length === 0) {
            return { sheets: [{ name: "Sheet1", headers: [], rows: [] }], sourceFileName: fileName };
        }
        const delimiter = lines[0].includes("\t") ? "\t" : ",";
        const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ""));
            const rowObj = {};
            headers.forEach((h, idx) => {
                const v = values[idx] ?? null;
                if (v === null || v === "") {
                    rowObj[h] = null;
                }
                else {
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
    async parsePdf(buffer, fileName) {
        const pdfModule = await import("pdf-parse");
        const pdfParse = pdfModule.default ?? pdfModule;
        const data = await pdfParse(buffer);
        const text = data.text || "";
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        if (lines.length === 0) {
            return { sheets: [{ name: "PDF Data", headers: ["Content"], rows: [] }], sourceFileName: fileName };
        }
        const tabularLines = lines.filter((l) => l.includes("\t") || /\s{2,}/.test(l));
        if (tabularLines.length > 1) {
            const splitter = tabularLines[0].includes("\t")
                ? "\t"
                : /\s{2,}/;
            const headers = tabularLines[0].split(splitter).map((h) => h.trim()).filter(Boolean);
            const rows = [];
            for (let i = 1; i < tabularLines.length; i++) {
                const values = tabularLines[i].split(splitter).map((v) => v.trim());
                const rowObj = {};
                headers.forEach((h, idx) => {
                    const v = values[idx] ?? null;
                    if (!v) {
                        rowObj[h] = null;
                    }
                    else {
                        const num = Number(v);
                        rowObj[h] = !isNaN(num) ? num : v;
                    }
                });
                rows.push(rowObj);
            }
            return { sheets: [{ name: "PDF Data", headers, rows }], sourceFileName: fileName };
        }
        const rows = lines.map((line, idx) => ({
            "#": idx + 1,
            Content: line,
        }));
        return {
            sheets: [{ name: "PDF Data", headers: ["#", "Content"], rows }],
            sourceFileName: fileName,
        };
    }
    async parseWord(buffer, fileName) {
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
            const rows = [];
            for (let i = 1; i < tabularLines.length; i++) {
                const values = tabularLines[i].split("\t").map((v) => v.trim());
                const rowObj = {};
                headers.forEach((h, idx) => {
                    const v = values[idx] ?? null;
                    if (!v) {
                        rowObj[h] = null;
                    }
                    else {
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
    parseImage(fileName, mimeType) {
        return {
            sheets: [
                {
                    name: "Image Data",
                    headers: ["File Name", "File Type", "Status"],
                    rows: [
                        {
                            "File Name": fileName,
                            "File Type": mimeType || "image",
                            Status: "Image imported successfully",
                        },
                    ],
                },
            ],
            sourceFileName: fileName,
        };
    }
};
exports.FileParserService = FileParserService;
exports.FileParserService = FileParserService = __decorate([
    (0, common_1.Injectable)()
], FileParserService);
