import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, HttpException } from "@nestjs/common";
import { ObjectId, type Db, type Filter } from "mongodb";
import { z } from "zod";
import { getMongoDb } from "../server/mongodb";
import { getAuthCollections } from "../server/auth-tracking/collections";
import { RealtimeService } from "../realtime/realtime.service";
import { canChangeStatus, createTicketSchema, idSchema, messageSchema, notificationReadSchema, ticketScope, updateTicketSchema, type SupportActor, type SupportAttachment, type SupportMessage, type SupportNotification, type SupportTicket } from "./support.types";

export interface SupportFile {
  _id: ObjectId; ticketId: string; uploaderId: string; fileId: ObjectId;
  name: string; mime: string; size: number; createdAt: Date; attached: boolean;
}
@Injectable()
export class SupportService {
  private indexes?: Promise<void>;
  constructor(private readonly realtime: RealtimeService) {}
  async db(): Promise<Db> {
    const db = await getMongoDb();
    if (!this.indexes) this.indexes = Promise.all([
      db.collection("support_tickets").createIndex({ ownerId: 1, companyId: 1, updatedAt: -1 }),
      db.collection("support_tickets").createIndex({ status: 1, updatedAt: -1 }),
      db.collection("support_tickets").createIndex({ number: 1 }, { unique: true }),
      db.collection("support_tickets").createIndex({ ownerId: 1, clientId: 1 }, { unique: true }),
      db.collection("support_messages").createIndex({ ticketId: 1, _id: -1 }),
      db.collection("support_messages").createIndex({ ticketId: 1, senderId: 1, clientId: 1 }, { unique: true }),
      db.collection("support_messages").createIndex({ ticketId: 1, staff: 1, readByOwner: 1, readByStaff: 1 }),
      db.collection("support_messages").createIndex({ staff: 1, readByOwner: 1, readByStaff: 1, ticketId: 1 }),
      db.collection("support_agents").createIndex({ userId: 1 }, { unique: true }),
      db.collection("support_files").createIndex({ ticketId: 1, uploaderId: 1 }),
      db.collection("support_notifications").createIndex({ recipientId: 1, readAt: 1, createdAt: -1 }),
      db.collection("support_limits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]).then(() => undefined).catch(error => { this.indexes = undefined; throw error; });
    await this.indexes;
    return db;
  }
  async limit(actor: SupportActor, action: string, limit: number, windowMs = 60_000) {
    const db = await this.db();
    const bucket = Math.floor(Date.now() / windowMs);
    const state = await db.collection<{ _id: string; count: number; expiresAt: Date }>("support_limits").findOneAndUpdate(
      { _id: `${actor.userId}:${action}:${bucket}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * windowMs) } },
      { upsert: true, returnDocument: "after" },
    );
    if ((state?.count ?? 0) > limit) throw new HttpException("طلبات كثيرة؛ حاول بعد قليل", 429);
  }
  async ticket(actor: SupportActor, id: string) {
    const db = await this.db();
    const ticket = await db.collection<SupportTicket>("support_tickets").findOne({ _id: new ObjectId(idSchema.parse(id)), ...ticketScope(actor) });
    if (!ticket) throw new NotFoundException("التذكرة غير موجودة أو غير متاحة لحسابك");
    return ticket;
  }
  private unreadFilter(actor: SupportActor, ticketId?: string): Filter<SupportMessage> {
    return { ...(ticketId ? { ticketId } : {}), ...(actor.staff ? { staff: false, readByStaff: false } : { staff: true, readByOwner: false }) };
  }
  private async staffIds(db: Db) {
    const [grants, admins] = await Promise.all([
      db.collection<{ userId: string }>("support_agents").find({ enabled: true }).project({ userId: 1 }).toArray(),
      getAuthCollections(db).users.find({ role: "super_admin", isBlocked: { $ne: true } }).project({ _id: 1 }).toArray(),
    ]);
    return new Set([...grants.map(row => row.userId), ...admins.map(row => String(row._id))]);
  }
  private async notify(db: Db, ticket: SupportTicket, recipients: Iterable<string>, event: SupportNotification["event"], title: string, body: string, exclude?: string) {
    const recipientIds = [...new Set([...recipients].filter(id => id && id !== exclude))];
    if (!recipientIds.length) return;
    const now = new Date();
    await db.collection<SupportNotification>("support_notifications").insertMany(recipientIds.map(recipientId => ({
      _id: new ObjectId(), recipientId, ticketId: String(ticket._id),
      channel: ticket.kind === "ticket" ? "support" : "developer", event, title, body: body.slice(0, 240), createdAt: now, readAt: null,
    })));
    this.realtime.notificationsChanged(recipientIds);
  }
  async list(actor: SupportActor, query: Record<string, unknown>) {
    const { q, status, kind, product, page, mine } = z.object({
      q: z.string().max(120).default(""), status: z.string().max(30).optional(),
      kind: z.string().max(20).optional(), product: z.string().max(40).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1), mine: z.enum(["1", "0"]).optional(),
    }).parse(query);
    const db = await this.db();
    const filter: Filter<SupportTicket> = { ...ticketScope(actor) };
    if (status && status !== "all") filter.status = status as SupportTicket["status"];
    if (kind === "developer") filter.kind = { $in: ["bug", "idea"] };
    else if (kind && kind !== "all") filter.kind = kind as SupportTicket["kind"];
    if (product && product !== "all") filter.product = product as SupportTicket["product"];
    if (mine === "1" && actor.staff) filter.assigneeId = actor.userId;
    if (q.trim()) {
      const expression = { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ subject: expression }, { number: expression }, { companyName: expression }, { ownerPhone: expression }];
    }
    const [rows, total] = await Promise.all([
      db.collection<SupportTicket>("support_tickets").find(filter, { projection: { history: 0 } }).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * 30).limit(30).toArray(),
      db.collection<SupportTicket>("support_tickets").countDocuments(filter),
    ]);
    const unread = await db.collection<SupportMessage>("support_messages").aggregate<{ _id: string; count: number }>([
      { $match: { ...this.unreadFilter(actor), ticketId: { $in: rows.map(row => String(row._id)) } } },
      { $group: { _id: "$ticketId", count: { $sum: 1 } } },
    ]).toArray();
    const counts = new Map(unread.map(row => [row._id, row.count]));
    return { tickets: rows.map(row => ({ ...row, unread: counts.get(String(row._id)) ?? 0 })), total, page, hasMore: page * 30 < total };
  }
  async summary(actor: SupportActor) {
    const db = await this.db();
    const scope = ticketScope(actor);
    const [counts, unread, notificationUnread] = await Promise.all([
      db.collection<SupportTicket>("support_tickets").aggregate<{ _id: string; count: number }>([
        { $match: scope }, { $group: { _id: "$status", count: { $sum: 1 } } },
      ]).toArray(),
      db.collection<SupportMessage>("support_messages").aggregate<{ count: number }>([
        { $match: this.unreadFilter(actor) },
        { $lookup: { from: "support_tickets", let: { id: { $toObjectId: "$ticketId" } }, pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$id"] }, ...scope } }], as: "ticket" } },
        { $match: { "ticket.0": { $exists: true } } }, { $count: "count" },
      ]).toArray(),
      db.collection<SupportNotification>("support_notifications").countDocuments({ recipientId: actor.userId, readAt: null }),
    ]);
    return { staff: actor.staff, superAdmin: actor.superAdmin, online: this.realtime.staffOnline() > 0, unread: unread[0]?.count ?? 0, notificationUnread, counts: Object.fromEntries(counts.map(c => [c._id, c.count])) };
  }
  async create(actor: SupportActor, input: unknown) {
    const body = createTicketSchema.parse(input);
    await this.limit(actor, "create", 12, 3600_000);
    const db = await this.db();
    const _id = new ObjectId();
    const now = new Date();
    const counter = await db.collection<{ _id: string; value: number }>("support_counters").findOneAndUpdate({ _id: "tickets" }, { $inc: { value: 1 } }, { upsert: true, returnDocument: "after" });
    const ticket: SupportTicket = {
      _id, number: `SV-${String(counter!.value).padStart(6, "0")}`, ownerId: actor.userId,
      companyId: actor.companyId, companyName: actor.companyName, ownerName: actor.name, ownerPhone: actor.phone,
      subject: body.subject, product: body.product, kind: body.kind, priority: body.priority, page: body.page.split(/[?#]/)[0],
      status: "open", assigneeId: null, assigneeName: null, createdAt: now, updatedAt: now,
      lastMessage: "", lastMessageAt: now, ownerUnread: 0, staffUnread: 0, revision: 0, clientId: body.clientId,
      history: [{ at: now, by: actor.name, status: "open" }],
    };
    let saved: SupportTicket;
    try { await db.collection<SupportTicket>("support_tickets").insertOne(ticket); saved = ticket; }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await db.collection<SupportTicket>("support_tickets").findOne({ ownerId: actor.userId, clientId: body.clientId, companyId: actor.companyId });
      if (!existing) throw new ConflictException("أعد فتح النموذج وحاول مرة أخرى");
      saved = existing;
    }
    // Retrying after an interrupted request also completes the initial message, without duplication.
    if (body.text) await this.send(actor, String(saved._id), { text: body.text, clientId: `initial-${body.clientId}` });
    this.realtime.ticketChanged(saved, "created", actor.userId);
    return { ticket: await this.ticket(actor, String(saved._id)) };
  }
  async detail(actor: SupportActor, id: string, before?: string) {
    const ticket = await this.ticket(actor, id);
    const db = await this.db();
    const filter: Filter<SupportMessage> = { ticketId: id };
    if (before) filter._id = { $lt: new ObjectId(idSchema.parse(before)) };
    const rows = await db.collection<SupportMessage>("support_messages").find(filter).sort({ _id: -1 }).limit(61).toArray();
    return { ticket, messages: rows.slice(0, 60).reverse(), hasMore: rows.length > 60 };
  }
  async send(actor: SupportActor, id: string, input: unknown) {
    const body = messageSchema.parse(input);
    const ticket = await this.ticket(actor, id);
    const db = await this.db();
    const messages = db.collection<SupportMessage>("support_messages");
    const existing = await messages.findOne({ ticketId: id, senderId: actor.userId, clientId: body.clientId });
    if (existing) return { message: existing };
    if (ticket.status === "closed") throw new ConflictException("أعد فتح التذكرة لإرسال رسالة");
    await this.limit(actor, "message", 45);
    const files = await db.collection<SupportFile>("support_files").find({ _id: { $in: body.attachments.map(v => new ObjectId(v)) }, ticketId: id, uploaderId: actor.userId }).toArray();
    if (files.length !== body.attachments.length) throw new BadRequestException("المرفق غير متاح لهذه التذكرة");
    const attachments: SupportAttachment[] = files.map(f => ({ id: String(f._id), name: f.name, mime: f.mime, size: f.size }));
    const now = new Date();
    const message: SupportMessage = {
      _id: new ObjectId(), ticketId: id, senderId: actor.userId, senderName: actor.name, staff: actor.staff,
      text: body.text, attachments, createdAt: now, clientId: body.clientId,
      readByOwner: !actor.staff, readByStaff: actor.staff,
    };
    try { await messages.insertOne(message); }
    catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      return { message: await messages.findOne({ ticketId: id, senderId: actor.userId, clientId: body.clientId }) };
    }
    if (files.length) await db.collection<SupportFile>("support_files").updateMany({ _id: { $in: files.map(f => f._id) } }, { $set: { attached: true } });
    await db.collection<SupportTicket>("support_tickets").updateOne({ _id: ticket._id, lastMessageAt: { $lte: now } }, {
      $set: { lastMessage: (body.text || "📎 مرفق").slice(0, 160), lastMessageAt: now, updatedAt: now },
    });
    if (!actor.staff) await db.collection<SupportTicket>("support_tickets").updateOne({ _id: ticket._id, status: "waiting_user" }, {
      $set: { status: "in_progress" }, $inc: { revision: 1 }, $push: { history: { $each: [{ at: now, by: actor.name, status: "in_progress" }], $slice: -500 } },
    });
    const recipients = actor.staff ? [ticket.ownerId] : ticket.assigneeId ? [ticket.assigneeId] : await this.staffIds(db);
    const notificationTitle = actor.staff
      ? (ticket.kind === "ticket" ? "رد جديد من الدعم" : "رد جديد في طلب كن مطور")
      : (ticket.kind === "ticket" ? "تذكرة دعم جديدة" : "طلب جديد من كن مطور");
    await this.notify(db, ticket, recipients, "message", notificationTitle, body.text || "مرفق جديد", actor.userId);
    this.realtime.ticketChanged(ticket, "message", actor.userId);
    return { message };
  }
  async read(actor: SupportActor, id: string, input: unknown) {
    const { ids } = z.object({ ids: z.array(idSchema).max(200) }).parse(input);
    const ticket = await this.ticket(actor, id);
    const db = await this.db();
    const result = await db.collection<SupportMessage>("support_messages").updateMany({ ...this.unreadFilter(actor, id), _id: { $in: ids.map(v => new ObjectId(v)) } }, { $set: actor.staff ? { readByStaff: true } : { readByOwner: true } });
    if (result.modifiedCount) this.realtime.ticketChanged(ticket, "read", actor.userId);
    return { ok: true };
  }
  async update(actor: SupportActor, id: string, input: unknown) {
    const body = updateTicketSchema.parse(input);
    const ticket = await this.ticket(actor, id);
    if (body.status && !canChangeStatus(actor, ticket.status, body.status)) throw new ForbiddenException("تغيير هذه الحالة متاح للدعم الفني");
    if (!actor.staff && (body.priority !== undefined || body.assigneeId !== undefined)) throw new ForbiddenException("صلاحية الدعم مطلوبة");
    const db = await this.db();
    const patch: Partial<SupportTicket> = { updatedAt: new Date() };
    if (body.status) patch.status = body.status;
    if (body.priority) patch.priority = body.priority;
    if (body.assigneeId !== undefined) {
      const assignee = body.assigneeId ? (await this.agents()).find(a => a.id === body.assigneeId) : null;
      if (body.assigneeId && !assignee) throw new BadRequestException("اختر موظف دعم متاحاً");
      patch.assigneeId = assignee?.id ?? null; patch.assigneeName = assignee?.name ?? null;
    }
    const updated = await db.collection<SupportTicket>("support_tickets").findOneAndUpdate({ _id: ticket._id, revision: body.revision }, {
      $set: patch, $inc: { revision: 1 },
      $push: { history: { $each: [{ at: new Date(), by: actor.name, ...(body.status ? { status: body.status } : {}), ...(body.assigneeId !== undefined ? { assigneeName: patch.assigneeName } : {}) }], $slice: -500 } },
    }, { returnDocument: "after" });
    if (!updated) throw new ConflictException("تم تحديث التذكرة؛ حدّثها ثم حاول مجدداً");
    this.realtime.ticketChanged(updated, "updated", actor.userId);
    const recipients = actor.staff
      ? [ticket.ownerId, ...(body.assigneeId !== undefined && updated.assigneeId ? [updated.assigneeId] : [])]
      : (ticket.assigneeId ? [ticket.assigneeId] : await this.staffIds(db));
    const event: SupportNotification["event"] = body.assigneeId !== undefined ? "assignment" : "status";
    const description = body.assigneeId !== undefined
      ? (updated.assigneeName ? `تم إسناد ${updated.number} إلى ${updated.assigneeName}` : `أُلغي إسناد ${updated.number}`)
      : `تغيّرت حالة ${updated.number}`;
    await this.notify(db, updated, recipients, event, updated.kind === "ticket" ? "تحديث تذكرة الدعم" : "تحديث طلب كن مطور", description, actor.userId);
    return { ticket: updated };
  }
  async notifications(actor: SupportActor) {
    const db = await this.db();
    const notifications = await db.collection<SupportNotification>("support_notifications")
      .find({ recipientId: actor.userId }).sort({ createdAt: -1, _id: -1 }).limit(40).toArray();
    return { notifications };
  }
  async readNotifications(actor: SupportActor, input: unknown) {
    const { ids } = notificationReadSchema.parse(input);
    const db = await this.db();
    const filter: Filter<SupportNotification> = { recipientId: actor.userId, readAt: null };
    if (ids?.length) filter._id = { $in: ids.map(id => new ObjectId(id)) };
    await db.collection<SupportNotification>("support_notifications").updateMany(filter, { $set: { readAt: new Date() } });
    this.realtime.notificationsChanged([actor.userId]);
    return { ok: true };
  }
  async agents() {
    const db = await this.db();
    const granted = await db.collection("support_agents").find({ enabled: true }).limit(200).toArray();
    const users = await getAuthCollections(db).users.find({ isBlocked: { $ne: true }, $or: [{ role: "super_admin" }, { _id: { $in: granted.map(g => new ObjectId(g.userId)) } }] }, { projection: { username: 1, phone: 1, role: 1 } }).limit(200).toArray();
    return users.map(u => ({ id: String(u._id), name: u.username, phone: u.phone, superAdmin: u.role === "super_admin" }));
  }
  async setAgent(actor: SupportActor, input: unknown) {
    if (!actor.superAdmin) throw new ForbiddenException("صلاحية مالك النظام مطلوبة");
    const body = z.object({ phone: z.string().trim().min(3).max(60), enabled: z.boolean() }).parse(input);
    const db = await this.db();
    const user = await getAuthCollections(db).users.findOne({ $or: [{ phone: body.phone }, { username: body.phone }] });
    if (!user) throw new NotFoundException("لا يوجد مستخدم بهذا الرقم أو اسم المستخدم");
    if (user.role === "super_admin") throw new BadRequestException("مالك النظام يملك صلاحية الدعم دائماً");
    await db.collection("support_agents").updateOne({ userId: String(user._id) }, { $set: { enabled: body.enabled, updatedAt: new Date(), updatedBy: actor.userId } }, { upsert: true });
    this.realtime.disconnectUser(String(user._id));
    return { agents: await this.agents() };
  }
}
