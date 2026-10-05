import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  UnauthorizedException,
} from "@nestjs/common";
import { FileInterceptor, FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Request, Response } from "express";
import { MachineValuationService } from "./machine-valuation.service";
import { FileParserService } from "./file-parser.service";
import { MvRealtimeService, type MvRealtimeEventType } from "./mv-realtime.service";
import { AttachmentUploadService } from "./attachment-upload.service";
import { WordTemplateMergeService } from "./word-template-merge.service";
import { PptxTemplateMergeService } from "./pptx-template-merge.service";
import {
  DATA_EXTRACTION_MAX_FILE_BYTES,
  DATA_EXTRACTION_MAX_FILES,
  DataExtractionService,
} from "./data-extraction.service";
import { DataExtractionHistoryService } from "./data-extraction-history.service";
import {
  ASSET_IMPORT_MAX_FILE_BYTES,
  VALUATION_EXCEL_MAX_FILE_BYTES,
} from "@/assets/asset-import.constants";
import { MV_INSPECTOR_FILE_MAX_BYTES } from "./inspector-files.constants";
import { decodeUploadFilename } from "./sheet-rows.util";
import type { MvAccessContext, MvSpreadsheetMeta, PicAssetPatch } from "./types";
import {
  applyContextCookies,
  resolveRequestContext,
  type RequestContext,
} from "@/server/auth-tracking/context";

function toMvAccess(context: RequestContext): MvAccessContext {
  const u = context.user;
  const cid = context.company?._id;
  const companyId =
    cid != null ? String(cid).trim() || null : null;
  return {
    userId: u?._id?.toString() ?? null,
    companyId,
    isSuperAdmin: u?.role === "super_admin",
    userRole: u?.role ?? null,
  };
}

function bodyStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim());
  if (typeof value === "string") return [value.trim()];
  return [];
}

function extractionTargets(value: unknown): { labels: string[]; dateLabels: string[] } {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return { labels: [], dateLabels: [] };
    const labels: string[] = [];
    const dateLabels: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const label = (
        typeof item === "string"
          ? item
          : item && typeof item === "object" && !Array.isArray(item)
            ? String((item as { label?: unknown }).label ?? "")
            : ""
      )
        .trim()
        .slice(0, 180);
      if (!label || seen.has(label)) continue;
      seen.add(label);
      labels.push(label);
      const type =
        item && typeof item === "object" && !Array.isArray(item)
          ? String((item as { type?: unknown }).type ?? "")
          : "";
      if (type === "date") dateLabels.push(label);
      if (labels.length >= 120) break;
    }
    return { labels, dateLabels };
  } catch {
    return { labels: [], dateLabels: [] };
  }
}

@Controller("mv")
export class MachineValuationController {
  constructor(
    private readonly mvService: MachineValuationService,
    private readonly fileParser: FileParserService,
    private readonly mvRealtime: MvRealtimeService,
    private readonly attachments: AttachmentUploadService,
    private readonly wordTemplateMerge: WordTemplateMergeService,
    private readonly pptxTemplateMerge: PptxTemplateMergeService,
    private readonly dataExtraction: DataExtractionService,
    private readonly extractionHistory: DataExtractionHistoryService,
  ) {}

  private publishRealtime(projectId: string, type: MvRealtimeEventType, reason: string) {
    this.mvRealtime.publish(projectId, type, reason);
  }

