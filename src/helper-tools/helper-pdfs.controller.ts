import { Controller, Get, Header, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors, Body } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { HelperToolsAuthGuard, type HelperToolsRequest } from "./helper-tools-auth";
import { HELPER_PDF_MAX_BYTES, HelperPdfsService } from "./helper-pdfs.service";

@Controller("helper-tools/pdfs")
@UseGuards(HelperToolsAuthGuard)
export class HelperPdfsController {
  constructor(private readonly pdfs: HelperPdfsService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Req() req: HelperToolsRequest) {
    return this.pdfs.list(req.helperActor);
  }

  @Post()
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: HELPER_PDF_MAX_BYTES, files: 1 },
  }))
  save(@Req() req: HelperToolsRequest, @UploadedFile() file: Express.Multer.File, @Body() body: Record<string, unknown>) {
    return this.pdfs.save(req.helperActor, file, body);
  }

  @Get(":id/file")
  @Header("Cache-Control", "private, no-store")
  async file(@Req() req: HelperToolsRequest, @Param("id") id: string, @Res() res: Response) {
    const saved = await this.pdfs.file(req.helperActor, id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", saved.size);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(saved.name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(saved.stream, res);
  }
}
