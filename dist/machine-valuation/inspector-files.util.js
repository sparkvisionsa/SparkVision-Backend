"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectorLogicalTypeFromMime = inspectorLogicalTypeFromMime;
exports.serializeInspectorFileForClient = serializeInspectorFileForClient;
exports.normalizeInspectorFilesArray = normalizeInspectorFilesArray;
exports.normalizeInspectorFileFromDb = normalizeInspectorFileFromDb;
const OFFICE_WORD = new Set([
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const OFFICE_SHEET = new Set([
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/csv",
]);
function inspectorLogicalTypeFromMime(mime, fileName) {
    const m = (mime || "").toLowerCase().trim();
    const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
    if (m === "application/pdf" || ext === "pdf")
        return "pdf";
    if (m.startsWith("image/"))
        return "image";
    if (m.startsWith("video/"))
        return "video";
    if (m.startsWith("audio/"))
        return "audio";
    if (OFFICE_SHEET.has(m) || ["xlsx", "xls", "csv"].includes(ext))
        return "excel";
    if (OFFICE_WORD.has(m) || ["doc", "docx"].includes(ext))
        return "word";
    if (m === "application/octet-stream" &&
        ["webm", "mp3", "wav", "m4a", "ogg", "opus", "aac"].includes(ext)) {
        return "audio";
    }
    if (m === "application/octet-stream" && ["mp4", "mov", "mkv", "webm"].includes(ext)) {
        return "video";
    }
    return "other";
}
function normalizeStorageKind(storage, params) {
    if (storage === "digitalocean" || storage === "gridfs" || storage === "external") {
        return storage;
    }
    if (params.spacesKey)
        return "digitalocean";
    if (params.gridFsFileId)
        return "gridfs";
    if (params.externalUrl)
        return "external";
    return "digitalocean";
}
function toOptionalString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function objectIdishToString(value) {
    if (value == null)
        return undefined;
    if (typeof value === "object" && value && "toString" in value) {
        const out = String(value.toString()).trim();
        return out || undefined;
    }
    const out = String(value).trim();
    return out || undefined;
}
function serializeInspectorFileForClient(row) {
    const r = row;
    const created = r.createdAt;
    const createdIso = created instanceof Date
        ? created.toISOString()
        : typeof created === "string"
            ? created
            : new Date().toISOString();
    const spacesKey = toOptionalString(r.spacesKey);
    const gridFsFileId = objectIdishToString(r.gridFsFileId);
    const url = String(r.url ?? "");
    const storage = normalizeStorageKind(r.storage, {
        spacesKey,
        gridFsFileId,
        externalUrl: /^https?:\/\//i.test(url) ? url : undefined,
    });
    const sizeBytes = Number(r.sizeBytes);
    return {
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
        type: r.type || "other",
        url,
        uploadedBy: r.uploadedBy != null ? String(r.uploadedBy) : null,
        createdAt: createdIso,
        storage,
        mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
        spacesKey,
        gridFsFileId,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : undefined,
    };
}
function normalizeInspectorFilesArray(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        const n = normalizeInspectorFileFromDb(item);
        if (n)
            out.push(n);
    }
    return out;
}
function normalizeInspectorFileFromDb(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id)
        return null;
    const name = typeof o.name === "string" ? o.name.slice(0, 500) : "";
    const url = typeof o.url === "string" ? o.url : "";
    const spacesKey = toOptionalString(o.spacesKey);
    const gridFsFileId = objectIdishToString(o.gridFsFileId);
    const hasExternalUrl = /^https?:\/\//i.test(url);
    const hasApiDownloadUrl = url.includes("/inspectorFiles/") && url.includes("/download");
    if (!name || (!url && !spacesKey && !gridFsFileId))
        return null;
    const type = o.type || "other";
    const uploadedBy = o.uploadedBy != null ? String(o.uploadedBy) : null;
    let createdAt = new Date();
    if (o.createdAt instanceof Date)
        createdAt = o.createdAt;
    else if (typeof o.createdAt === "string") {
        const d = new Date(o.createdAt);
        if (!Number.isNaN(d.getTime()))
            createdAt = d;
    }
    const storage = normalizeStorageKind(o.storage, {
        spacesKey,
        gridFsFileId: gridFsFileId || (hasApiDownloadUrl ? id : undefined),
        externalUrl: hasExternalUrl ? url : undefined,
    });
    const sizeBytes = Number(o.sizeBytes);
    return {
        id,
        name,
        type,
        url,
        uploadedBy,
        createdAt,
        storage,
        spacesKey,
        gridFsFileId,
        mimeType: typeof o.mimeType === "string" ? o.mimeType : undefined,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : undefined,
    };
}
