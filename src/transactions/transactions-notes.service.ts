import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import {
  NOTES_COLLECTION,
  type NoteDoc,
  toNoteJson,
} from "./transactions-notes.model";
import {
  TRANSACTIONS_COLLECTION,
  type TransactionDoc,
} from "./transactions.model";

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

@Injectable()
export class TransactionsNotesService {
  // ── List ────────────────────────────────────────────────────────────────────

  async listNotes(transactionId: string) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);
    const docs = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .find({ transactionId })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map(toNoteJson);
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async addNote(
    transactionId: string,
    body: {
      authorId: string;
      authorName: string;
      authorRole: string;
      authorColor: string;
      content: string;
      replyToId?: string;
    },
  ) {
    const db = await getMongoDb();
    await assertTransactionExists(db, transactionId);

    const content = body.content?.trim();
    if (!content)
      throw new BadRequestException({ message: "محتوى الملاحظة مطلوب" });

    // Resolve reply-to snapshot if provided
    let replyToId: string | null = null;
    let replyToContent: string | null = null;
    let replyToAuthorName: string | null = null;

    if (body.replyToId) {
      assertObjectId(body.replyToId, "الملاحظة الأصلية");
      const parent = await db.collection<NoteDoc>(NOTES_COLLECTION).findOne({
        _id: new ObjectId(body.replyToId),
        transactionId,
      });
      if (!parent)
        throw new NotFoundException({ message: "الملاحظة الأصلية غير موجودة" });
      replyToId = body.replyToId;
      replyToContent = parent.content;
      replyToAuthorName = parent.authorName;
    }

    const now = new Date();
    const doc: Omit<NoteDoc, "_id"> = {
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
      .collection<Omit<NoteDoc, "_id">>(NOTES_COLLECTION)
      .insertOne(doc);

    const saved = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .findOne({ _id: insertedId });

    if (!saved) throw new NotFoundException();
    return toNoteJson(saved);
  }

  // ── Toggle pin ──────────────────────────────────────────────────────────────

  async togglePin(transactionId: string, noteId: string) {
    assertObjectId(noteId, "الملاحظة");
    const db = await getMongoDb();

    const note = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .findOne({ _id: new ObjectId(noteId), transactionId });
    if (!note) throw new NotFoundException({ message: "الملاحظة غير موجودة" });

    const updated = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(noteId), transactionId },
        {
          $set: {
            isPinned: !note.isPinned,
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

    if (!updated)
      throw new NotFoundException({ message: "الملاحظة غير موجودة" });
    return toNoteJson(updated);
  }

  // ── Edit content ────────────────────────────────────────────────────────────

  async editNote(transactionId: string, noteId: string, content: string) {
    assertObjectId(noteId, "الملاحظة");
    const trimmed = content?.trim();
    if (!trimmed)
      throw new BadRequestException({ message: "محتوى الملاحظة مطلوب" });

    const db = await getMongoDb();
    const updated = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(noteId), transactionId },
        { $set: { content: trimmed, updatedAt: new Date() } },
        { returnDocument: "after" },
      );

    if (!updated)
      throw new NotFoundException({ message: "الملاحظة غير موجودة" });
    return toNoteJson(updated);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async deleteNote(transactionId: string, noteId: string) {
    assertObjectId(noteId, "الملاحظة");
    const db = await getMongoDb();
    const result = await db
      .collection<NoteDoc>(NOTES_COLLECTION)
      .deleteOne({ _id: new ObjectId(noteId), transactionId });
    if (result.deletedCount === 0)
      throw new NotFoundException({ message: "الملاحظة غير موجودة" });
    return { ok: true };
  }
}
