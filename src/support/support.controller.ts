import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, Injectable, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException, Header } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { SupportAuthGuard, type SupportRequest } from "./support-auth.service";
import { SupportService } from "./support.service";
import { SupportFilesService, SUPPORT_MAX_FILE_BYTES, SUPPORT_TEMP_DIR } from "./support-files.service";
import { SupportAssistantService } from "./support-assistant.service";
import { ForbiddenException } from "@nestjs/common";

@Injectable()
export class SupportUploadGuard implements CanActivate {
  constructor(private readonly support: SupportService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<SupportRequest>();
    const ticket = await this.support.ticket(req.supportActor, String(req.params.id));
    if (ticket.status === "closed") throw new BadRequestException("أعد فتح التذكرة لإرفاق ملف");
    await this.support.limit(req.supportActor, "upload", 12, 3600_000);
    return true;
  }
}
@Controller("support")
@UseGuards(SupportAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService, private readonly files: SupportFilesService, private readonly assistant: SupportAssistantService) {}
  @Get("summary")
  @Header("Cache-Control", "private, no-store")
  summary(@Req() req: SupportRequest) { return this.support.summary(req.supportActor); }
  @Get("notifications")
  @Header("Cache-Control", "private, no-store")
  notifications(@Req() req: SupportRequest) { return this.support.notifications(req.supportActor); }
  @Post("notifications/read")
  readNotifications(@Req() req: SupportRequest, @Body() body: unknown) { return this.support.readNotifications(req.supportActor, body); }
  @Get("tickets")
  @Header("Cache-Control", "private, no-store")
  list(@Req() req: SupportRequest, @Query() query: Record<string, unknown>) { return this.support.list(req.supportActor, query); }
  @Post("tickets")
  create(@Req() req: SupportRequest, @Body() body: unknown) { return this.support.create(req.supportActor, body); }
  @Get("tickets/:id")
  @Header("Cache-Control", "private, no-store")
  detail(@Req() req: SupportRequest, @Param("id") id: string, @Query("before") before?: string) { return this.support.detail(req.supportActor, id, before); }
  @Patch("tickets/:id")
  update(@Req() req: SupportRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.update(req.supportActor, id, body); }
  @Post("tickets/:id/messages")
  send(@Req() req: SupportRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.send(req.supportActor, id, body); }
  @Post("tickets/:id/read")
  read(@Req() req: SupportRequest, @Param("id") id: string, @Body() body: unknown) { return this.support.read(req.supportActor, id, body); }
  @Post("tickets/:id/files")
  @UseGuards(SupportUploadGuard)
  @UseInterceptors(FileInterceptor("file", {
    storage: diskStorage({ destination: (_req, _file, cb) => { try { mkdirSync(SUPPORT_TEMP_DIR, { recursive: true }); cb(null, SUPPORT_TEMP_DIR); } catch (error) { cb(error as Error, ""); } }, filename: (_req, _file, cb) => cb(null, `${randomUUID()}.tmp`) }),
    // `parts` is intentionally omitted: busboy counts the multipart closing
    // boundary differently across clients. The file and field limits still
    // allow exactly one uploaded file and no form fields.
    limits: { fileSize: SUPPORT_MAX_FILE_BYTES, files: 1, fields: 0 },
  }))
  upload(@Req() req: SupportRequest, @Param("id") id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("اختر ملفاً");
    return this.files.upload(req.supportActor, id, file);
  }
  @Post("tickets/:id/files/uploads")
  @UseGuards(SupportUploadGuard)
  beginUpload(@Req() req: SupportRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.files.beginUpload(req.supportActor, id, body);
  }
  @Patch("tickets/:id/files/uploads/:uploadId")
  appendUpload(@Req() req: SupportRequest, @Param("id") id: string, @Param("uploadId") uploadId: string) {
    return this.files.appendUpload(req.supportActor, id, uploadId, req);
  }
  @Post("tickets/:id/files/uploads/:uploadId/complete")
  completeUpload(@Req() req: SupportRequest, @Param("id") id: string, @Param("uploadId") uploadId: string) {
    return this.files.completeUpload(req.supportActor, id, uploadId);
  }
  @Delete("tickets/:id/files/uploads/:uploadId")
  cancelUpload(@Req() req: SupportRequest, @Param("id") id: string, @Param("uploadId") uploadId: string) {
    return this.files.cancelUpload(req.supportActor, id, uploadId);
  }
  @Get("files/:id")
  download(@Req() req: SupportRequest, @Param("id") id: string, @Res() res: Response) { return this.files.download(req.supportActor, id, req.headers.range, res); }
  @Delete("files/:id")
  discard(@Req() req: SupportRequest, @Param("id") id: string) { return this.files.discard(req.supportActor, id); }
  @Post("assistant")
  answer(@Req() req: SupportRequest, @Body() body: unknown) { return this.assistant.answer(req.supportActor, body); }
  @Get("knowledge")
  knowledge() { return { articles: this.assistant.knowledge() }; }
  @Get("agents")
  async agents(@Req() req: SupportRequest) {
    if (!req.supportActor.staff) throw new ForbiddenException("صلاحية الدعم مطلوبة");
    return { agents: await this.support.agents() };
  }
  @Patch("agents")
  setAgent(@Req() req: SupportRequest, @Body() body: unknown) { return this.support.setAgent(req.supportActor, body); }
}
