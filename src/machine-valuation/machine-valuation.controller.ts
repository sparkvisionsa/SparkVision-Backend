import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MachineValuationService } from "./machine-valuation.service";
import { FileParserService } from "./file-parser.service";
import { decodeUploadFilename } from "./sheet-rows.util";

@Controller("mv")
export class MachineValuationController {
  constructor(
    private readonly mvService: MachineValuationService,
    private readonly fileParser: FileParserService,
  ) {}

  /* ───────── Projects ───────── */

  @Get("projects")
  listProjects() {
    return this.mvService.listProjects();
  }

  @Post("projects")
  createProject(@Body() body: { name?: string }) {
    return this.mvService.createProject(body.name ?? "");
  }

  @Get("projects/:id")
  getProject(@Param("id") id: string) {
    return this.mvService.getProject(id);
  }

  @Delete("projects/:id")
  deleteProject(@Param("id") id: string) {
    return this.mvService.deleteProject(id);
  }

  /* ───────── Sub-Projects ───────── */

  @Post("projects/:id/subprojects")
  createSubProject(
    @Param("id") projectId: string,
    @Body() body: { name?: string },
  ) {
    return this.mvService.createSubProject(projectId, body.name ?? "");
  }

  @Get("projects/:pid/subprojects/:sid")
  getSubProject(
    @Param("pid") pid: string,
    @Param("sid") sid: string,
  ) {
    return this.mvService.getSubProject(pid, sid);
  }

  @Delete("projects/:pid/subprojects/:sid")
  deleteSubProject(
    @Param("pid") pid: string,
    @Param("sid") sid: string,
  ) {
    return this.mvService.deleteSubProject(pid, sid);
  }

  /* ───────── File Upload ───────── */

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body("projectId") projectId?: string,
    @Body("subProjectId") subProjectId?: string,
    @Body("persist") persist?: string,
    @Body("sourceFileNameUtf8") sourceFileNameUtf8?: string,
  ) {
    if (!file) {
      return {
        sheets: [],
        sourceFileName: "",
        persisted: false,
        savedSheets: [] as unknown[],
        saveErrors: [] as string[],
      };
    }
    const fileName =
      sourceFileNameUtf8 && sourceFileNameUtf8.trim().length > 0
        ? sourceFileNameUtf8.trim()
        : decodeUploadFilename(file.originalname || "");
    const parsed = await this.fileParser.parse(
      file.buffer,
      fileName,
      file.mimetype,
    );
    const wantPersist =
      (persist === "1" || persist === "true") &&
      !!projectId &&
      projectId.trim().length > 0;

    if (wantPersist) {
      const saved: Awaited<ReturnType<MachineValuationService["createSheet"]>>[] =
        [];
      const saveErrors: string[] = [];
      for (const sheet of parsed.sheets) {
        try {
          const created = await this.mvService.createSheet({
            projectId: projectId!.trim(),
            subProjectId: subProjectId?.trim() || undefined,
            name: sheet.name,
            headers: sheet.headers,
            rows: sheet.rows,
            sourceType: "file-import",
            sourceFileName: parsed.sourceFileName,
          });
          saved.push(created);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          saveErrors.push(`${sheet.name}: ${msg}`);
        }
      }
      return {
        persisted: true,
        savedSheets: saved,
        saveErrors,
        sourceFileName: parsed.sourceFileName,
        sheetCount: parsed.sheets.length,
      };
    }

    return { ...parsed, persisted: false, saveErrors: [] as string[] };
  }

  /* ───────── Sheets ───────── */

  @Get("sheets")
  listSheets(
    @Query("projectId") projectId: string,
    @Query("subProjectId") subProjectId?: string,
  ) {
    return this.mvService.listSheets(projectId, subProjectId || undefined);
  }

  @Get("sheets/:id")
  getSheet(@Param("id") id: string) {
    return this.mvService.getSheet(id);
  }

  @Post("sheets")
  createSheet(
    @Body()
    body: {
      projectId: string;
      subProjectId?: string;
      name: string;
      headers: string[];
      rows: Record<string, string | number | null>[];
      sourceType: "file-import" | "manual";
      sourceFileName?: string;
    },
  ) {
    return this.mvService.createSheet(body);
  }

  @Put("sheets/:id")
  updateSheet(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      headers?: string[];
      rows?: Record<string, string | number | null>[];
    },
  ) {
    return this.mvService.updateSheet(id, body);
  }

  @Delete("sheets")
  deleteAllSheets(
    @Query("projectId") projectId: string,
    @Query("subProjectId") subProjectId?: string,
  ) {
    if (!projectId?.trim()) {
      throw new BadRequestException("projectId is required");
    }
    return this.mvService.deleteAllSheets(
      projectId.trim(),
      subProjectId?.trim() || undefined,
    );
  }

  @Delete("sheets/:id")
  deleteSheet(@Param("id") id: string) {
    return this.mvService.deleteSheet(id);
  }

  /* ───────── Header Options ───────── */

  @Get("header-options")
  listHeaderOptions() {
    return this.mvService.listHeaderOptions();
  }

  @Post("header-options")
  addHeaderOption(@Body() body: { name?: string }) {
    return this.mvService.addHeaderOption(body.name ?? "");
  }
}
