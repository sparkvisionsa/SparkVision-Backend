import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { getMongoDb } from "../server/mongodb";
import type { RequestContext } from "../server/auth-tracking/context";
import { authTrackingConfig } from "../server/auth-tracking/config";
import { verifyToken } from "../server/auth-tracking/crypto";
import { getAuthCollections } from "../server/auth-tracking/collections";
import { assertCsrf } from "../server/auth-tracking/service";
import type { SupportActor } from "./support.types";

export type SupportRequest = Request & { supportActor: SupportActor };
@Injectable()
export class SupportAuthService {
  async fromContext(context: RequestContext): Promise<SupportActor> {
    if (!context.user) throw new UnauthorizedException("سجّل الدخول للمتابعة");
    if (context.isIdentityBlocked || context.isUserBlocked) throw new ForbiddenException("الحساب موقوف");
    const user = context.user;
    const superAdmin = user.role === "super_admin";
    const db = await getMongoDb();
    const staff = superAdmin || Boolean(await db.collection("support_agents").findOne({ userId: String(user._id), enabled: true }));
    return {
      userId: String(user._id), companyId: context.company ? String(context.company._id) : null,
      companyName: context.company?.name ?? "", name: user.username,
      phone: user.phone ?? context.profile?.phone ?? user.username, staff, superAdmin, sessionId: context.sessionId,
    };
  }
  async resolve(req: Request): Promise<SupportActor> {
    const cookies: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? "").split(";")) {
      const index = part.indexOf("=");
      if (index < 0) continue;
      try { cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1)); } catch { /* invalid cookie */ }
    }
    const identity = verifyToken<{ id: string }>(cookies[authTrackingConfig.identityCookieName]);
    const token = verifyToken<{ sid: string; id: string }>(cookies[authTrackingConfig.sessionCookieName]);
    if (!identity?.id || !token?.sid || token.id !== identity.id) throw new UnauthorizedException("سجّل الدخول للمتابعة");
    const db = await getMongoDb();
    const collections = getAuthCollections(db);
    // Read the authoritative session, never revive a signed-out cached session.
    const session = await collections.sessions.findOne({ _id: token.sid, identityId: identity.id, isActive: true, endTime: null });
    if (!session?.userId || Date.now() - new Date(session.lastSeenAt).getTime() > 24 * 3600_000) throw new UnauthorizedException("انتهت الجلسة؛ سجّل الدخول مجدداً");
    const [user, blocked, memberships] = await Promise.all([
      collections.users.findOne({ _id: session.userId }),
      collections.blockedEntities.findOne({ entityType: "identity", entityId: identity.id }),
      collections.userCompanyMemberships.find({ userId: session.userId }).toArray(),
    ]);
    if (!user) throw new UnauthorizedException("سجّل الدخول للمتابعة");
    if (user.isBlocked || blocked) throw new ForbiddenException("الحساب موقوف");
    const superAdmin = user.role === "super_admin";
    const activeId = superAdmin ? session.activeCompanyId : memberships.find(m => String(m.companyId) === String(session.activeCompanyId))?.companyId ?? memberships[0]?.companyId;
    const company = activeId ? await collections.companies.findOne({ _id: activeId }) : null;
    const staff = superAdmin || Boolean(await db.collection("support_agents").findOne({ userId: String(user._id), enabled: true }));
    return { userId: String(user._id), companyId: company ? String(company._id) : null, companyName: company?.name ?? "", name: user.username, phone: user.phone ?? user.username, staff, superAdmin, sessionId: session._id };
  }
}

@Injectable()
export class SupportAuthGuard implements CanActivate {
  constructor(private readonly auth: SupportAuthService) {}
  async canActivate(execution: ExecutionContext) {
    const req = execution.switchToHttp().getRequest<SupportRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertCsrf(req);
    req.supportActor = await this.auth.resolve(req);
    return true;
  }
}
