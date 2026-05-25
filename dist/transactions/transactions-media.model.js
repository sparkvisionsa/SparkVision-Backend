"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMAGES_COLLECTION = exports.ATTACHMENTS_COLLECTION = void 0;
exports.toAttachmentJson = toAttachmentJson;
exports.toImageJson = toImageJson;
exports.ATTACHMENTS_COLLECTION = "transaction_attachments";
exports.IMAGES_COLLECTION = "transaction_images";
function toAttachmentJson(d) {
    return {
        id: d._id.toString(),
        transactionId: d.transactionId,
        name: d.name,
        originalName: d.originalName,
        mimeType: d.mimeType,
        filePath: d.filePath,
        size: d.size,
        uploadedAt: d.uploadedAt.toISOString(),
        type: resolveType(d.mimeType),
    };
}
function toImageJson(d) {
    const resolvedPath = d.url ?? d.filePath ?? "";
    return {
        id: d._id.toString(),
        transactionId: d.transactionId.toString(),
        name: d.name,
        originalName: d.originalName,
        mimeType: d.mimeType,
        filePath: resolvedPath,
        size: d.size,
        sortIndex: d.sortIndex,
        uploadedAt: d.uploadedAt.toISOString(),
    };
}
function resolveType(mime) {
    if (mime === "application/pdf")
        return "pdf";
    if (mime.startsWith("image/"))
        return "image";
    return "other";
}
