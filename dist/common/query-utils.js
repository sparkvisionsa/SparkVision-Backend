"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseNumber = parseNumber;
exports.parseBoolean = parseBoolean;
exports.parseSources = parseSources;
exports.readQueryString = readQueryString;
function parseNumber(value) {
    if (typeof value !== "string" || !value)
        return undefined;
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
}
function parseBoolean(value) {
    if (typeof value !== "string" || !value)
        return undefined;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    return undefined;
}
function parseSources(value) {
    if (typeof value !== "string" || !value)
        return undefined;
    const sources = value
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean);
    return sources.length > 0 ? sources : undefined;
}
function readQueryString(req, key) {
    const value = req.query[key];
    if (Array.isArray(value)) {
        const first = value[0];
        return typeof first === "string" ? first : undefined;
    }
    return typeof value === "string" ? value : undefined;
}
