import type { ObjectId } from "mongodb";
import { z } from "zod";

export const statuses = ["open", "in_progress", "waiting_user", "planned", "resolved", "closed"] as const;
export const products = ["machine-valuation", "real-estate-valuation", "helper-tools", "evaluation-source", "value-tech-app", "asset-inventory", "asset-inspection", "general"] as const;
export const kinds = ["ticket", "bug", "idea"] as const;
export type SupportStatus = typeof statuses[number];
export type SupportActor = { userId: string; companyId: string | null; companyName: string; name: string; phone: string; staff: boolean; superAdmin: boolean; sessionId: string };
export type SupportAttachment = { id: string; name: string; mime: string; size: number };
export interface SupportTicket {
  _id: ObjectId;
  number: string;
  ownerId: string;
  companyId: string | null;
  companyName: string;
  ownerName: string;
  ownerPhone: string;
  subject: string;
  product: typeof products[number];
  kind: typeof kinds[number];
  status: SupportStatus;
  priority: "normal" | "high" | "urgent";
  page: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessage: string;
  lastMessageAt: Date;
  ownerUnread: number;
  staffUnread: number;
  revision: number;
  clientId: string;
  history: { at: Date; by: string; status?: SupportStatus; assigneeName?: string | null }[];
}
export interface SupportMessage {
  _id: ObjectId;
  ticketId: string;
  senderId: string;
  senderName: string;
  staff: boolean;
  text: string;
  attachments: SupportAttachment[];
  createdAt: Date;
  clientId: string;
  event?: { status?: SupportStatus; assigneeName?: string | null };
  readByOwner: boolean;
  readByStaff: boolean;
}
export interface SupportNotification {
  _id: ObjectId;
  recipientId: string;
  ticketId: string;
  channel: "support" | "developer";
  event: "created" | "message" | "status" | "assignment";
  title: string;
  body: string;
  createdAt: Date;
  readAt: Date | null;
}
export const idSchema = z.string().regex(/^[a-f\d]{24}$/i, "معرّف غير صالح. حدّث الصفحة ثم أعد المحاولة");
// User accounts created before the MongoDB migration retain their UUIDs.
export const supportUserIdSchema = z.union([idSchema, z.string().uuid()]);
// حقول تقنية لا يكتبها المستخدم؛ رسالتها تدله على الحل بدل وصف القاعدة.
const CLIENT_ID_HINT = "تعذّر تجهيز الطلب. حدّث الصفحة ثم أعد المحاولة";
export const clientIdSchema = z.string({ required_error: CLIENT_ID_HINT, invalid_type_error: CLIENT_ID_HINT }).min(8, CLIENT_ID_HINT).max(100, CLIENT_ID_HINT).regex(/^[\w-]+$/, CLIENT_ID_HINT);
export const safePage = z.string().max(500).refine(v => v.startsWith("/") && !v.startsWith("//") && !/[\\\r\n]/.test(v), "تعذّر تحديد الصفحة الحالية. حدّث الصفحة ثم أعد المحاولة");
export const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  text: z.string().trim().max(8000).default(""),
  product: z.enum(products).default("general"),
  kind: z.enum(kinds).default("ticket"),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  page: safePage.default("/"),
  clientId: clientIdSchema,
});
export const messageSchema = z.object({
  text: z.string().trim().max(8000).default(""),
  attachments: z.array(idSchema).max(4).default([]),
  clientId: clientIdSchema,
}).refine(v => v.text.length > 0 || v.attachments.length > 0, "اكتب رسالة أو أرفق ملفاً");
export const updateTicketSchema = z.object({
  status: z.enum(statuses).optional(),
  priority: z.enum(["normal", "high", "urgent"]).optional(),
  assigneeId: supportUserIdSchema.nullable().optional(),
  // Some native form controls serialise their value as a string. Coercion
  // keeps an otherwise valid assignment from being rejected by Zod.
  revision: z.coerce.number().int().nonnegative().default(0),
}).refine(value => value.status !== undefined || value.priority !== undefined || value.assigneeId !== undefined, "اختر تحديثاً واحداً على الأقل");
export const notificationReadSchema = z.object({
  ids: z.array(idSchema).max(100).optional(),
});

export function ticketScope(actor: SupportActor) {
  return actor.staff ? {} : { ownerId: actor.userId, companyId: actor.companyId };
}
export function canAccessTicket(actor: SupportActor, ticket: Pick<SupportTicket, "ownerId" | "companyId">) {
  return actor.staff || (ticket.ownerId === actor.userId && ticket.companyId === actor.companyId);
}
export function canChangeStatus(actor: SupportActor, current: SupportStatus, next: SupportStatus) {
  if (actor.staff) return true;
  return next === current || next === "closed" || ((current === "resolved" || current === "closed") && next === "open");
}
