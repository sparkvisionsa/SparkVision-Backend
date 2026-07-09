"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryParseObjectId = tryParseObjectId;
exports.parseObjectId = parseObjectId;
exports.hydrateOptionalObjectId = hydrateOptionalObjectId;
exports.tryCoerceToObjectId = tryCoerceToObjectId;
const mongodb_1 = require("mongodb");
function tryParseObjectId(value) {
    if (value === undefined || value === null)
        return null;
    const t = String(value).trim();
    if (!t || !mongodb_1.ObjectId.isValid(t))
        return null;
    return new mongodb_1.ObjectId(t);
}
function parseObjectId(value) {
    const id = tryParseObjectId(value);
    if (!id) {
        throw new Error(`Invalid ObjectId: ${value}`);
    }
    return id;
}
function hydrateOptionalObjectId(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (value instanceof mongodb_1.ObjectId)
        return value;
    if (typeof value === "string" && mongodb_1.ObjectId.isValid(value))
        return new mongodb_1.ObjectId(value);
    return null;
}
function tryCoerceToObjectId(value) {
    if (value === undefined || value === null || value === "")
        return null;
    if (value instanceof mongodb_1.ObjectId)
        return value;
    if (typeof value === "string")
        return tryParseObjectId(value);
    return null;
}
