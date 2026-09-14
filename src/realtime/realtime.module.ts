import { Global, Module } from "@nestjs/common";
import { SupportAuthService, SupportAuthGuard } from "../support/support-auth.service";
import { RealtimeService } from "./realtime.service";

@Global()
@Module({ providers: [SupportAuthService, SupportAuthGuard, RealtimeService], exports: [SupportAuthService, SupportAuthGuard, RealtimeService] })
export class RealtimeModule {}
