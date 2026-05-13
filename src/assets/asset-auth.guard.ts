import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { ObjectId } from "mongodb";
import { ensureAuthTrackingInitialized } from "@/server/auth-tracking/collections";
import { resolveRequestContext, type RequestContext } from "@/server/auth-tracking/context";
import type { UserMongoDoc } from "@/server/auth-tracking/types";

export interface AssetAuthenticatedRequest extends Request {
  assetAuthContext?: RequestContext;
  assetUser?: UserMongoDoc;
  /** الشركة النشطة في الجلسة — نفس `companies._id`؛ للوصول لمشاريع MV حسب الشركة. */
  assetActiveCompanyId?: ObjectId | null;
}

@Injectable()
export class AssetJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    await ensureAuthTrackingInitialized();

    const request = context.switchToHttp().getRequest<AssetAuthenticatedRequest>();
    const authContext = await resolveRequestContext(request);

    if (!authContext.user) {
      throw new UnauthorizedException("تسجيل الدخول مطلوب للوصول إلى الأصول.");
    }
    if (authContext.isIdentityBlocked || authContext.isUserBlocked || authContext.user.isBlocked) {
      throw new ForbiddenException("تم حظر الوصول إلى هذا الحساب.");
    }

    request.assetAuthContext = authContext;
    request.assetUser = authContext.user;
    request.assetActiveCompanyId = authContext.company?._id ?? null;
    return true;
  }
}
