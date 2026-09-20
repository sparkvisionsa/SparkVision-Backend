import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import type { Response } from "express";
import { HelperToolsAuthGuard, type HelperToolsRequest } from "./helper-tools-auth";
import { HelperToolsRecordingsService } from "./helper-tools-recordings.service";

@Controller("helper-tools/recordings")
@UseGuards(HelperToolsAuthGuard)
export class HelperToolsController {
  constructor(private readonly recordings: HelperToolsRecordingsService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() req: HelperToolsRequest, @Query("source") source?: string) {
    return this.recordings.list(req.helperActor, source);
  }

  @Post("uploads")
  beginUpload(@Req() req: HelperToolsRequest, @Body() body: unknown) {
    return this.recordings.beginUpload(req.helperActor, body);
  }

  @SkipThrottle()
  @Patch("uploads/:uploadId")
  appendUpload(@Req() req: HelperToolsRequest, @Param("uploadId") uploadId: string) {
    return this.recordings.appendUpload(req.helperActor, uploadId, req);
  }

  @SkipThrottle()
  @Post("uploads/:uploadId/complete")
  completeUpload(@Req() req: HelperToolsRequest, @Param("uploadId") uploadId: string) {
    return this.recordings.completeUpload(req.helperActor, uploadId);
  }

  @Delete("uploads/:uploadId")
  cancelUpload(@Req() req: HelperToolsRequest, @Param("uploadId") uploadId: string) {
    return this.recordings.cancelUpload(req.helperActor, uploadId);
  }

  @Patch(":id")
  update(@Req() req: HelperToolsRequest, @Param("id") id: string, @Body() body: { description?: string }) {
    return this.recordings.updateDescription(req.helperActor, id, String(body?.description ?? ""));
  }

  @Delete(":id")
  remove(@Req() req: HelperToolsRequest, @Param("id") id: string) {
    return this.recordings.remove(req.helperActor, id);
  }

  @SkipThrottle()
  @Get(":id/file")
  @Header("Cache-Control", "private, no-store")
  file(@Req() req: HelperToolsRequest, @Param("id") id: string, @Res() res: Response) {
    return this.recordings.streamFile(req.helperActor, id, req.headers.range, res);
  }
}
