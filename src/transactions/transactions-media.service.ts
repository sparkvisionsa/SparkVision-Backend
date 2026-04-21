import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { unlink } from "fs/promises";
import { join } from "path";
import { getMongoDb } from "@/server/mongodb";
import {
  TRANSACTIONS_COLLECTION,
  type TransactionDoc,
} from "./transactions.model";
import {
  ATTACHMENTS_COLLECTION,
  IMAGES_COLLECTION,
  type AttachmentDoc,
  type ImageDoc,
  toAttachmentJson,
  toImageJson,
} from "./transactions-media.model";

// ─── helpers ──────────────────────────────────────────────────────────────────

function assertObjectId(id: string, label = "المعرّف") {
  if (!ObjectId.isValid(id))
    throw new NotFoundException({ message: `${label} غير صالح` });
}

async function assertTransactionExists(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  transactionId: string,
) {
  assertObjectId(transactionId, "المعاملة");
  const exists = await db
    .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
    .countDocuments({ _id: new ObjectId(transactionId) });
  if (!exists) throw new NotFoundException({ message: "المعاملة غير موجودة" });
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(join(process.cwd(), filePath));
  } catch {
    // file already gone — not a fatal error
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TransactionsMediaService {
  // ── Edit core transaction fields ──────────────────────────────────────────

  /**
   * Updates the editable core fields of a transaction.
   * Deliberately separate from the evalData PATCH so the two concerns
   * never collide.  Only the fields present in the body are updated
   * (undefined = untouched).
   */
  async editCoreFields(id: string, body: Record<string, unknown>) {
    assertObjectId(id, "المعاملة");
    const db = await getMongoDb();

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
    ] as const;

    const $set: Record<string, unknown> = { updatedAt: new Date() };

    for (const key of allowed) {
      if (key in body && typeof body[key] === "string") {
        const val = (body[key] as string).trim();
        if (val !== "") $set[key] = val;
      }
    }

    // "status" lives inside evalData in your model — keep it consistent
    if ("status" in $set) {
      $set["evalData.status"] = $set["status"];
      delete $set["status"];
    }

    if (Object.keys($set).length === 1) {
      // only updatedAt — nothing to do
      throw new BadRequestException({ message: "لا توجد حقول للتحديث" });
    }

    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set },
        { returnDocument: "after" },
      );

    if (!row) throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return row;
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async listAttachments(transactionId: string) {
    await assertTransactionExists(await getMongoDb(), transactionId);
    const db = await getMongoDb();
    const docs = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .find({ transactionId })
      .sort({ uploadedAt: 1 })
      .toArray();
    return docs.map(toAttachmentJson);
  }

  async addAttachments(
    transactionId: string,
    files: Express.Multer.File[],
    names: Record<string, string>, // fieldname -> display name, keyed by original filename
  ) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    if (!files.length)
      throw new BadRequestException({ message: "لم يتم رفع أي ملف" });

    const now = new Date();
    const docs: Omit<AttachmentDoc, "_id">[] = files.map((f) => ({
      transactionId,
      name: names[f.originalname] ?? f.originalname.replace(/\.[^.]+$/, ""),
      originalName: f.originalname,
      mimeType: f.mimetype,
      filePath: `uploads/${f.filename}`,
      size: f.size,
      uploadedAt: now,
    }));

    const { insertedIds } = await db
      .collection<Omit<AttachmentDoc, "_id">>(ATTACHMENTS_COLLECTION)
      .insertMany(docs);

    const ids = Object.values(insertedIds);
    const saved = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .find({ _id: { $in: ids } })
      .toArray();

    // Bump the denormalised count on the transaction
    await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(transactionId) },
        { $inc: { attachmentsCount: files.length }, $set: { updatedAt: now } },
      );

    return saved.map(toAttachmentJson);
  }

  async renameAttachment(
    transactionId: string,
    attachmentId: string,
    name: string,
  ) {
    assertObjectId(attachmentId, "المرفق");
    const db = await getMongoDb();
    const doc = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(attachmentId), transactionId },
        { $set: { name: name.trim() } },
        { returnDocument: "after" },
      );
    if (!doc) throw new NotFoundException({ message: "المرفق غير موجود" });
    return toAttachmentJson(doc);
  }

  async deleteAttachment(transactionId: string, attachmentId: string) {
    assertObjectId(attachmentId, "المرفق");
    const db = await getMongoDb();
    const doc = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .findOneAndDelete({ _id: new ObjectId(attachmentId), transactionId });
    if (!doc) throw new NotFoundException({ message: "المرفق غير موجود" });

    await safeUnlink(doc.filePath);
    await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(transactionId) },
        { $inc: { attachmentsCount: -1 }, $set: { updatedAt: new Date() } },
      );
    return { ok: true };
  }

  async bulkDeleteAttachments(transactionId: string, ids: string[]) {
    if (!ids.length)
      throw new BadRequestException({ message: "لم يتم تحديد مرفقات" });
    const db = await getMongoDb();
    const objectIds = ids.map((id) => {
      assertObjectId(id, "مرفق");
      return new ObjectId(id);
    });
    const docs = await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .find({ _id: { $in: objectIds }, transactionId })
      .toArray();

    if (!docs.length)
      throw new NotFoundException({ message: "لم يتم العثور على مرفقات" });

    await db
      .collection<AttachmentDoc>(ATTACHMENTS_COLLECTION)
      .deleteMany({ _id: { $in: objectIds }, transactionId });

    await Promise.all(docs.map((d) => safeUnlink(d.filePath)));

    await db.collection<TransactionDoc>(TRANSACTIONS_COLLECTION).updateOne(
      { _id: new ObjectId(transactionId) },
      {
        $inc: { attachmentsCount: -docs.length },
        $set: { updatedAt: new Date() },
      },
    );

    return { ok: true, deleted: docs.length };
  }

  // ── Images ────────────────────────────────────────────────────────────────

  async listImages(transactionId: string) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);
    const docs = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ transactionId })
      .sort({ sortIndex: 1 })
      .toArray();
    return docs.map(toImageJson);
  }

  async addImages(
    transactionId: string,
    files: Express.Multer.File[],
    names: Record<string, string>,
  ) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);
    if (!files.length)
      throw new BadRequestException({ message: "لم يتم رفع أي صورة" });

    // Find the current max sortIndex so new images are appended
    const maxDoc = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ transactionId })
      .sort({ sortIndex: -1 })
      .limit(1)
      .toArray();
    let nextIndex = maxDoc.length ? maxDoc[0].sortIndex + 1 : 1;

    const now = new Date();
    const docs: Omit<ImageDoc, "_id">[] = files.map((f) => ({
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
      .collection<Omit<ImageDoc, "_id">>(IMAGES_COLLECTION)
      .insertMany(docs);

    const ids = Object.values(insertedIds);
    const saved = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ _id: { $in: ids } })
      .sort({ sortIndex: 1 })
      .toArray();

    await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(transactionId) },
        { $inc: { imagesCount: files.length }, $set: { updatedAt: now } },
      );

    return saved.map(toImageJson);
  }

  async renameImage(transactionId: string, imageId: string, name: string) {
    assertObjectId(imageId, "الصورة");
    const db = await getMongoDb();
    const doc = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(imageId), transactionId },
        { $set: { name: name.trim() } },
        { returnDocument: "after" },
      );
    if (!doc) throw new NotFoundException({ message: "الصورة غير موجودة" });
    return toImageJson(doc);
  }

  /**
   * Reorder images for a transaction.
   * Body: `{ order: [{ id, sortIndex }] }`
   * Validates that the incoming indexes are a valid permutation of 1..N,
   * then bulk-writes the new sort positions.
   */
  async reorderImages(
    transactionId: string,
    order: { id: string; sortIndex: number }[],
  ) {
    if (!order.length)
      throw new BadRequestException({ message: "قائمة الترتيب فارغة" });

    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    // Validate that every id belongs to this transaction
    const objectIds = order.map(({ id }) => {
      assertObjectId(id, "صورة");
      return new ObjectId(id);
    });

    const existing = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ _id: { $in: objectIds }, transactionId })
      .toArray();

    if (existing.length !== order.length)
      throw new BadRequestException({
        message: "بعض الصور غير موجودة أو لا تنتمي لهذه المعاملة",
      });

    // Validate that sortIndex values are a contiguous range starting at 1
    const indexes = order.map((o) => o.sortIndex).sort((a, b) => a - b);
    const isValid = indexes[0] === 1 && indexes.every((v, i) => v === i + 1);
    if (!isValid)
      throw new BadRequestException({
        message: "قيم الترتيب يجب أن تكون أعداداً متتالية تبدأ من 1",
      });

    // Bulk write
    const ops = order.map(({ id, sortIndex }) => ({
      updateOne: {
        filter: { _id: new ObjectId(id), transactionId },
        update: { $set: { sortIndex } },
      },
    }));
    await db.collection<ImageDoc>(IMAGES_COLLECTION).bulkWrite(ops);

    const updated = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ transactionId })
      .sort({ sortIndex: 1 })
      .toArray();

    return updated.map(toImageJson);
  }

  async deleteImage(transactionId: string, imageId: string) {
    assertObjectId(imageId, "الصورة");
    const db = await getMongoDb();
    const doc = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .findOneAndDelete({ _id: new ObjectId(imageId), transactionId });
    if (!doc) throw new NotFoundException({ message: "الصورة غير موجودة" });

    await safeUnlink(doc.filePath);

    // Re-sequence remaining images so sortIndex stays gapless
    const remaining = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
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
      await db.collection<ImageDoc>(IMAGES_COLLECTION).bulkWrite(reorderOps);
    }

    await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .updateOne(
        { _id: new ObjectId(transactionId) },
        { $inc: { imagesCount: -1 }, $set: { updatedAt: new Date() } },
      );

    return { ok: true };
  }

  async bulkDeleteImages(transactionId: string, ids: string[]) {
    if (!ids.length)
      throw new BadRequestException({ message: "لم يتم تحديد صور" });
    const db = await getMongoDb();
    const objectIds = ids.map((id) => {
      assertObjectId(id, "صورة");
      return new ObjectId(id);
    });

    const docs = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .find({ _id: { $in: objectIds }, transactionId })
      .toArray();

    if (!docs.length)
      throw new NotFoundException({ message: "لم يتم العثور على صور" });

    await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
      .deleteMany({ _id: { $in: objectIds }, transactionId });

    await Promise.all(docs.map((d) => safeUnlink(d.filePath)));

    // Re-sequence
    const remaining = await db
      .collection<ImageDoc>(IMAGES_COLLECTION)
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
      await db.collection<ImageDoc>(IMAGES_COLLECTION).bulkWrite(reorderOps);
    }

    await db.collection<TransactionDoc>(TRANSACTIONS_COLLECTION).updateOne(
      { _id: new ObjectId(transactionId) },
      {
        $inc: { imagesCount: -docs.length },
        $set: { updatedAt: new Date() },
      },
    );

    return { ok: true, deleted: docs.length };
  }
}
