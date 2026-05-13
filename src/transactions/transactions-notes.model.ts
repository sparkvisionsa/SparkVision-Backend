import { ObjectId } from "mongodb";

export const NOTES_COLLECTION = "transaction_notes";

export type NoteDoc = {
  _id: ObjectId;
  transactionId: string;
  authorId: string; // user id (from session/auth)
  authorName: string; // display name snapshot
  authorRole: string; // role snapshot
  authorColor: string; // avatar color snapshot
  content: string;
  isPinned: boolean;
  replyToId: string | null; // _id of parent note, or null
  replyToContent: string | null; // snapshot of parent content for display
  replyToAuthorName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toNoteJson(d: NoteDoc) {
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