  @Post("data-extraction")
  @UseInterceptors(
    FilesInterceptor("files", DATA_EXTRACTION_MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: DATA_EXTRACTION_MAX_FILE_BYTES },
    }),
  )
  async extractDocumentData(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: { targetFields?: unknown },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    if (!context.user) {
      throw new UnauthorizedException("يجب تسجيل الدخول لاستخدام استخراج البيانات.");
    }
    const targets = extractionTargets(body?.targetFields);
    const result = await this.dataExtraction.extract(files ?? [], {
      targetFieldLabels: targets.labels,
      targetDateLabels: targets.dateLabels,
    });
    const documents = await this.extractionHistory.save(files ?? [], result.documents, toMvAccess(context));
    return { ...result, documents };
  }

  @Get("data-extraction/history")
  async listExtractionHistory(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Query("cursor") cursor?: string) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    res.setHeader("Cache-Control", "private, no-store");
    return this.extractionHistory.list(toMvAccess(context), cursor);
  }

  @Get("data-extraction/history/:id")
  async getExtractionHistory(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id") id: string) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    res.setHeader("Cache-Control", "private, no-store");
    return this.extractionHistory.get(id, toMvAccess(context));
  }

  @Patch("data-extraction/history/:id")
  async updateExtractionHistory(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id") id: string, @Body() body: unknown) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.extractionHistory.update(id, body, toMvAccess(context));
  }

  @Delete("data-extraction/history/:id")
  async deleteExtractionHistory(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id") id: string) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.extractionHistory.remove(id, toMvAccess(context));
  }

  @Get("data-extraction/history/:id/:variant")
  async getExtractionFile(@Req() req: Request, @Res() res: Response, @Param("id") id: string, @Param("variant") variant: string) {
    if (!["file", "thumbnail", "preview"].includes(variant)) throw new BadRequestException("نوع المعاينة غير صالح.");
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const file = await this.extractionHistory.file(id, variant === "file" ? "original" : variant as "thumbnail" | "preview", toMvAccess(context));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    await pipeline(file.stream, res);
  }

  /* ───────── Projects ───────── */

  @Post("projects/:pid/attachment-jobs/:jobId")
  async beginAttachment(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string, @Body() body: any) {
    return this.attachments.begin(pid, jobId, body, toMvAccess(await resolveRequestContext(req)));
  }

  @Post("projects/:pid/attachment-jobs/:jobId/plan")
  async planAttachment(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string, @Body() body: any) {
    return this.attachments.plan(pid, jobId, body, toMvAccess(await resolveRequestContext(req)));
  }

  @Post("projects/:pid/attachment-jobs/:jobId/pages")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES } }))
  async saveAttachmentPage(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string, @UploadedFile() file: Express.Multer.File, @Body("metadata") metadata: string) {
    return this.attachments.page(pid, jobId, metadata, file, toMvAccess(await resolveRequestContext(req)));
  }

  @Post("projects/:pid/attachment-jobs/:jobId/original/:sourceId")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES } }))
  async saveAttachmentOriginal(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string, @Param("sourceId") sourceId: string, @UploadedFile() file: Express.Multer.File) {
    return this.attachments.original(pid, jobId, sourceId, file, toMvAccess(await resolveRequestContext(req)));
  }

  @Post("projects/:pid/attachment-jobs/:jobId/complete")
  async completeAttachment(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string) {
    return this.attachments.complete(pid, jobId, toMvAccess(await resolveRequestContext(req)));
  }

  @Delete("projects/:pid/attachment-jobs/:jobId")
  async cancelAttachment(@Req() req: Request, @Param("pid") pid: string, @Param("jobId") jobId: string) {
    return this.attachments.cancel(pid, jobId, toMvAccess(await resolveRequestContext(req)));
  }

  @Get("projects/:pid/attachment-jobs")
  async pendingAttachments(@Req() req: Request, @Param("pid") pid: string) {
    return this.attachments.pending(pid, toMvAccess(await resolveRequestContext(req)));
  }

  @Get("projects/:pid/attachment-workspaces")
  async attachmentWorkspaces(@Param("pid") pid: string, @Req() req: Request) {
    return this.mvService.getAttachmentWorkspaces(pid, toMvAccess(await resolveRequestContext(req)));
  }

  @Get("projects/:pid/asset-media-revision")
  async assetMediaRevision(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("pid") pid: string) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    res.setHeader("Cache-Control", "private, no-store");
    return this.mvService.getAssetMediaRevision(pid, toMvAccess(context));
  }

  @Get("projects")
  async listProjects(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listProjects(toMvAccess(context));
  }

  @Get("project-workflow-statuses")
  listProjectWorkflowStatuses() {
    return this.mvService.listProjectWorkflowStatuses();
  }

  @Post("projects")
  async createProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body()
    body: {
      name?: string;
      companyId?: string;
      reportType?: string;
      locations?: unknown[];
      contacts?: unknown[];
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.createProject(
      body.name ?? "",
      toMvAccess(context),
      body.companyId,
      body.reportType,
      body.locations,
      body.contacts,
    );
  }

  @Post("projects/:id/duplicate")
  async duplicateProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: { locale?: string },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.duplicateProject(id, toMvAccess(context), body?.locale);
  }

  @Post("projects/:id/clone-report-data")
  async cloneReportData(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: { sourceProjectId?: string },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const sourceProjectId = body?.sourceProjectId?.trim() ?? "";
    if (!sourceProjectId) {
      throw new BadRequestException("sourceProjectId is required");
    }
    return this.mvService.cloneReportDataFromProject(id, sourceProjectId, toMvAccess(context));
  }

  /** قائمة ملفات المعاين (اسم، رابط، نوع) — JSON فقط */
  @Get("projects/:id/inspectorFiles")
  async listInspectorFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listInspectorFiles(id, toMvAccess(context));
  }

  @Get("projects/:id/inspectors")
  async listProjectInspectors(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listProjectInspectors(id, toMvAccess(context));
  }

  @Get("projects/:id/system-inspectors")
  async listSystemInspectors(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listSystemInspectors(id, toMvAccess(context));
  }

  @Post("projects/:id/inspectorFiles")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: MV_INSPECTOR_FILE_MAX_BYTES },
    }),
  )
  async uploadInspectorFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { locationIds?: unknown },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    if (!file?.buffer) {
      throw new BadRequestException("لم يُرفع أي ملف.");
    }
    return this.mvService.uploadInspectorFile(id, file, toMvAccess(context), body?.locationIds);
  }

  @Delete("projects/:id/inspectorFiles/:fileId")
  async deleteInspectorFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.deleteInspectorFile(id, fileId, toMvAccess(context));
  }

  @Patch("projects/:id/inspectorFiles/:fileId")
  async renameInspectorFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Body() body: { name?: string },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.renameInspectorFile(id, fileId, toMvAccess(context), body?.name ?? "");
  }

  @Get("projects/:id/inspectorFiles/:fileId/download")
  async downloadInspectorFile(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("fileId") fileId: string,
    @Query("attachment") attachment: string | undefined,
    @Res() res: Response,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const wantAttachment = attachment === "1" || attachment === "true";
    const rangeRaw = req.headers.range;
    const rangeHeader = Array.isArray(rangeRaw) ? rangeRaw[0] : rangeRaw;
    const payload = await this.mvService.getInspectorFileDownload(
      id,
      fileId,
      toMvAccess(context),
      { attachment: wantAttachment, rangeHeader: rangeHeader ?? undefined },
    );
    if (payload.kind === "redirect") {
      res.redirect(302, payload.url);
      return;
    }
    if (payload.kind === "proxyFetch") {
      const up = await fetch(payload.sourceUrl, {
        redirect: "follow",
        headers: { "User-Agent": "SparkVision-Backend/inspector-download" },
      });
      if (!up.ok || !up.body) {
        throw new BadGatewayException("تعذر جلب الملف من التخزين السحابي للتنزيل.");
      }
      const rawCt = up.headers.get("content-type");
      const ct =
        (rawCt?.split(";")[0] ?? "").trim() || payload.mimeType || "application/octet-stream";
      res.setHeader("Content-Type", ct);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(payload.fileName)}`,
      );
      const len = up.headers.get("content-length");
      if (len && /^\d+$/.test(len.trim())) {
        res.setHeader("Content-Length", len.trim());
      }
      const webBody = up.body as import("stream/web").ReadableStream;
      const readable = Readable.fromWeb(webBody);
      try {
        await pipeline(readable, res);
      } catch {
        if (!res.headersSent) {
          throw new BadGatewayException("تعذر إكمال تنزيل الملف من التخزين السحابي.");
        }
        res.destroy();
      }
      return;
    }
    const cd = wantAttachment ? "attachment" : "inline";
    res.setHeader("Content-Type", payload.mimeType);
    res.setHeader("Content-Disposition", `${cd}; filename*=UTF-8''${encodeURIComponent(payload.fileName)}`);
    res.setHeader("Accept-Ranges", "bytes");
    if (payload.httpStatus === 206 && payload.contentRange) {
      res.status(206);
      res.setHeader("Content-Range", payload.contentRange);
    }
    if (Number.isFinite(payload.contentLength) && payload.contentLength >= 0) {
      res.setHeader("Content-Length", String(payload.contentLength));
    }
    return new Promise<void>((resolve, reject) => {
      payload.stream.on("error", (error) => {
        if (!res.headersSent) res.status(404);
        if (!res.writableEnded) res.end();
        reject(error);
      });
      res.on("finish", resolve);
      payload.stream.pipe(res);
    });
  }

  @Get("projects/:id")
  async getProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    /**
     * ‎report‎: مشروع خفيف لشاشة بيانات التقرير (بدون شجرة مجلدات/مساحات ثقيلة).
     * ‎summary‎: بدون مصفوفات صور/صوت في مجلدات ‎assets‎ (أخف لشجرة المجلدات).
     * غير ذلك: كامل.
     */
    @Query("picAssetMode") picAssetMode?: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const mode =
      picAssetMode === "report"
        ? "report"
        : picAssetMode === "summary"
          ? "summary"
          : "full";
    return this.mvService.getProject(id, toMvAccess(context), { picAssetMode: mode });
  }

  @Get("projects/:id/events")
  async streamProjectEvents(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    await this.mvService.getProject(id, toMvAccess(context), { picAssetMode: "summary" });
    this.mvRealtime.subscribe(id, res);
  }

  @Post("projects/:id/workflow")
  async setProjectWorkflow(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body()
    body: {
      workflowStatus?: string;
      name?: string;
      reportType?: string;
      reportData?: unknown;
      locations?: unknown[];
      contacts?: unknown[];
      inspectionAssignments?: unknown[];
      valuationAccountingWorkspace?: unknown | null;
      valuationReadyExcelWorkspace?: unknown | null;
      clientDocumentsWorkspace?: unknown | null;
      sceCertificateWorkspace?: unknown | null;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.updateProject(id, toMvAccess(context), body ?? {});
  }

  @Patch("projects/:id")
  async patchProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body()
    body: {
      workflowStatus?: string;
      name?: string;
      reportType?: string;
      reportData?: unknown;
      locations?: unknown[];
      contacts?: unknown[];
      inspectionAssignments?: unknown[];
      valuationAccountingWorkspace?: unknown | null;
      valuationReadyExcelWorkspace?: unknown | null;
      clientDocumentsWorkspace?: unknown | null;
      sceCertificateWorkspace?: unknown | null;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.updateProject(id, toMvAccess(context), body ?? {});
  }

  @Delete("projects/:id")
  async deleteProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.deleteProject(id, toMvAccess(context));
  }

  /* ───────── Sub-Projects ───────── */

  @Post("projects/:id/subprojects")
  async createSubProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") projectId: string,
    @Body() body: { name?: string; parent?: string; parentSubProjectId?: string; folderKind?: "folder" | "asset" },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const parentRaw = body.parent?.trim() || body.parentSubProjectId?.trim() || undefined;
    const created = await this.mvService.createSubProject(
      projectId,
      body.name ?? "",
      toMvAccess(context),
      parentRaw,
      { kind: body?.folderKind === "folder" ? "folder" : "asset" },
    );
    this.publishRealtime(projectId, "asset-folders-changed", "subproject:create");
    return created;
  }

  @Delete("projects/:id/subprojects")
  async deleteAllSubProjects(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") projectId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const result = await this.mvService.deleteAllSubProjects(projectId, toMvAccess(context));
    this.publishRealtime(projectId, "asset-folders-changed", "subproject:delete-all");
    this.publishRealtime(projectId, "asset-images-changed", "subproject:delete-all");
    return result;
  }

  @Get("projects/:pid/subproject-details")
  async listSubProjectDetails(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Query("ids") idsRaw?: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const ids = String(idsRaw ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length > 50) throw new BadRequestException("الحد الأقصى للدفعة 50 مجلدًا.");
    if (ids.some((id) => !/^[a-f0-9]{24}$/i.test(id))) {
      throw new BadRequestException("تحتوي الدفعة على معرف مجلد غير صالح.");
    }
    return this.mvService.listSubProjectDetails(projectId, ids, toMvAccess(context));
  }

  @Get("projects/:pid/subprojects/:sid")
  async getSubProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") pid: string,
    @Param("sid") sid: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.getSubProject(pid, sid, toMvAccess(context));
  }

  @Patch("projects/:pid/subprojects/:sid")
  async patchSubProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") pid: string,
    @Param("sid") sid: string,
    @Body()
    body: PicAssetPatch & {
      name?: unknown;
      parent?: unknown;
      parentSubProjectId?: unknown;
      targetParentId?: unknown;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const result = await this.mvService.patchSubProject(pid, sid, toMvAccess(context), body);
    this.publishRealtime(pid, "asset-images-changed", "subproject:patch");
    this.publishRealtime(pid, "asset-folders-changed", "subproject:patch");
    return result;
  }

  @Delete("projects/:pid/subprojects/:sid")
  async deleteSubProject(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") pid: string,
    @Param("sid") sid: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const result = await this.mvService.deleteSubProject(pid, sid, toMvAccess(context));
    this.publishRealtime(pid, "asset-folders-changed", "subproject:delete");
    this.publishRealtime(pid, "asset-images-changed", "subproject:delete");
    return result;
  }

  @Post("projects/:pid/sheets/:sid/generate-inspection-folders")
  async generateInspectionFolders(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") pid: string,
    @Param("sid") sid: string,
    @Body() body: { columnName?: string; columnIndex?: number | string | null },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.generateInspectionFoldersFromSheet(
      pid,
      sid,
      toMvAccess(context),
      body ?? {},
    );
  }

  /** مجلدات صور المعاينة من عمود في شيت استيراد الأصول (بيانات المشروع نفسها). */
  @Post("projects/:pid/asset-import-image-folders")
  async generateAssetImportImageFolders(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") pid: string,
    @Body()
    body: {
      columnKey?: string;
      locationColumnKey?: string;
      clientCodeColumnKey?: string;
      codeColumnKey?: string;
      employerColumnKey?: string;
      importId?: string;
      sheetName?: string;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const result = await this.mvService.generateInspectionFoldersFromAssetImport(pid, toMvAccess(context), {
      columnKey: body?.columnKey ?? "",
      locationColumnKey: body?.locationColumnKey ?? "",
      clientCodeColumnKey: body?.clientCodeColumnKey || body?.codeColumnKey || "",
      employerColumnKey: body?.employerColumnKey ?? "",
      importId: body?.importId ?? "",
      sheetName: body?.sheetName ?? "",
    });
    this.publishRealtime(pid, "asset-folders-changed", "asset-import-image-folders:generate");
    return result;
  }

  /* ───────── File Upload ───────── */

  @Get("projects/:pid/asset-image-files")
  async listProjectAssetImageFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limitRaw?: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const wantsPage = cursor != null || limitRaw != null;
    if (wantsPage) {
      return this.mvService.listProjectAssetImageFiles(projectId, toMvAccess(context), {
        cursor,
        limit: Number(limitRaw),
      });
    }
    return this.mvService.listProjectAssetImageFiles(projectId, toMvAccess(context));
  }

  @Get("projects/:pid/asset-image-files/download")
  async downloadProjectAssetImageFiles(
    @Req() req: Request,
    @Param("pid") projectId: string,
    @Query("downloadId") downloadId: string | undefined,
    @Res() res: Response,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const download = await this.mvService.getProjectAssetImagesZip(
      projectId,
      toMvAccess(context),
      downloadId,
    );
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("X-Asset-Folder-Count", String(download.folderCount));
    res.setHeader("X-Asset-Image-Count", String(download.imageCount));

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        download.stream.removeListener("error", onStreamError);
        res.removeListener("finish", onFinish);
        res.removeListener("close", onResponseClose);
      };
      const onStreamError = (error: Error) => {
        cleanup();
        if (!res.headersSent) {
          res.status(500);
        }
        if (!res.writableEnded) {
          res.end();
        }
        reject(error);
      };
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onResponseClose = () => {
        if (!res.writableEnded) {
          download.stream.destroy(new Error("Asset images download client disconnected"));
        }
      };
      download.stream.once("error", onStreamError);
      res.once("finish", onFinish);
      res.once("close", onResponseClose);
      download.stream.pipe(res);
    });
  }

  @Get("projects/:pid/asset-image-files/download-progress/:downloadId")
  async getProjectAssetImageDownloadProgress(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Param("downloadId") downloadId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    res.setHeader("Cache-Control", "no-store");
    return this.mvService.getAssetImagesDownloadProgress(
      projectId,
      downloadId,
      toMvAccess(context),
    );
  }

  @Post("projects/:pid/asset-image-files")
  @UseInterceptors(
    FilesInterceptor("files", 500, {
      storage: memoryStorage(),
      limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES },
    }),
  )
  async uploadProjectAssetImageFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Query("picAssetFolderId") picAssetFolderIdFromQuery: string | undefined,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const paths = bodyStringArray((req.body as { paths?: unknown })?.paths);
    const rawBodyPid = (req.body as { picAssetFolderId?: unknown })?.picAssetFolderId;
    const fromBody =
      typeof rawBodyPid === "string" ? rawBodyPid.trim() || undefined
      : Array.isArray(rawBodyPid) && typeof rawBodyPid[0] === "string" ? rawBodyPid[0].trim() || undefined
      : undefined;
    const picAssetFolderId =
      (picAssetFolderIdFromQuery && picAssetFolderIdFromQuery.trim()) || fromBody;
    const result = await this.mvService.uploadProjectFiles(
      projectId,
      files ?? [],
      toMvAccess(context),
      picAssetFolderId,
      {
        scope: "asset-images",
        relativePaths: paths,
        uploadKeys: bodyStringArray((req.body as { uploadKeys?: unknown })?.uploadKeys),
        imageOnly: true,
      },
    );
    this.publishRealtime(projectId, "asset-images-changed", "asset-image-files:upload");
    this.publishRealtime(projectId, "asset-folders-changed", "asset-image-files:upload");
    return result;
  }

  private async handleReorderProjectAssetImageFiles(
    req: Request,
    res: Response,
    projectId: string,
    body: { folderPath?: unknown; orderedFileIds?: unknown; picAssetFolderId?: unknown },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const folderPath = typeof body?.folderPath === "string" ? body.folderPath.trim() : "";
    const rawIds = body?.orderedFileIds;
    const orderedFileIds =
      Array.isArray(rawIds) ?
        rawIds.map((item) => String(item ?? "").trim()).filter((id) => id.length > 0)
      : [];
    const result = await this.mvService.reorderProjectAssetImageFiles(
      projectId,
      toMvAccess(context),
      folderPath,
      orderedFileIds,
      body?.picAssetFolderId,
    );
    this.publishRealtime(projectId, "asset-images-changed", "asset-image-files:reorder");
    return result;
  }

  @Patch("projects/:pid/asset-image-files/place")
  async patchProjectAssetImageFilePlace(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Body()
    body: {
      fileId?: unknown;
      targetFolderPath?: unknown;
      insertBeforeFileId?: unknown;
      targetPicAssetFolderId?: unknown;
    },
  ) {
    return this.handlePlaceProjectAssetImageFile(req, res, projectId, body);
  }

  @Post("projects/:pid/asset-image-files/place")
  async postProjectAssetImageFilePlace(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Body()
    body: {
      fileId?: unknown;
      targetFolderPath?: unknown;
      insertBeforeFileId?: unknown;
      targetPicAssetFolderId?: unknown;
    },
  ) {
    return this.handlePlaceProjectAssetImageFile(req, res, projectId, body);
  }

  @Patch("projects/:pid/asset-image-files/reorder")
  async patchProjectAssetImageFilesReorder(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Body() body: { folderPath?: unknown; orderedFileIds?: unknown; picAssetFolderId?: unknown },
  ) {
    return this.handleReorderProjectAssetImageFiles(req, res, projectId, body);
  }

  @Post("projects/:pid/asset-image-files/reorder")
  async postProjectAssetImageFilesReorder(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Body() body: { folderPath?: unknown; orderedFileIds?: unknown; picAssetFolderId?: unknown },
  ) {
    return this.handleReorderProjectAssetImageFiles(req, res, projectId, body);
  }

  @Patch("projects/:pid/asset-image-files/report-selection")
  async patchProjectAssetImageReportSelection(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Body() body: { fileIds?: unknown; includeInReport?: unknown },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const rawIds = body?.fileIds;
    const fileIds =
      Array.isArray(rawIds) ?
        rawIds.map((item) => String(item ?? "").trim()).filter((id) => id.length > 0)
      : [];
    const result = await this.mvService.updateProjectAssetImageReportSelection(
      projectId,
      toMvAccess(context),
      fileIds,
      body?.includeInReport !== false,
    );
    this.publishRealtime(projectId, "asset-images-changed", "asset-image-files:report-selection");
    return result;
  }

  private async handlePlaceProjectAssetImageFile(
    req: Request,
    res: Response,
    projectId: string,
    body: {
      fileId?: unknown;
      targetFolderPath?: unknown;
      insertBeforeFileId?: unknown;
      targetPicAssetFolderId?: unknown;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
    const result = await this.mvService.placeProjectAssetImageFile(
      projectId,
      toMvAccess(context),
      fileId,
      body?.targetFolderPath,
      body?.insertBeforeFileId,
      body?.targetPicAssetFolderId,
    );
    this.publishRealtime(projectId, "asset-images-changed", "asset-image-files:place");
    this.publishRealtime(projectId, "asset-folders-changed", "asset-image-files:place");
    return result;
  }

  @Get("projects/:pid/files")
  async listProjectFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Query("subProjectId") subProjectId?: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listProjectFiles(
      projectId,
      toMvAccess(context),
      subProjectId?.trim() || undefined,
    );
  }

  /** ملفات Excel الخاصة بإجراءات التقييم (مستقلة عن assets). */
  @Get("projects/:pid/valuation-excel-files")
  async listValuationExcelFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listValuationExcelFiles(projectId, toMvAccess(context));
  }

  @Post("projects/:pid/valuation-excel-files")
  @UseInterceptors(
    FilesInterceptor("files", 20, {
      storage: memoryStorage(),
      limits: { fileSize: VALUATION_EXCEL_MAX_FILE_BYTES },
    }),
  )
  async uploadValuationExcelFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.uploadValuationExcelFiles(projectId, files ?? [], toMvAccess(context));
  }

  @Get("projects/:pid/valuation-excel-files/:fid/download")
  async downloadValuationExcelFile(
    @Req() req: Request,
    @Param("pid") projectId: string,
    @Param("fid") fileId: string,
    @Res() res: Response,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const download = await this.mvService.getValuationExcelFileDownload(
      projectId,
      fileId,
      toMvAccess(context),
    );
    res.setHeader("Content-Type", download.file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(download.file.name)}"`,
    );
    return new Promise<void>((resolve, reject) => {
      download.stream.on("error", (error) => {
        if (!res.headersSent) res.status(404);
        if (!res.writableEnded) res.end();
        reject(error);
      });
      res.on("finish", resolve);
      download.stream.pipe(res);
    });
  }

  @Delete("projects/:pid/valuation-excel-files/:fid")
  async deleteValuationExcelFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Param("fid") fileId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.deleteValuationExcelFile(projectId, fileId, toMvAccess(context));
  }

  @Post("projects/:pid/files")
  @UseInterceptors(
    FilesInterceptor("files", 20, {
      storage: memoryStorage(),
      limits: { fileSize: ASSET_IMPORT_MAX_FILE_BYTES },
    }),
  )
  async uploadProjectFiles(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Query("subProjectId") subProjectIdFromQuery: string | undefined,
    @Query("valuationAccounting") valuationAccountingFromQuery: string | undefined,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const raw = (req.body as { subProjectId?: string | string[] })?.subProjectId;
    const fromBody =
      typeof raw === "string"
        ? raw.trim() || undefined
        : Array.isArray(raw) && typeof raw[0] === "string"
          ? raw[0].trim() || undefined
          : undefined;
    const subProjectId =
      (subProjectIdFromQuery && subProjectIdFromQuery.trim()) || fromBody;
    const preferDigitalOcean =
      valuationAccountingFromQuery === "1" ||
      String(valuationAccountingFromQuery || "").toLowerCase() === "true";
    return this.mvService.uploadProjectFiles(
      projectId,
      files ?? [],
      toMvAccess(context),
      subProjectId,
      preferDigitalOcean ? { preferDigitalOcean: true } : {},
    );
  }

  @Post("projects/:pid/word-template/merge")
  async mergeWordTemplate(
    @Req() req: Request,
    @Res() res: Response,
    @Param("pid") projectId: string,
    @Body()
    body: {
      assetImageUrls?: string[];
      valuationImageUrls?: string[];
      clientImageUrls?: string[];
      certificateImageUrls?: string[];
      assetImagesBase64?: string[];
      valuationImagesBase64?: string[];
      clientImagesBase64?: string[];
      certificateImagesBase64?: string[];
      textValues?: Record<string, string>;
      templateId?: string;
      alsoPdf?: boolean;
      /** Return the converted PDF directly instead of first downloading the DOCX. */
      pdfOnly?: boolean;
      useStoredProjectState?: boolean;
      imageLayout?: {
        imagesPerRow?: number;
        imagesPerPage?: number;
        clientImagesPerRow?: number;
        clientImagesPerPage?: number;
        imageQuality?: number;
      };
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    await this.attachments.assertReady(projectId, toMvAccess(context));
    return this.wordTemplateMerge.mergeAndRespond(projectId, toMvAccess(context), body, res);
  }

  /**
   * Server-side PowerPoint merge.  It intentionally reads the saved report
   * fields and the included project asset images instead of trusting a browser
   * cache, just like the saved-state Word export path.
   */
  @Post("projects/:pid/pptx-template/merge")
  async mergePptxTemplate(
    @Req() req: Request,
    @Res() res: Response,
    @Param("pid") projectId: string,
    @Body()
    body: {
      templateId?: string;
      useStoredProjectState?: boolean;
      alsoPdf?: boolean;
      /** Return the converted PDF directly instead of first downloading the PPTX. */
      pdfOnly?: boolean;
      imageLayout?: {
        assetImagesPerRow?: number;
        clientImagesPerRow?: number;
      };
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    await this.attachments.assertReady(projectId, toMvAccess(context));
    return this.pptxTemplateMerge.mergeAndRespond(projectId, toMvAccess(context), body ?? {}, res);
  }

  @Get("projects/:pid/word-template/pdf/:token")
  async downloadMergedWordPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Param("pid") projectId: string,
    @Param("token") token: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    // تأكيد صلاحية الوصول للمشروع قبل تنزيل PDF المؤقت
    await this.mvService.getProject(projectId, toMvAccess(context), { picAssetMode: "report" });
    return this.wordTemplateMerge.respondWithPendingPdf(projectId, token, res);
  }

  @Get("projects/:pid/pptx-template/pdf/:token")
  async downloadMergedPptxPdf(
    @Req() req: Request,
    @Res() res: Response,
    @Param("pid") projectId: string,
    @Param("token") token: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    await this.mvService.getProject(projectId, toMvAccess(context), { picAssetMode: "report" });
    return this.pptxTemplateMerge.respondWithPendingPdf(projectId, token, res);
  }

  @Get("projects/:pid/files/:fid/download")
  async downloadProjectFile(
    @Req() req: Request,
    @Param("pid") projectId: string,
    @Param("fid") fileId: string,
    @Res() res: Response,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const download = await this.mvService.getProjectFileDownload(
      projectId,
      fileId,
      toMvAccess(context),
    );
    res.setHeader("Content-Type", download.file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(download.file.name)}"`,
    );

    return new Promise<void>((resolve, reject) => {
      download.stream.on("error", (error) => {
        if (!res.headersSent) {
          res.status(404);
        }
        if (!res.writableEnded) {
          res.end();
        }
        reject(error);
      });
      res.on("finish", resolve);
      download.stream.pipe(res);
    });
  }

  @Delete("projects/:pid/files/:fid")
  async deleteProjectFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("pid") projectId: string,
    @Param("fid") fileId: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const result = await this.mvService.deleteProjectFile(projectId, fileId, toMvAccess(context));
    this.publishRealtime(projectId, "asset-images-changed", "project-file:delete");
    this.publishRealtime(projectId, "asset-folders-changed", "project-file:delete");
    return result;
  }

  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: VALUATION_EXCEL_MAX_FILE_BYTES },
    }),
  )
  async uploadFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
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
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const mvCtx = toMvAccess(context);

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
          const created = await this.mvService.createSheet(
            {
              projectId: projectId!.trim(),
              subProjectId: subProjectId?.trim() || undefined,
              name: sheet.name,
              headers: sheet.headers,
              rows: sheet.rows,
              sourceType: "file-import",
              sourceFileName: parsed.sourceFileName,
              spreadsheetMeta: sheet.spreadsheetMeta,
            },
            mvCtx,
          );
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
  async listSheets(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("projectId") projectId: string,
    @Query("subProjectId") subProjectId?: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.listSheets(projectId, toMvAccess(context), subProjectId || undefined);
  }

  @Get("sheets/:id")
  async getSheet(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.getSheet(id, toMvAccess(context));
  }

  @Post("sheets")
  async createSheet(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body()
    body: {
      projectId: string;
      subProjectId?: string;
      name: string;
      headers: string[];
      rows: Record<string, string | number | null>[];
      sourceType: "file-import" | "manual";
      sourceFileName?: string;
      spreadsheetMeta?: MvSpreadsheetMeta;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.createSheet(body, toMvAccess(context));
  }

  @Put("sheets/:id")
  async updateSheet(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      headers?: string[];
      rows?: Record<string, string | number | null>[];
      spreadsheetMeta?: MvSpreadsheetMeta;
    },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.updateSheet(id, body, toMvAccess(context));
  }

  @Delete("sheets")
  async deleteAllSheets(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("projectId") projectId: string,
    @Query("subProjectId") subProjectId?: string,
  ) {
    if (!projectId?.trim()) {
      throw new BadRequestException("projectId is required");
    }
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.deleteAllSheets(
      projectId.trim(),
      toMvAccess(context),
      subProjectId?.trim() || undefined,
    );
  }

  @Delete("sheets/:id")
  async deleteSheet(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    return this.mvService.deleteSheet(id, toMvAccess(context));
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
