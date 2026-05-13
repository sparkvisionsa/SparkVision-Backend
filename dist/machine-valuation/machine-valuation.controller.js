"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineValuationController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const promises_1 = require("node:stream/promises");
const node_stream_1 = require("node:stream");
const machine_valuation_service_1 = require("./machine-valuation.service");
const file_parser_service_1 = require("./file-parser.service");
const asset_import_constants_1 = require("../assets/asset-import.constants");
const inspector_files_constants_1 = require("./inspector-files.constants");
const sheet_rows_util_1 = require("./sheet-rows.util");
const context_1 = require("../server/auth-tracking/context");
function toMvAccess(context) {
    const u = context.user;
    const cid = context.company?._id;
    const companyId = cid != null ? String(cid).trim() || null : null;
    return {
        userId: u?._id?.toString() ?? null,
        companyId,
        isSuperAdmin: u?.role === "super_admin",
        userRole: u?.role ?? null,
    };
}
function bodyStringArray(value) {
    if (Array.isArray(value))
        return value.map((item) => String(item ?? "").trim());
    if (typeof value === "string")
        return [value.trim()];
    return [];
}
let MachineValuationController = class MachineValuationController {
    constructor(mvService, fileParser) {
        this.mvService = mvService;
        this.fileParser = fileParser;
    }
    async listProjects(req, res) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listProjects(toMvAccess(context));
    }
    async createProject(req, res, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.createProject(body.name ?? "", toMvAccess(context), body.companyId, body.reportType, body.locations, body.contacts);
    }
    async listInspectorFiles(req, res, id) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listInspectorFiles(id, toMvAccess(context));
    }
    async uploadInspectorFile(req, res, id, file) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        if (!file?.buffer) {
            throw new common_1.BadRequestException("لم يُرفع أي ملف.");
        }
        return this.mvService.uploadInspectorFile(id, file, toMvAccess(context));
    }
    async deleteInspectorFile(req, res, id, fileId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteInspectorFile(id, fileId, toMvAccess(context));
    }
    async renameInspectorFile(req, res, id, fileId, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.renameInspectorFile(id, fileId, toMvAccess(context), body?.name ?? "");
    }
    async downloadInspectorFile(req, id, fileId, attachment, res) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const wantAttachment = attachment === "1" || attachment === "true";
        const rangeRaw = req.headers.range;
        const rangeHeader = Array.isArray(rangeRaw) ? rangeRaw[0] : rangeRaw;
        const payload = await this.mvService.getInspectorFileDownload(id, fileId, toMvAccess(context), { attachment: wantAttachment, rangeHeader: rangeHeader ?? undefined });
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
                throw new common_1.BadGatewayException("تعذر جلب الملف من التخزين السحابي للتنزيل.");
            }
            const rawCt = up.headers.get("content-type");
            const ct = (rawCt?.split(";")[0] ?? "").trim() || payload.mimeType || "application/octet-stream";
            res.setHeader("Content-Type", ct);
            res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(payload.fileName)}`);
            const len = up.headers.get("content-length");
            if (len && /^\d+$/.test(len.trim())) {
                res.setHeader("Content-Length", len.trim());
            }
            const webBody = up.body;
            const readable = node_stream_1.Readable.fromWeb(webBody);
            try {
                await (0, promises_1.pipeline)(readable, res);
            }
            catch {
                if (!res.headersSent) {
                    throw new common_1.BadGatewayException("تعذر إكمال تنزيل الملف من التخزين السحابي.");
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
        return new Promise((resolve, reject) => {
            payload.stream.on("error", (error) => {
                if (!res.headersSent)
                    res.status(404);
                if (!res.writableEnded)
                    res.end();
                reject(error);
            });
            res.on("finish", resolve);
            payload.stream.pipe(res);
        });
    }
    async getProject(req, res, id, picAssetMode) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const mode = picAssetMode === "summary" ? "summary" : "full";
        return this.mvService.getProject(id, toMvAccess(context), { picAssetMode: mode });
    }
    async setProjectWorkflow(req, res, id, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.updateProject(id, toMvAccess(context), body ?? {});
    }
    async patchProject(req, res, id, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.updateProject(id, toMvAccess(context), body ?? {});
    }
    async deleteProject(req, res, id) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteProject(id, toMvAccess(context));
    }
    async createSubProject(req, res, projectId, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const parentRaw = body.parent?.trim() || body.parentSubProjectId?.trim() || undefined;
        return this.mvService.createSubProject(projectId, body.name ?? "", toMvAccess(context), parentRaw);
    }
    async deleteAllSubProjects(req, res, projectId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteAllSubProjects(projectId, toMvAccess(context));
    }
    async getSubProject(req, res, pid, sid) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.getSubProject(pid, sid, toMvAccess(context));
    }
    async patchSubProject(req, res, pid, sid, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.patchSubProject(pid, sid, toMvAccess(context), body);
    }
    async deleteSubProject(req, res, pid, sid) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteSubProject(pid, sid, toMvAccess(context));
    }
    async generateInspectionFolders(req, res, pid, sid, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.generateInspectionFoldersFromSheet(pid, sid, toMvAccess(context), body ?? {});
    }
    async generateAssetImportImageFolders(req, res, pid, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.generateInspectionFoldersFromAssetImport(pid, toMvAccess(context), {
            columnKey: body?.columnKey ?? "",
            importId: body?.importId ?? "",
            sheetName: body?.sheetName ?? "",
        });
    }
    async listProjectAssetImageFiles(req, res, projectId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listProjectAssetImageFiles(projectId, toMvAccess(context));
    }
    async uploadProjectAssetImageFiles(req, res, projectId, picAssetFolderIdFromQuery, files) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const paths = bodyStringArray(req.body?.paths);
        const rawBodyPid = req.body?.picAssetFolderId;
        const fromBody = typeof rawBodyPid === "string" ? rawBodyPid.trim() || undefined
            : Array.isArray(rawBodyPid) && typeof rawBodyPid[0] === "string" ? rawBodyPid[0].trim() || undefined
                : undefined;
        const picAssetFolderId = (picAssetFolderIdFromQuery && picAssetFolderIdFromQuery.trim()) || fromBody;
        return this.mvService.uploadProjectFiles(projectId, files ?? [], toMvAccess(context), picAssetFolderId, {
            scope: "asset-images",
            relativePaths: paths,
            imageOnly: true,
        });
    }
    async handleReorderProjectAssetImageFiles(req, res, projectId, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const folderPath = typeof body?.folderPath === "string" ? body.folderPath.trim() : "";
        const rawIds = body?.orderedFileIds;
        const orderedFileIds = Array.isArray(rawIds) ?
            rawIds.map((item) => String(item ?? "").trim()).filter((id) => id.length > 0)
            : [];
        return this.mvService.reorderProjectAssetImageFiles(projectId, toMvAccess(context), folderPath, orderedFileIds, body?.picAssetFolderId);
    }
    async patchProjectAssetImageFilePlace(req, res, projectId, body) {
        return this.handlePlaceProjectAssetImageFile(req, res, projectId, body);
    }
    async postProjectAssetImageFilePlace(req, res, projectId, body) {
        return this.handlePlaceProjectAssetImageFile(req, res, projectId, body);
    }
    async patchProjectAssetImageFilesReorder(req, res, projectId, body) {
        return this.handleReorderProjectAssetImageFiles(req, res, projectId, body);
    }
    async postProjectAssetImageFilesReorder(req, res, projectId, body) {
        return this.handleReorderProjectAssetImageFiles(req, res, projectId, body);
    }
    async patchProjectAssetImageReportSelection(req, res, projectId, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const rawIds = body?.fileIds;
        const fileIds = Array.isArray(rawIds) ?
            rawIds.map((item) => String(item ?? "").trim()).filter((id) => id.length > 0)
            : [];
        return this.mvService.updateProjectAssetImageReportSelection(projectId, toMvAccess(context), fileIds, body?.includeInReport !== false);
    }
    async handlePlaceProjectAssetImageFile(req, res, projectId, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
        return this.mvService.placeProjectAssetImageFile(projectId, toMvAccess(context), fileId, body?.targetFolderPath, body?.insertBeforeFileId, body?.targetPicAssetFolderId);
    }
    async listProjectFiles(req, res, projectId, subProjectId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listProjectFiles(projectId, toMvAccess(context), subProjectId?.trim() || undefined);
    }
    async listValuationExcelFiles(req, res, projectId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listValuationExcelFiles(projectId, toMvAccess(context));
    }
    async uploadValuationExcelFiles(req, res, projectId, files) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.uploadValuationExcelFiles(projectId, files ?? [], toMvAccess(context));
    }
    async downloadValuationExcelFile(req, projectId, fileId, res) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const download = await this.mvService.getValuationExcelFileDownload(projectId, fileId, toMvAccess(context));
        res.setHeader("Content-Type", download.file.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(download.file.name)}"`);
        return new Promise((resolve, reject) => {
            download.stream.on("error", (error) => {
                if (!res.headersSent)
                    res.status(404);
                if (!res.writableEnded)
                    res.end();
                reject(error);
            });
            res.on("finish", resolve);
            download.stream.pipe(res);
        });
    }
    async deleteValuationExcelFile(req, res, projectId, fileId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteValuationExcelFile(projectId, fileId, toMvAccess(context));
    }
    async uploadProjectFiles(req, res, projectId, subProjectIdFromQuery, valuationAccountingFromQuery, files) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const raw = req.body?.subProjectId;
        const fromBody = typeof raw === "string"
            ? raw.trim() || undefined
            : Array.isArray(raw) && typeof raw[0] === "string"
                ? raw[0].trim() || undefined
                : undefined;
        const subProjectId = (subProjectIdFromQuery && subProjectIdFromQuery.trim()) || fromBody;
        const preferDigitalOcean = valuationAccountingFromQuery === "1" ||
            String(valuationAccountingFromQuery || "").toLowerCase() === "true";
        return this.mvService.uploadProjectFiles(projectId, files ?? [], toMvAccess(context), subProjectId, preferDigitalOcean ? { preferDigitalOcean: true } : {});
    }
    async downloadProjectFile(req, projectId, fileId, res) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const download = await this.mvService.getProjectFileDownload(projectId, fileId, toMvAccess(context));
        res.setHeader("Content-Type", download.file.mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(download.file.name)}"`);
        return new Promise((resolve, reject) => {
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
    async deleteProjectFile(req, res, projectId, fileId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteProjectFile(projectId, fileId, toMvAccess(context));
    }
    async uploadFile(req, res, file, projectId, subProjectId, persist, sourceFileNameUtf8) {
        if (!file) {
            return {
                sheets: [],
                sourceFileName: "",
                persisted: false,
                savedSheets: [],
                saveErrors: [],
            };
        }
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        const mvCtx = toMvAccess(context);
        const fileName = sourceFileNameUtf8 && sourceFileNameUtf8.trim().length > 0
            ? sourceFileNameUtf8.trim()
            : (0, sheet_rows_util_1.decodeUploadFilename)(file.originalname || "");
        const parsed = await this.fileParser.parse(file.buffer, fileName, file.mimetype);
        const wantPersist = (persist === "1" || persist === "true") &&
            !!projectId &&
            projectId.trim().length > 0;
        if (wantPersist) {
            const saved = [];
            const saveErrors = [];
            for (const sheet of parsed.sheets) {
                try {
                    const created = await this.mvService.createSheet({
                        projectId: projectId.trim(),
                        subProjectId: subProjectId?.trim() || undefined,
                        name: sheet.name,
                        headers: sheet.headers,
                        rows: sheet.rows,
                        sourceType: "file-import",
                        sourceFileName: parsed.sourceFileName,
                        spreadsheetMeta: sheet.spreadsheetMeta,
                    }, mvCtx);
                    saved.push(created);
                }
                catch (err) {
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
        return { ...parsed, persisted: false, saveErrors: [] };
    }
    async listSheets(req, res, projectId, subProjectId) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.listSheets(projectId, toMvAccess(context), subProjectId || undefined);
    }
    async getSheet(req, res, id) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.getSheet(id, toMvAccess(context));
    }
    async createSheet(req, res, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.createSheet(body, toMvAccess(context));
    }
    async updateSheet(req, res, id, body) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.updateSheet(id, body, toMvAccess(context));
    }
    async deleteAllSheets(req, res, projectId, subProjectId) {
        if (!projectId?.trim()) {
            throw new common_1.BadRequestException("projectId is required");
        }
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteAllSheets(projectId.trim(), toMvAccess(context), subProjectId?.trim() || undefined);
    }
    async deleteSheet(req, res, id) {
        const context = await (0, context_1.resolveRequestContext)(req);
        (0, context_1.applyContextCookies)(res, context);
        return this.mvService.deleteSheet(id, toMvAccess(context));
    }
    listHeaderOptions() {
        return this.mvService.listHeaderOptions();
    }
    addHeaderOption(body) {
        return this.mvService.addHeaderOption(body.name ?? "");
    }
};
exports.MachineValuationController = MachineValuationController;
__decorate([
    (0, common_1.Get)("projects"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listProjects", null);
__decorate([
    (0, common_1.Post)("projects"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "createProject", null);
__decorate([
    (0, common_1.Get)("projects/:id/inspectorFiles"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listInspectorFiles", null);
__decorate([
    (0, common_1.Post)("projects/:id/inspectorFiles"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: inspector_files_constants_1.MV_INSPECTOR_FILE_MAX_BYTES },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.UploadedFile)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadInspectorFile", null);
__decorate([
    (0, common_1.Delete)("projects/:id/inspectorFiles/:fileId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Param)("fileId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteInspectorFile", null);
__decorate([
    (0, common_1.Patch)("projects/:id/inspectorFiles/:fileId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Param)("fileId")),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "renameInspectorFile", null);
__decorate([
    (0, common_1.Get)("projects/:id/inspectorFiles/:fileId/download"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Param)("fileId")),
    __param(3, (0, common_1.Query)("attachment")),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "downloadInspectorFile", null);
__decorate([
    (0, common_1.Get)("projects/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Query)("picAssetMode")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "getProject", null);
__decorate([
    (0, common_1.Post)("projects/:id/workflow"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "setProjectWorkflow", null);
__decorate([
    (0, common_1.Patch)("projects/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "patchProject", null);
__decorate([
    (0, common_1.Delete)("projects/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteProject", null);
__decorate([
    (0, common_1.Post)("projects/:id/subprojects"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "createSubProject", null);
__decorate([
    (0, common_1.Delete)("projects/:id/subprojects"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteAllSubProjects", null);
__decorate([
    (0, common_1.Get)("projects/:pid/subprojects/:sid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("sid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "getSubProject", null);
__decorate([
    (0, common_1.Patch)("projects/:pid/subprojects/:sid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("sid")),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "patchSubProject", null);
__decorate([
    (0, common_1.Delete)("projects/:pid/subprojects/:sid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("sid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteSubProject", null);
__decorate([
    (0, common_1.Post)("projects/:pid/sheets/:sid/generate-inspection-folders"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("sid")),
    __param(4, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "generateInspectionFolders", null);
__decorate([
    (0, common_1.Post)("projects/:pid/asset-import-image-folders"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "generateAssetImportImageFolders", null);
__decorate([
    (0, common_1.Get)("projects/:pid/asset-image-files"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listProjectAssetImageFiles", null);
__decorate([
    (0, common_1.Post)("projects/:pid/asset-image-files"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)("files", 500, {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Query)("picAssetFolderId")),
    __param(4, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object, Array]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadProjectAssetImageFiles", null);
__decorate([
    (0, common_1.Patch)("projects/:pid/asset-image-files/place"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "patchProjectAssetImageFilePlace", null);
__decorate([
    (0, common_1.Post)("projects/:pid/asset-image-files/place"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "postProjectAssetImageFilePlace", null);
__decorate([
    (0, common_1.Patch)("projects/:pid/asset-image-files/reorder"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "patchProjectAssetImageFilesReorder", null);
__decorate([
    (0, common_1.Post)("projects/:pid/asset-image-files/reorder"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "postProjectAssetImageFilesReorder", null);
__decorate([
    (0, common_1.Patch)("projects/:pid/asset-image-files/report-selection"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "patchProjectAssetImageReportSelection", null);
__decorate([
    (0, common_1.Get)("projects/:pid/files"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Query)("subProjectId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listProjectFiles", null);
__decorate([
    (0, common_1.Get)("projects/:pid/valuation-excel-files"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listValuationExcelFiles", null);
__decorate([
    (0, common_1.Post)("projects/:pid/valuation-excel-files"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)("files", 20, {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Array]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadValuationExcelFiles", null);
__decorate([
    (0, common_1.Get)("projects/:pid/valuation-excel-files/:fid/download"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("pid")),
    __param(2, (0, common_1.Param)("fid")),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "downloadValuationExcelFile", null);
__decorate([
    (0, common_1.Delete)("projects/:pid/valuation-excel-files/:fid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("fid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteValuationExcelFile", null);
__decorate([
    (0, common_1.Post)("projects/:pid/files"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)("files", 20, {
        storage: (0, multer_1.memoryStorage)(),
        limits: { fileSize: asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Query)("subProjectId")),
    __param(4, (0, common_1.Query)("valuationAccounting")),
    __param(5, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object, Object, Array]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadProjectFiles", null);
__decorate([
    (0, common_1.Get)("projects/:pid/files/:fid/download"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("pid")),
    __param(2, (0, common_1.Param)("fid")),
    __param(3, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "downloadProjectFile", null);
__decorate([
    (0, common_1.Delete)("projects/:pid/files/:fid"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("pid")),
    __param(3, (0, common_1.Param)("fid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteProjectFile", null);
__decorate([
    (0, common_1.Post)("upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        limits: { fileSize: asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES },
    })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.UploadedFile)()),
    __param(3, (0, common_1.Body)("projectId")),
    __param(4, (0, common_1.Body)("subProjectId")),
    __param(5, (0, common_1.Body)("persist")),
    __param(6, (0, common_1.Body)("sourceFileNameUtf8")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Get)("sheets"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Query)("projectId")),
    __param(3, (0, common_1.Query)("subProjectId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "listSheets", null);
__decorate([
    (0, common_1.Get)("sheets/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "getSheet", null);
__decorate([
    (0, common_1.Post)("sheets"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "createSheet", null);
__decorate([
    (0, common_1.Put)("sheets/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "updateSheet", null);
__decorate([
    (0, common_1.Delete)("sheets"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Query)("projectId")),
    __param(3, (0, common_1.Query)("subProjectId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteAllSheets", null);
__decorate([
    (0, common_1.Delete)("sheets/:id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "deleteSheet", null);
__decorate([
    (0, common_1.Get)("header-options"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "listHeaderOptions", null);
__decorate([
    (0, common_1.Post)("header-options"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "addHeaderOption", null);
exports.MachineValuationController = MachineValuationController = __decorate([
    (0, common_1.Controller)("mv"),
    __metadata("design:paramtypes", [machine_valuation_service_1.MachineValuationService,
        file_parser_service_1.FileParserService])
], MachineValuationController);
