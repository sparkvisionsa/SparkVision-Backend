"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTES_COLLECTION = void 0;
exports.toNoteJson = toNoteJson;
exports.NOTES_COLLECTION = "transaction_notes";
function toNoteJson(d) {
    return {
        id: d._id.toString(),
        transactionId: d.transactionId,
        author: {
            id: d.authorId,
            name: d.authorName,
            role: d.authorRole,
            color: d.authorColor,
        },
        content: d.content,
        isPinned: d.isPinned,
        replyTo: d.replyToId
            ? {
                id: d.replyToId,
                content: d.replyToContent ?? "",
                authorName: d.replyToAuthorName ?? "",
            }
            : undefined,
        timestamp: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
