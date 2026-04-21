"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsNotesService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const transactions_notes_model_1 = require("./transactions-notes.model");
const transactions_model_1 = require("./transactions.model");
function assertObjectId(id, label = "المعرّف") {
    if (!mongodb_1.ObjectId.isValid(id))
        throw new common_1.NotFoundException({ message: `${label} غير صالح` });
}
async function assertTransactionExists(db, transactionId) {
    assertObjectId(transactionId, "المعاملة");
    const exists = await db
        .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
        .countDocuments({ _id: new mongodb_1.ObjectId(transactionId) });
    if (!exists)
        throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
}
let TransactionsNotesService = class TransactionsNotesService {
    async listNotes(transactionId) {
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        const docs = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .find({ transactionId })
            .sort({ createdAt: 1 })
            .toArray();
        return docs.map(transactions_notes_model_1.toNoteJson);
    }
    async addNote(transactionId, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        const content = body.content?.trim();
        if (!content)
            throw new common_1.BadRequestException({ message: "محتوى الملاحظة مطلوب" });
        let replyToId = null;
        let replyToContent = null;
        let replyToAuthorName = null;
        if (body.replyToId) {
            assertObjectId(body.replyToId, "الملاحظة الأصلية");
            const parent = await db.collection(transactions_notes_model_1.NOTES_COLLECTION).findOne({
                _id: new mongodb_1.ObjectId(body.replyToId),
                transactionId,
            });
            if (!parent)
                throw new common_1.NotFoundException({ message: "الملاحظة الأصلية غير موجودة" });
            replyToId = body.replyToId;
            replyToContent = parent.content;
            replyToAuthorName = parent.authorName;
        }
        const now = new Date();
        const doc = {
            transactionId,
            authorId: body.authorId ?? "unknown",
            authorName: body.authorName ?? "مجهول",
            authorRole: body.authorRole ?? "",
            authorColor: body.authorColor ?? "bg-slate-500",
            content,
            isPinned: false,
            replyToId,
            replyToContent,
            replyToAuthorName,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .insertOne(doc);
        const saved = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .findOne({ _id: insertedId });
        if (!saved)
            throw new common_1.NotFoundException();
        return (0, transactions_notes_model_1.toNoteJson)(saved);
    }
    async togglePin(transactionId, noteId) {
        assertObjectId(noteId, "الملاحظة");
        const db = await (0, mongodb_2.getMongoDb)();
        const note = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(noteId), transactionId });
        if (!note)
            throw new common_1.NotFoundException({ message: "الملاحظة غير موجودة" });
        const updated = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(noteId), transactionId }, {
            $set: {
                isPinned: !note.isPinned,
                updatedAt: new Date(),
            },
        }, { returnDocument: "after" });
        if (!updated)
            throw new common_1.NotFoundException({ message: "الملاحظة غير موجودة" });
        return (0, transactions_notes_model_1.toNoteJson)(updated);
    }
    async editNote(transactionId, noteId, content) {
        assertObjectId(noteId, "الملاحظة");
        const trimmed = content?.trim();
        if (!trimmed)
            throw new common_1.BadRequestException({ message: "محتوى الملاحظة مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const updated = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(noteId), transactionId }, { $set: { content: trimmed, updatedAt: new Date() } }, { returnDocument: "after" });
        if (!updated)
            throw new common_1.NotFoundException({ message: "الملاحظة غير موجودة" });
        return (0, transactions_notes_model_1.toNoteJson)(updated);
    }
    async deleteNote(transactionId, noteId) {
        assertObjectId(noteId, "الملاحظة");
        const db = await (0, mongodb_2.getMongoDb)();
        const result = await db
            .collection(transactions_notes_model_1.NOTES_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(noteId), transactionId });
        if (result.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "الملاحظة غير موجودة" });
        return { ok: true };
    }
};
exports.TransactionsNotesService = TransactionsNotesService;
exports.TransactionsNotesService = TransactionsNotesService = __decorate([
    (0, common_1.Injectable)()
], TransactionsNotesService);
