import { Module } from "@nestjs/common";
import { SupportController, SupportUploadGuard } from "./support.controller";
import { SupportService } from "./support.service";
import { SupportFilesService } from "./support-files.service";
import { SupportAssistantService } from "./support-assistant.service";

@Module({ controllers: [SupportController], providers: [SupportService, SupportFilesService, SupportAssistantService, SupportUploadGuard] })
export class SupportModule {}
