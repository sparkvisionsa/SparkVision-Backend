import { Module } from "@nestjs/common";
import { HelperToolsAuthGuard } from "./helper-tools-auth";
import { HelperToolsController } from "./helper-tools.controller";
import { HelperToolsRecordingsService } from "./helper-tools-recordings.service";

@Module({
  controllers: [HelperToolsController],
  providers: [HelperToolsRecordingsService, HelperToolsAuthGuard],
})
export class HelperToolsModule {}
