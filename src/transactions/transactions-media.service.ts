import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { ObjectId, type Filter, type Document } from "mongodb";
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

const logger = new Logger("TransactionsMediaService");

/**
 * Returns a filter that matches transactionId stored as EITHER a plain string
 * OR a MongoDB ObjectId — handles legacy documents created before the schema
 * was standardised to strings.
 */
function transactionIdFilter(transactionId: string): Filter<Document> {
  if (ObjectId.isValid(transactionId)) {
    return {
      $or: [
        { transactionId: transactionId },
        { transactionId: new ObjectId(transactionId) },
      ],
    };
  }
  // Not a valid ObjectId — can only be stored as a string
  return { transactionId };
}

/**
 * Same as transactionIdFilter but also constrains _id, for use in
 * findOneAndUpdate / findOneAndDelete / find with a specific document id.
 */
function byIdAndTransaction(
  docId: string,
  transactionId: string,
): Filter<Document> {
  return {
    _id: new ObjectId(docId),
    ...transactionIdFilter(transactionId),
  } as Filter<Document>;
}

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
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    logger.debug(`safeUnlink: skipping remote URL ${filePath}`);
    return;
  }
  try {
    await unlink(join(process.cwd(), filePath));
    logger.debug(`safeUnlink: deleted ${filePath}`);
  } catch (err: any) {
    logger.warn(
      `safeUnlink: could not delete ${filePath} — ${err?.code ?? err}`,
    );
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TransactionsMediaService {
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

    if ("status" in $set) {
      $set["evalData.status"] = $set["status"];
      delete $set["status"];
    }

    if (Object.keys($set).length === 1) {
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
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    const filter = transactionIdFilter(transactionId);
    logger.debug(`listAttachments filter: ${JSON.stringify(filter)}`);

    const raw = await db
      .collection(ATTACHMENTS_COLLECTION)
      .find(filter)
      .sort({ uploadedAt: 1 })
      .toArray();

    logger.debug(
      `listAttachments: found ${raw.length} docs for txId=${transactionId}`,
    );
    if (raw.length > 0) {
      logger.debug(
        `listAttachments sample doc transactionId type: ${typeof raw[0].transactionId}, value: ${raw[0].transactionId}`,
      );
    }

    return raw.map((doc) => toAttachmentJson(doc as unknown as AttachmentDoc));
  }

  async addAttachments(
    transactionId: string,
    files: Express.Multer.File[],
    names: Record<string, string>,
  ) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    if (!files.length)
      throw new BadRequestException({ message: "لم يتم رفع أي ملف" });

    const now = new Date();
    // Always store transactionId as a plain string going forward
    const docs: Omit<AttachmentDoc, "_id">[] = files.map((f) => ({
      transactionId: transactionId.toString(),
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

    const filter = byIdAndTransaction(attachmentId, transactionId);
    logger.debug(`renameAttachment filter: ${JSON.stringify(filter)}`);

    const doc = await db
      .collection(ATTACHMENTS_COLLECTION)
      .findOneAndUpdate(
        filter,
        { $set: { name: name.trim() } },
        { returnDocument: "after" },
      );
    if (!doc) throw new NotFoundException({ message: "المرفق غير موجود" });
    return toAttachmentJson(doc as unknown as AttachmentDoc);
  }

  async deleteAttachment(transactionId: string, attachmentId: string) {
    assertObjectId(attachmentId, "المرفق");
    const db = await getMongoDb();

    const filter = byIdAndTransaction(attachmentId, transactionId);
    logger.debug(`deleteAttachment filter: ${JSON.stringify(filter)}`);

    const doc = await db
      .collection(ATTACHMENTS_COLLECTION)
      .findOneAndDelete(filter);
    if (!doc) throw new NotFoundException({ message: "المرفق غير موجود" });

    await safeUnlink((doc as any).filePath);
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

    const txFilter = transactionIdFilter(transactionId);
    const filter = { _id: { $in: objectIds }, ...txFilter } as Filter<Document>;
    logger.debug(`bulkDeleteAttachments filter: ${JSON.stringify(filter)}`);

    const docs = await db
      .collection(ATTACHMENTS_COLLECTION)
      .find(filter)
      .toArray();
    logger.debug(
      `bulkDeleteAttachments: found ${docs.length} of ${ids.length} requested`,
    );

    if (!docs.length)
      throw new NotFoundException({ message: "لم يتم العثور على مرفقات" });

    await db.collection(ATTACHMENTS_COLLECTION).deleteMany(filter);
    await Promise.all(docs.map((d) => safeUnlink((d as any).filePath)));
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

    const filter = {
      ...transactionIdFilter(transactionId),
      $or: [
        { mediaType: { $exists: false } }, // old docs have no mediaType
        { mediaType: "image" }, // new docs explicitly typed as image
      ],
    } as Filter<Document>;

    const raw = await db
      .collection(IMAGES_COLLECTION)
      .find(filter)
      .sort({ sortIndex: 1 })
      .toArray();

    return raw.map((doc) => toImageJson(doc as unknown as ImageDoc));
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

    const filter = transactionIdFilter(transactionId);
    const maxDoc = await db
      .collection(IMAGES_COLLECTION)
      .find(filter)
      .sort({ sortIndex: -1 })
      .limit(1)
      .toArray();

    let nextIndex = maxDoc.length ? (maxDoc[0] as any).sortIndex + 1 : 1;

    const now = new Date();
    // Always store as plain string going forward
    const docs: Omit<ImageDoc, "_id">[] = files.map((f) => ({
      transactionId: transactionId.toString(),
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

    const filter = byIdAndTransaction(imageId, transactionId);
    logger.debug(`renameImage filter: ${JSON.stringify(filter)}`);

    const doc = await db
      .collection(IMAGES_COLLECTION)
      .findOneAndUpdate(
        filter,
        { $set: { name: name.trim() } },
        { returnDocument: "after" },
      );
    if (!doc) throw new NotFoundException({ message: "الصورة غير موجودة" });
    return toImageJson(doc as unknown as ImageDoc);
  }

  async reorderImages(
    transactionId: string,
    order: { id: string; sortIndex: number }[],
  ) {
    if (!order.length)
      throw new BadRequestException({ message: "قائمة الترتيب فارغة" });

    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    const objectIds = order.map(({ id }) => {
      assertObjectId(id, "صورة");
      return new ObjectId(id);
    });

    const txFilter = transactionIdFilter(transactionId);
    const existing = await db
      .collection(IMAGES_COLLECTION)
      .find({ _id: { $in: objectIds }, ...txFilter } as Filter<Document>)
      .toArray();

    logger.debug(`reorderImages: found ${existing.length} of ${order.length}`);

    if (existing.length !== order.length)
      throw new BadRequestException({
        message: "بعض الصور غير موجودة أو لا تنتمي لهذه المعاملة",
      });

    const indexes = order.map((o) => o.sortIndex).sort((a, b) => a - b);
    const isValid = indexes[0] === 1 && indexes.every((v, i) => v === i + 1);
    if (!isValid)
      throw new BadRequestException({
        message: "قيم الترتيب يجب أن تكون أعداداً متتالية تبدأ من 1",
      });

    const ops = order.map(({ id, sortIndex }) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) } as Filter<Document>,
        update: { $set: { sortIndex } },
      },
    }));
    await db.collection(IMAGES_COLLECTION).bulkWrite(ops);

    const updated = await db
      .collection(IMAGES_COLLECTION)
      .find(txFilter)
      .sort({ sortIndex: 1 })
      .toArray();

    return updated.map((doc) => toImageJson(doc as unknown as ImageDoc));
  }

  async deleteImage(transactionId: string, imageId: string) {
    assertObjectId(imageId, "الصورة");
    const db = await getMongoDb();

    const filter = byIdAndTransaction(imageId, transactionId);
    logger.debug(`deleteImage filter: ${JSON.stringify(filter)}`);

    const doc = await db.collection(IMAGES_COLLECTION).findOneAndDelete(filter);
    if (!doc) throw new NotFoundException({ message: "الصورة غير موجودة" });

    await safeUnlink((doc as any).filePath);

    const txFilter = transactionIdFilter(transactionId);
    const remaining = await db
      .collection(IMAGES_COLLECTION)
      .find(txFilter)
      .sort({ sortIndex: 1 })
      .toArray();

    if (remaining.length) {
      const reorderOps = remaining.map((img, i) => ({
        updateOne: {
          filter: { _id: img._id } as Filter<Document>,
          update: { $set: { sortIndex: i + 1 } },
        },
      }));
      await db.collection(IMAGES_COLLECTION).bulkWrite(reorderOps);
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

    const txFilter = transactionIdFilter(transactionId);
    const filter = { _id: { $in: objectIds }, ...txFilter } as Filter<Document>;
    logger.debug(`bulkDeleteImages filter: ${JSON.stringify(filter)}`);

    const docs = await db.collection(IMAGES_COLLECTION).find(filter).toArray();
    logger.debug(`bulkDeleteImages: found ${docs.length} of ${ids.length}`);

    if (!docs.length)
      throw new NotFoundException({ message: "لم يتم العثور على صور" });

    await db.collection(IMAGES_COLLECTION).deleteMany(filter);
    await Promise.all(docs.map((d) => safeUnlink((d as any).filePath)));

    const remaining = await db
      .collection(IMAGES_COLLECTION)
      .find(txFilter)
      .sort({ sortIndex: 1 })
      .toArray();

    if (remaining.length) {
      const reorderOps = remaining.map((img, i) => ({
        updateOne: {
          filter: { _id: img._id } as Filter<Document>,
          update: { $set: { sortIndex: i + 1 } },
        },
      }));
      await db.collection(IMAGES_COLLECTION).bulkWrite(reorderOps);
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
