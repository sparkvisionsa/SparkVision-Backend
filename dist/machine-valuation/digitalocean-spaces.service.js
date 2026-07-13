"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DigitalOceanSpacesService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DigitalOceanSpacesService = void 0;
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const node_stream_1 = require("node:stream");
function env(name) {
    return process.env[name]?.trim() ?? "";
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function deriveEndpointFromOrigin(originEndpoint, bucket) {
    if (!originEndpoint)
        return "";
    try {
        const url = new URL(originEndpoint);
        const bucketPrefix = `${bucket}.`;
        const host = url.hostname.startsWith(bucketPrefix)
            ? url.hostname.slice(bucketPrefix.length)
            : url.hostname;
        return `${url.protocol}//${host}`;
    }
    catch {
        return "";
    }
}
function deriveRegionFromEndpoint(endpoint) {
    try {
        const host = new URL(endpoint).hostname;
        const first = host.split(".")[0] ?? "";
        return first || "us-east-1";
    }
    catch {
        return "us-east-1";
    }
}
function originFromEndpoint(endpoint, bucket) {
    try {
        const url = new URL(endpoint);
        return `${url.protocol}//${bucket}.${url.hostname}`;
    }
    catch {
        return "";
    }
}
function encodeSpacesKey(key) {
    return key
        .split("/")
        .filter((part) => part.length > 0)
        .map((part) => encodeURIComponent(part))
        .join("/");
}
function sanitizeSpacesKeySegment(raw, fallback) {
    const cleaned = String(raw ?? "")
        .trim()
        .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .replace(/^\.+$/, "")
        .trim();
    return (cleaned || fallback).slice(0, 180);
}
function toNodeReadable(body) {
    if (body instanceof node_stream_1.Readable)
        return body;
    if (body && typeof body.pipe === "function") {
        return body;
    }
    if (body &&
        typeof body.transformToWebStream === "function") {
        const webStream = body
            .transformToWebStream();
        return node_stream_1.Readable.fromWeb(webStream);
    }
    if (body &&
        typeof body[Symbol.asyncIterator] === "function") {
        return node_stream_1.Readable.from(body);
    }
    throw new common_1.InternalServerErrorException("Invalid object stream from DigitalOcean Spaces.");
}
function totalBytesFromContentRange(contentRange, fallback) {
    if (!contentRange)
        return fallback;
    const match = contentRange.match(/\/(\d+)$/);
    if (!match)
        return fallback;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : fallback;
}
let DigitalOceanSpacesService = DigitalOceanSpacesService_1 = class DigitalOceanSpacesService {
    constructor() {
        this.logger = new common_1.Logger(DigitalOceanSpacesService_1.name);
        const accessKeyId = env("DO_SPACES_ACCESS_KEY_ID");
        const secretAccessKey = env("DO_SPACES_SECRET_ACCESS_KEY") || env("DO_SPACES_SECRET_KEY");
        this.bucket = env("DO_SPACES_BUCKET") || env("DO_SPACES_BUCKET_NAME");
        this.prefix = sanitizeSpacesKeySegment(env("DO_SPACES_INSPECTOR_PREFIX") || "mv-inspector", "mv-inspector");
        const originEndpoint = trimTrailingSlash(env("DO_SPACES_ORIGIN_ENDPOINT"));
        const endpoint = trimTrailingSlash(env("DO_SPACES_ENDPOINT") || deriveEndpointFromOrigin(originEndpoint, this.bucket));
        const region = env("DO_SPACES_REGION") || deriveRegionFromEndpoint(endpoint);
        this.originEndpoint =
            originEndpoint || (endpoint && this.bucket ? originFromEndpoint(endpoint, this.bucket) : "");
        if (!accessKeyId || !secretAccessKey || !this.bucket || !endpoint) {
            this.client = null;
            this.logger.warn("DigitalOcean Spaces env is incomplete. Inspector file uploads are disabled.");
            return;
        }
        this.client = new client_s3_1.S3Client({
            region,
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
        });
    }
    isReady() {
        return this.client != null && this.bucket.length > 0;
    }
    requireClient() {
        if (!this.client || !this.bucket) {
            throw new common_1.InternalServerErrorException("DigitalOcean Spaces is not configured.");
        }
        return this.client;
    }
    buildInspectorKey(projectId, entryId, fileName) {
        const projectSegment = sanitizeSpacesKeySegment(projectId, "project");
        const entrySegment = sanitizeSpacesKeySegment(entryId, "file");
        const fileSegment = sanitizeSpacesKeySegment(fileName, "file");
        return [this.prefix, projectSegment, entrySegment, fileSegment].filter(Boolean).join("/");
    }
    publicUrlForKey(key) {
        if (!this.originEndpoint)
            return "";
        return `${this.originEndpoint}/${encodeSpacesKey(key)}`;
    }
    async uploadInspectorFile(params) {
        const client = this.requireClient();
        const key = this.buildInspectorKey(params.projectId, params.entryId, params.fileName);
        await client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: params.buffer,
            ContentType: params.contentType || "application/octet-stream",
            ContentLength: params.buffer.length,
        }));
        return { key, url: this.publicUrlForKey(key) };
    }
    async deleteObject(key) {
        const normalizedKey = key.trim();
        if (!normalizedKey)
            return;
        const client = this.requireClient();
        await client.send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: normalizedKey }));
    }
    async getObjectStream(key, opts) {
        const normalizedKey = key.trim();
        if (!normalizedKey) {
            throw new common_1.InternalServerErrorException("Missing DigitalOcean Spaces object key.");
        }
        const client = this.requireClient();
        const range = opts?.rangeHeader?.trim();
        const response = await client.send(new client_s3_1.GetObjectCommand({
            Bucket: this.bucket,
            Key: normalizedKey,
            ...(range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}),
        }));
        const contentLength = Number(response.ContentLength ?? 0);
        const contentRange = response.ContentRange;
        return {
            stream: toNodeReadable(response.Body),
            contentType: response.ContentType || "application/octet-stream",
            contentLength: Number.isFinite(contentLength) ? contentLength : 0,
            totalBytes: totalBytesFromContentRange(contentRange, contentLength),
            httpStatus: response.$metadata.httpStatusCode === 206 ? 206 : 200,
            contentRange,
        };
    }
};
exports.DigitalOceanSpacesService = DigitalOceanSpacesService;
exports.DigitalOceanSpacesService = DigitalOceanSpacesService = DigitalOceanSpacesService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DigitalOceanSpacesService);
