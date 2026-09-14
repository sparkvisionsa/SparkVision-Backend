import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from "@nestjs/common";
import { tap } from "rxjs";
import type { Request } from "express";
import { resolveRequestContext } from "../server/auth-tracking/context";
import { RealtimeService } from "./realtime.service";

@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RealtimeInterceptor.name);
  constructor(private readonly realtime: RealtimeService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.originalUrl.split("?")[0];
    const resource = /^\/api\/(mv|transactions|organization|clients|assets)(?:\/|$)/.exec(path)?.[1];
    if (!resource || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next.handle();
    return next.handle().pipe(tap(() => {
      // Invalidations carry no records, only a hint to refetch through authorized APIs.
      void resolveRequestContext(req).then(actor => {
        if (!actor.user || actor.isUserBlocked || actor.isIdentityBlocked) return;
        this.realtime.resourceChanged(actor.company ? String(actor.company._id) : null, String(actor.user._id), resource,
          /\/projects\/([a-f\d]{24})(?:\/|$)/i.exec(path)?.[1]);
      }).catch(() => this.logger.warn("Could not publish resource invalidation"));
    }));
  }
}
