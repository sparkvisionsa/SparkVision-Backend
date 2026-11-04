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

  @Post("multipart")
  beginMultipart(@Req() req: HelperToolsRequest, @Body() body: unknown) {
    return this.recordings.beginMultipartUpload(req.helperActor, body);
  }

  @Get("multipart/:uploadId/parts")
  @SkipThrottle()
  parts(@Req() req: HelperToolsRequest, @Param("uploadId") id: string) {
    return this.recordings.multipartParts(req.helperActor, id);
  }

  @Get("multipart/:uploadId/parts/:partNumber/url")
  @SkipThrottle()
  partUrl(@Req() req: HelperToolsRequest, @Param("uploadId") id: string, @Param("partNumber") partNumber: string) {
    return this.recordings.presignMultipartPart(req.helperActor, id, partNumber);
  }

  @Post("multipart/:uploadId/complete")
  completeMultipart(@Req() req: HelperToolsRequest, @Param("uploadId") id: string, @Body() body: unknown) {
    return this.recordings.completeMultipartUpload(req.helperActor, id, body);
  }

  @Delete("multipart/:uploadId")
  cancelMultipart(@Req() req: HelperToolsRequest, @Param("uploadId") id: string) {
    return this.recordings.cancelMultipartUpload(req.helperActor, id);
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
  @Get(":id/manifest.m3u8")
  manifest(@Req() req: HelperToolsRequest, @Param("id") id: string, @Query("variant") variant: string | undefined, @Res() res: Response) {
    return this.recordings.playbackManifest(req.helperActor, id, variant, res);
  }

  @SkipThrottle()
  @Get(":id/hls/:variant/:segment")
  segment(@Req() req: HelperToolsRequest, @Param("id") id: string, @Param("variant") variant: string, @Param("segment") segment: string, @Res() res: Response) {
    return this.recordings.playbackSegment(req.helperActor, id, variant, segment, res);
  }

  @SkipThrottle()
  @Get(":id/thumbnail")
  thumbnail(@Req() req: HelperToolsRequest, @Param("id") id: string, @Res() res: Response) {
    return this.recordings.thumbnail(req.helperActor, id, res);
  }

  @Get(":id/download-link")
  @Header("Cache-Control", "private, no-store")
  downloadLink(@Req() req: HelperToolsRequest, @Param("id") id: string, @Query("name") name = "recording.webm") {
    return this.recordings.downloadLink(req.helperActor, id, name);
  }

  @SkipThrottle()
  @Get(":id/file")
  @Header("Cache-Control", "private, no-store")
  file(@Req() req: HelperToolsRequest, @Param("id") id: string, @Query("download") download: string | undefined, @Res() res: Response) {
    return this.recordings.streamFile(req.helperActor, id, req.headers.range, res, download);
  }
}
