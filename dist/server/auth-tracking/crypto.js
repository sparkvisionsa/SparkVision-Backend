"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomId = randomId;
exports.sha256 = sha256;
exports.signToken = signToken;
exports.verifyToken = verifyToken;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.parseDateFromUnknown = parseDateFromUnknown;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const config_1 = require("./config");
function toBase64Url(value) {
    return Buffer.from(value).toString("base64url");
}
function fromBase64Url(value) {
    return Buffer.from(value, "base64url").toString("utf8");
}
function randomId() {
    return node_crypto_1.default.randomUUID();
}
function sha256(value) {
    return node_crypto_1.default.createHash("sha256").update(value).digest("hex");
}
function signatureFor(value) {
    return node_crypto_1.default
        .createHmac("sha256", config_1.authTrackingConfig.authSecret)
        .update(value)
        .digest("base64url");
}
function signToken(payload) {
    const body = toBase64Url(JSON.stringify(payload));
    const sig = signatureFor(body);
    return `${body}.${sig}`;
}
function verifyToken(token) {
    if (!token)
        return null;
    const parts = token.split(".");
    if (parts.length !== 2)
        return null;
    const [body, sig] = parts;
    const expected = signatureFor(body);
    const sigBuffer = Buffer.from(sig);
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length) {
        return null;
    }
    if (!node_crypto_1.default.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return null;
    }
    try {
        return JSON.parse(fromBase64Url(body));
    }
    catch {
        return null;
    }
}
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 12);
}
async function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
function parseDateFromUnknown(value) {
    if (!value)
        return null;
    if (value instanceof Date)
        return value;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed;
}
