import { ObjectId } from "mongodb";

// ─── Collections ──────────────────────────────────────────────────────────────

export const ATTACHMENTS_COLLECTION = "transaction_attachments";
export const IMAGES_COLLECTION = "transaction_images";

// ─── Attachment ───────────────────────────────────────────────────────────────

export type AttachmentDoc = {
  _id: ObjectId;
  transactionId: string; // stored as plain string for easy querying
  name: string; // user-editable display name
  originalName: string; // original filename from upload
  mimeType: string;
  filePath: string; // relative path, e.g. "uploads/123-abc.pdf"
  size: number; // bytes
  uploadedAt: Date;
};

export function toAttachmentJson(d: AttachmentDoc) {
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

// ─── Image ────────────────────────────────────────────────────────────────────

export type ImageDoc = {
  _id: ObjectId;
  transactionId: string | ObjectId; // ← either, depending on age of doc
  name: string;
  originalName: string;
  mimeType: string;
  // Old shape
  filePath?: string;
  // New shape
  url?: string;
  publicId?: string;
  mediaType?: "image" | "video";
  thumbnailUrl?: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  size: number;
  sortIndex: number;
  uploadedAt: Date;
  updatedAt?: Date;
};

export function toImageJson(d: ImageDoc) {
  // New Cloudinary-backed docs use `url`; old docs use `filePath`
  const resolvedPath = d.url ?? d.filePath ?? "";

  return {
    id: d._id.toString(),
    transactionId: d.transactionId.toString(),
    name: d.name,
    originalName: d.originalName,
    mimeType: d.mimeType,
    filePath: resolvedPath, // frontend filePreviewUrl() handles https:// already
    size: d.size,
    sortIndex: d.sortIndex,
    uploadedAt: d.uploadedAt.toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveType(mime: string): "pdf" | "image" | "other" {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}
