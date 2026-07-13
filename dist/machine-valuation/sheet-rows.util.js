"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordsToRowValues = recordsToRowValues;
exports.rowValuesToRecords = rowValuesToRecords;
exports.decodeUploadFilename = decodeUploadFilename;
function recordsToRowValues(headers, rows) {
    return rows.map((row) => headers.map((h) => {
        const v = row[h];
        return v === undefined ? null : v;
    }));
}
function rowValuesToRecords(headers, rowValues) {
    return rowValues.map((vals) => {
        const o = {};
        headers.forEach((h, i) => {
            o[h] = vals[i] ?? null;
        });
        return o;
    });
}
function decodeUploadFilename(original) {
    if (!original)
        return "";
    try {
        return Buffer.from(original, "latin1").toString("utf8");
    }
    catch {
        return original;
    }
}
