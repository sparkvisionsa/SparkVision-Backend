import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { createHash } from "node:crypto";
import { getRequestIp, resolveRequestContext } from "@/server/auth-tracking/context";
import { authTrackingConfig } from "@/server/auth-tracking/config";
import { assertCsrf } from "@/server/auth-tracking/service";
import { GUEST_OWNER_LABEL, type HelperActor } from "./helper-tools.types";

export type HelperToolsRequest = Request & { helperActor: HelperActor };

@Injectable()
export class HelperToolsAuthGuard implements CanActivate {
  private readonly recentActors = new Map<string, { actor: HelperActor; expiresAt: number }>();

  async canActivate(execution: ExecutionContext) {
    const req = execution.switchToHttp().getRequest<HelperToolsRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertCsrf(req);
    const identity = req.cookies?.[authTrackingConfig.identityCookieName];
    const session = req.cookies?.[authTrackingConfig.sessionCookieName];
    const cacheKey = req.method === "GET" && typeof identity === "string" && typeof session === "string"
      ? createHash("sha256").update(`${identity}:${session}:${getRequestIp(req)}:${req.headers["user-agent"] ?? ""}`).digest("hex")
      : "";
    const cached = cacheKey ? this.recentActors.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      req.helperActor = cached.actor;
      return true;
    }
    const context = await resolveRequestContext(req);
    if (context.isIdentityBlocked || context.isUserBlocked) {
      throw new ForbiddenException("الحساب موقوف");
    }
    if (!context.session?._id || !context.session.isActive) {
      throw new UnauthorizedException("انتهت الجلسة. حدّث الصفحة ثم أعد المحاولة.");
    }
    const user = context.user;
    req.helperActor = user
      ? {
          kind: "user",
          userId: String(user._id),
          companyId: context.company ? String(context.company._id) : null,
          sessionId: context.session._id,
          displayName: user.username || "مستخدم",
          identityId: context.identityId,
        }
      : {
          kind: "guest",
          userId: null,
          companyId: null,
          sessionId: context.session._id,
          displayName: GUEST_OWNER_LABEL,
          identityId: context.identityId,
        };
    if (cacheKey) {
      this.recentActors.set(cacheKey, { actor: req.helperActor, expiresAt: Date.now() + 120_000 });
      if (this.recentActors.size > 1000) this.recentActors.delete(this.recentActors.keys().next().value!);
    }
    return true;
  }
}
