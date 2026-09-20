import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { resolveRequestContext } from "@/server/auth-tracking/context";
import { assertCsrf } from "@/server/auth-tracking/service";
import { GUEST_OWNER_LABEL, type HelperActor } from "./helper-tools.types";

export type HelperToolsRequest = Request & { helperActor: HelperActor };

@Injectable()
export class HelperToolsAuthGuard implements CanActivate {
  async canActivate(execution: ExecutionContext) {
    const req = execution.switchToHttp().getRequest<HelperToolsRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) assertCsrf(req);
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
    return true;
  }
}
