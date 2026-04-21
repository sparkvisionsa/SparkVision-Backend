"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsMediaService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const promises_1 = require("fs/promises");
const path_1 = require("path");
const mongodb_2 = require("../server/mongodb");
const transactions_model_1 = require("./transactions.model");
const transactions_media_model_1 = require("./transactions-media.model");
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
async function safeUnlink(filePath) {
    try {
        await (0, promises_1.unlink)((0, path_1.join)(process.cwd(), filePath));
    }
    catch {
    }
}
let TransactionsMediaService = class TransactionsMediaService {
    async editCoreFields(id, body) {
        assertObjectId(id, "المعاملة");
        const db = await (0, mongodb_2.getMongoDb)();
        const allowed = [
            "assignmentNumber",
            "authorizationNumber",
            "assignmentDate",
            "valuationPurpose",
            "intendedUse",
            "valuationBasis",
            "ownershipType",
            "valuationHypothesis",
            "clientId",
            "branch",
            "priority",
            "status",
        ];
        const $set = { updatedAt: new Date() };
        for (const key of allowed) {
            if (key in body && typeof body[key] === "string") {
                const val = body[key].trim();
                if (val !== "")
                    $set[key] = val;
            }
        }
        if ("status" in $set) {
            $set["evalData.status"] = $set["status"];
            delete $set["status"];
        }
        if (Object.keys($set).length === 1) {
            throw new common_1.BadRequestException({ message: "لا توجد حقول للتحديث" });
        }
        const row = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, { $set }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        return row;
    }
    async listAttachments(transactionId) {
        await assertTransactionExists(await (0, mongodb_2.getMongoDb)(), transactionId);
        const db = await (0, mongodb_2.getMongoDb)();
        const docs = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .find({ transactionId })
            .sort({ uploadedAt: 1 })
            .toArray();
        return docs.map(transactions_media_model_1.toAttachmentJson);
    }
    async addAttachments(transactionId, files, names) {
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        if (!files.length)
            throw new common_1.BadRequestException({ message: "لم يتم رفع أي ملف" });
        const now = new Date();
        const docs = files.map((f) => ({
            transactionId,
            name: names[f.originalname] ?? f.originalname.replace(/\.[^.]+$/, ""),
            originalName: f.originalname,
            mimeType: f.mimetype,
            filePath: `uploads/${f.filename}`,
            size: f.size,
            uploadedAt: now,
        }));
        const { insertedIds } = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .insertMany(docs);
        const ids = Object.values(insertedIds);
        const saved = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .find({ _id: { $in: ids } })
            .toArray();
        await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, { $inc: { attachmentsCount: files.length }, $set: { updatedAt: now } });
        return saved.map(transactions_media_model_1.toAttachmentJson);
    }
    async renameAttachment(transactionId, attachmentId, name) {
        assertObjectId(attachmentId, "المرفق");
        const db = await (0, mongodb_2.getMongoDb)();
        const doc = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(attachmentId), transactionId }, { $set: { name: name.trim() } }, { returnDocument: "after" });
        if (!doc)
            throw new common_1.NotFoundException({ message: "المرفق غير موجود" });
        return (0, transactions_media_model_1.toAttachmentJson)(doc);
    }
    async deleteAttachment(transactionId, attachmentId) {
        assertObjectId(attachmentId, "المرفق");
        const db = await (0, mongodb_2.getMongoDb)();
        const doc = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .findOneAndDelete({ _id: new mongodb_1.ObjectId(attachmentId), transactionId });
        if (!doc)
            throw new common_1.NotFoundException({ message: "المرفق غير موجود" });
        await safeUnlink(doc.filePath);
        await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, { $inc: { attachmentsCount: -1 }, $set: { updatedAt: new Date() } });
        return { ok: true };
    }
    async bulkDeleteAttachments(transactionId, ids) {
        if (!ids.length)
            throw new common_1.BadRequestException({ message: "لم يتم تحديد مرفقات" });
        const db = await (0, mongodb_2.getMongoDb)();
        const objectIds = ids.map((id) => {
            assertObjectId(id, "مرفق");
            return new mongodb_1.ObjectId(id);
        });
        const docs = await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .find({ _id: { $in: objectIds }, transactionId })
            .toArray();
        if (!docs.length)
            throw new common_1.NotFoundException({ message: "لم يتم العثور على مرفقات" });
        await db
            .collection(transactions_media_model_1.ATTACHMENTS_COLLECTION)
            .deleteMany({ _id: { $in: objectIds }, transactionId });
        await Promise.all(docs.map((d) => safeUnlink(d.filePath)));
        await db.collection(transactions_model_1.TRANSACTIONS_COLLECTION).updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, {
            $inc: { attachmentsCount: -docs.length },
            $set: { updatedAt: new Date() },
        });
        return { ok: true, deleted: docs.length };
    }
    async listImages(transactionId) {
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        const docs = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId })
            .sort({ sortIndex: 1 })
            .toArray();
        return docs.map(transactions_media_model_1.toImageJson);
    }
    async addImages(transactionId, files, names) {
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        if (!files.length)
            throw new common_1.BadRequestException({ message: "لم يتم رفع أي صورة" });
        const maxDoc = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId })
            .sort({ sortIndex: -1 })
            .limit(1)
            .toArray();
        let nextIndex = maxDoc.length ? maxDoc[0].sortIndex + 1 : 1;
        const now = new Date();
        const docs = files.map((f) => ({
            transactionId,
            name: names[f.originalname] ?? f.originalname.replace(/\.[^.]+$/, ""),
            originalName: f.originalname,
            mimeType: f.mimetype,
            filePath: `uploads/${f.filename}`,
            size: f.size,
            sortIndex: nextIndex++,
            uploadedAt: now,
        }));
        const { insertedIds } = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .insertMany(docs);
        const ids = Object.values(insertedIds);
        const saved = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ _id: { $in: ids } })
            .sort({ sortIndex: 1 })
            .toArray();
        await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, { $inc: { imagesCount: files.length }, $set: { updatedAt: now } });
        return saved.map(transactions_media_model_1.toImageJson);
    }
    async renameImage(transactionId, imageId, name) {
        assertObjectId(imageId, "الصورة");
        const db = await (0, mongodb_2.getMongoDb)();
        const doc = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(imageId), transactionId }, { $set: { name: name.trim() } }, { returnDocument: "after" });
        if (!doc)
            throw new common_1.NotFoundException({ message: "الصورة غير موجودة" });
        return (0, transactions_media_model_1.toImageJson)(doc);
    }
    async reorderImages(transactionId, order) {
        if (!order.length)
            throw new common_1.BadRequestException({ message: "قائمة الترتيب فارغة" });
        const db = await (0, mongodb_2.getMongoDb)();
        await assertTransactionExists(db, transactionId);
        const objectIds = order.map(({ id }) => {
            assertObjectId(id, "صورة");
            return new mongodb_1.ObjectId(id);
        });
        const existing = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ _id: { $in: objectIds }, transactionId })
            .toArray();
        if (existing.length !== order.length)
            throw new common_1.BadRequestException({
                message: "بعض الصور غير موجودة أو لا تنتمي لهذه المعاملة",
            });
        const indexes = order.map((o) => o.sortIndex).sort((a, b) => a - b);
        const isValid = indexes[0] === 1 && indexes.every((v, i) => v === i + 1);
        if (!isValid)
            throw new common_1.BadRequestException({
                message: "قيم الترتيب يجب أن تكون أعداداً متتالية تبدأ من 1",
            });
        const ops = order.map(({ id, sortIndex }) => ({
            updateOne: {
                filter: { _id: new mongodb_1.ObjectId(id), transactionId },
                update: { $set: { sortIndex } },
            },
        }));
        await db.collection(transactions_media_model_1.IMAGES_COLLECTION).bulkWrite(ops);
        const updated = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId })
            .sort({ sortIndex: 1 })
            .toArray();
        return updated.map(transactions_media_model_1.toImageJson);
    }
    async deleteImage(transactionId, imageId) {
        assertObjectId(imageId, "الصورة");
        const db = await (0, mongodb_2.getMongoDb)();
        const doc = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .findOneAndDelete({ _id: new mongodb_1.ObjectId(imageId), transactionId });
        if (!doc)
            throw new common_1.NotFoundException({ message: "الصورة غير موجودة" });
        await safeUnlink(doc.filePath);
        const remaining = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId })
            .sort({ sortIndex: 1 })
            .toArray();
        if (remaining.length) {
            const reorderOps = remaining.map((img, i) => ({
                updateOne: {
                    filter: { _id: img._id },
                    update: { $set: { sortIndex: i + 1 } },
                },
            }));
            await db.collection(transactions_media_model_1.IMAGES_COLLECTION).bulkWrite(reorderOps);
        }
        await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, { $inc: { imagesCount: -1 }, $set: { updatedAt: new Date() } });
        return { ok: true };
    }
    async bulkDeleteImages(transactionId, ids) {
        if (!ids.length)
            throw new common_1.BadRequestException({ message: "لم يتم تحديد صور" });
        const db = await (0, mongodb_2.getMongoDb)();
        const objectIds = ids.map((id) => {
            assertObjectId(id, "صورة");
            return new mongodb_1.ObjectId(id);
        });
        const docs = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ _id: { $in: objectIds }, transactionId })
            .toArray();
        if (!docs.length)
            throw new common_1.NotFoundException({ message: "لم يتم العثور على صور" });
        await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .deleteMany({ _id: { $in: objectIds }, transactionId });
        await Promise.all(docs.map((d) => safeUnlink(d.filePath)));
        const remaining = await db
            .collection(transactions_media_model_1.IMAGES_COLLECTION)
            .find({ transactionId })
            .sort({ sortIndex: 1 })
            .toArray();
        if (remaining.length) {
            const reorderOps = remaining.map((img, i) => ({
                updateOne: {
                    filter: { _id: img._id },
                    update: { $set: { sortIndex: i + 1 } },
                },
            }));
            await db.collection(transactions_media_model_1.IMAGES_COLLECTION).bulkWrite(reorderOps);
        }
        await db.collection(transactions_model_1.TRANSACTIONS_COLLECTION).updateOne({ _id: new mongodb_1.ObjectId(transactionId) }, {
            $inc: { imagesCount: -docs.length },
            $set: { updatedAt: new Date() },
        });
        return { ok: true, deleted: docs.length };
    }
};
exports.TransactionsMediaService = TransactionsMediaService;
exports.TransactionsMediaService = TransactionsMediaService = __decorate([
    (0, common_1.Injectable)()
], TransactionsMediaService);
