import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { Server as HttpServer } from "node:http";
import type { Request } from "express";
import { Server, Socket } from "socket.io";
import { SupportAuthService } from "../support/support-auth.service";
import { canAccessTicket, idSchema, type SupportActor, type SupportTicket } from "../support/support.types";
import { getMongoDb } from "../server/mongodb";
import { ObjectId } from "mongodb";

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private io?: Server;
  private readonly logger = new Logger(RealtimeService.name);
  constructor(private readonly auth: SupportAuthService) {}

  attach(server: HttpServer) {
    const origins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000").split(",").map(x => x.trim());
    this.io = new Server(server, {
      path: "/api/realtime/socket.io", maxHttpBufferSize: 16_384,
      cors: { origin: origins, credentials: true },
      // Also protect WebSocket handshakes, which do not enforce CORS themselves.
      allowRequest: (req, done) => {
        const origin = req.headers.origin;
        const host = req.headers.host;
        let sameOrigin = false;
        try { sameOrigin = Boolean(origin && new URL(origin).host === host); } catch { /* invalid origin */ }
        done(null, !origin || sameOrigin || origins.includes(origin));
      },
    });
    this.io.use(async (socket, next) => {
      try { socket.data.actor = await this.auth.resolve(socket.request as Request); next(); }
      catch { next(new Error("unauthorized")); }
    });
    this.io.on("connection", socket => {
      const actor = socket.data.actor as SupportActor;
      socket.join(`user:${actor.userId}:${actor.companyId ?? "personal"}`);
      if (actor.companyId) socket.join(`company:${actor.companyId}`);
      if (actor.superAdmin) socket.join("system:admins");
      if (actor.staff) socket.join("support:staff");
      this.publishPresence();
      // Recheck the actual session/role on every subscription and periodically while idle.
      let refreshing = false;
      const timer = setInterval(async () => {
        if (refreshing) return;
        refreshing = true;
        try { await this.refreshActor(socket); } catch { socket.disconnect(true); }
        finally { refreshing = false; }
      }, 30_000);
      timer.unref();
      socket.on("support:watch", async (id: unknown, ack?: (result: object) => void) => {
        if (typeof ack !== "function") return;
        try {
          if (!this.allowEvent(socket)) return ack({ ok: false });
          const ticketId = idSchema.parse(id);
          const current = await this.refreshActor(socket);
          const db = await getMongoDb();
          const ticket = await db.collection<SupportTicket>("support_tickets").findOne({ _id: new ObjectId(ticketId) });
          if (!ticket || !canAccessTicket(current, ticket)) return ack({ ok: false });
          for (const room of socket.rooms) if (room.startsWith("ticket:")) socket.leave(room);
          await socket.join(`ticket:${ticketId}`);
          ack({ ok: true });
        } catch { ack({ ok: false }); }
      });
      socket.on("support:unwatch", () => {
        for (const room of socket.rooms) if (room.startsWith("ticket:")) socket.leave(room);
      });
      socket.on("support:typing", async (payload: unknown) => {
        if (!payload || typeof payload !== "object" || !this.allowEvent(socket)) return;
        const { ticketId, typing } = payload as { ticketId: string; typing: boolean };
        if (!idSchema.safeParse(ticketId).success || !socket.rooms.has(`ticket:${ticketId}`)) return;
        try {
          const current = await this.refreshActor(socket);
          socket.to(`ticket:${ticketId}`).emit("support:typing", { ticketId, typing: Boolean(typing), userId: current.userId, name: current.name });
        } catch { socket.disconnect(true); }
      });
      socket.on("disconnect", () => { clearInterval(timer); this.publishPresence(); });
    });
  }

  private allowEvent(socket: Socket) {
    const now = Date.now();
    if (!socket.data.rate || socket.data.rate.at < now - 10_000) socket.data.rate = { at: now, count: 0 };
    return ++socket.data.rate.count <= 30;
  }

  private async refreshActor(socket: Socket) {
    const previous = socket.data.actor as SupportActor;
    const actor = await this.auth.resolve(socket.request as Request);
    if (actor.userId !== previous.userId || actor.companyId !== previous.companyId || actor.staff !== previous.staff || actor.superAdmin !== previous.superAdmin) {
      socket.disconnect(true);
      throw new Error("session_changed");
    }
    socket.data.actor = actor;
    return actor;
  }

  staffOnline() { return this.io?.sockets.adapter.rooms.get("support:staff")?.size ?? 0; }
  private publishPresence() { this.io?.emit("support:presence", { online: this.staffOnline() > 0 }); }
  ticketChanged(ticket: SupportTicket, reason: string, senderId?: string) {
    this.io?.to([`user:${ticket.ownerId}:${ticket.companyId ?? "personal"}`, "support:staff"])
      .emit("support:changed", { ticketId: String(ticket._id), reason, senderId, at: new Date().toISOString() });
  }
  notificationsChanged(userIds: Iterable<string>) {
    const recipients = new Set(userIds);
    if (!recipients.size) return;
    for (const socket of this.io?.sockets.sockets.values() ?? []) {
      const actor = socket.data.actor as SupportActor | undefined;
      if (actor && recipients.has(actor.userId)) socket.emit("support:notifications", { at: new Date().toISOString() });
    }
  }
  resourceChanged(companyId: string | null, userId: string, resource: string, projectId?: string) {
    const rooms = companyId ? [`company:${companyId}`, "system:admins"] : [`user:${userId}:personal`, "system:admins"];
    this.io?.to(rooms).emit("resource:changed", { resource, projectId, at: new Date().toISOString() });
  }
  disconnectUser(userId: string) {
    for (const socket of this.io?.sockets.sockets.values() ?? []) {
      if ((socket.data.actor as SupportActor)?.userId === userId) socket.disconnect(true);
    }
  }
  disconnectSession(sessionId: string) {
    for (const socket of this.io?.sockets.sockets.values() ?? []) {
      if ((socket.data.actor as SupportActor)?.sessionId === sessionId) socket.disconnect(true);
    }
  }
  onModuleDestroy() { this.io?.close(); }
}
