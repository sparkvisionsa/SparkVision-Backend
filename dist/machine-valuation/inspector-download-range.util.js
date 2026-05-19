"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseInspectorBytesRange = parseInspectorBytesRange;
function parseInspectorBytesRange(rangeHeader, totalBytes) {
    if (totalBytes <= 0 || !rangeHeader)
        return null;
    const trimmed = rangeHeader.trim();
    if (!trimmed.toLowerCase().startsWith("bytes="))
        return null;
    const spec = trimmed.slice(6).split(",")[0]?.trim() ?? "";
    if (!spec || spec.includes(","))
        return null;
    const dash = spec.indexOf("-");
    if (dash === -1)
        return null;
    const startPart = spec.slice(0, dash);
    const endPart = spec.slice(dash + 1);
    let start;
    let end;
    if (startPart === "") {
        const suffixLen = Number.parseInt(endPart, 10);
        if (!Number.isFinite(suffixLen) || suffixLen <= 0)
            return null;
        start = Math.max(0, totalBytes - suffixLen);
        end = totalBytes - 1;
    }
    else {
        start = Number.parseInt(startPart, 10);
        end = endPart === "" ? totalBytes - 1 : Number.parseInt(endPart, 10);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalBytes) {
        return null;
    }
    end = Math.min(end, totalBytes - 1);
    if (start > end)
        return null;
    return { start, end };
}
