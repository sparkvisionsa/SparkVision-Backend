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
const machine_valuation_service_1 = require("./machine-valuation.service");
const file_parser_service_1 = require("./file-parser.service");
const sheet_rows_util_1 = require("./sheet-rows.util");
let MachineValuationController = class MachineValuationController {
    constructor(mvService, fileParser) {
        this.mvService = mvService;
        this.fileParser = fileParser;
    }
    listProjects() {
        return this.mvService.listProjects();
    }
    createProject(body) {
        return this.mvService.createProject(body.name ?? "");
    }
    getProject(id) {
        return this.mvService.getProject(id);
    }
    deleteProject(id) {
        return this.mvService.deleteProject(id);
    }
    createSubProject(projectId, body) {
        return this.mvService.createSubProject(projectId, body.name ?? "");
    }
    getSubProject(pid, sid) {
        return this.mvService.getSubProject(pid, sid);
    }
    deleteSubProject(pid, sid) {
        return this.mvService.deleteSubProject(pid, sid);
    }
    async uploadFile(file, projectId, subProjectId, persist, sourceFileNameUtf8) {
        if (!file) {
            return {
                sheets: [],
                sourceFileName: "",
                persisted: false,
                savedSheets: [],
                saveErrors: [],
            };
        }
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
                    });
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
    listSheets(projectId, subProjectId) {
        return this.mvService.listSheets(projectId, subProjectId || undefined);
    }
    getSheet(id) {
        return this.mvService.getSheet(id);
    }
    createSheet(body) {
        return this.mvService.createSheet(body);
    }
    updateSheet(id, body) {
        return this.mvService.updateSheet(id, body);
    }
    deleteAllSheets(projectId, subProjectId) {
        if (!projectId?.trim()) {
            throw new common_1.BadRequestException("projectId is required");
        }
        return this.mvService.deleteAllSheets(projectId.trim(), subProjectId?.trim() || undefined);
    }
    deleteSheet(id) {
        return this.mvService.deleteSheet(id);
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
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "listProjects", null);
__decorate([
    (0, common_1.Post)("projects"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "createProject", null);
__decorate([
    (0, common_1.Get)("projects/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "getProject", null);
__decorate([
    (0, common_1.Delete)("projects/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "deleteProject", null);
__decorate([
    (0, common_1.Post)("projects/:id/subprojects"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "createSubProject", null);
__decorate([
    (0, common_1.Get)("projects/:pid/subprojects/:sid"),
    __param(0, (0, common_1.Param)("pid")),
    __param(1, (0, common_1.Param)("sid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "getSubProject", null);
__decorate([
    (0, common_1.Delete)("projects/:pid/subprojects/:sid"),
    __param(0, (0, common_1.Param)("pid")),
    __param(1, (0, common_1.Param)("sid")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "deleteSubProject", null);
__decorate([
    (0, common_1.Post)("upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        limits: { fileSize: 50 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)("projectId")),
    __param(2, (0, common_1.Body)("subProjectId")),
    __param(3, (0, common_1.Body)("persist")),
    __param(4, (0, common_1.Body)("sourceFileNameUtf8")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", Promise)
], MachineValuationController.prototype, "uploadFile", null);
__decorate([
    (0, common_1.Get)("sheets"),
    __param(0, (0, common_1.Query)("projectId")),
    __param(1, (0, common_1.Query)("subProjectId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "listSheets", null);
__decorate([
    (0, common_1.Get)("sheets/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "getSheet", null);
__decorate([
    (0, common_1.Post)("sheets"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "createSheet", null);
__decorate([
    (0, common_1.Put)("sheets/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "updateSheet", null);
__decorate([
    (0, common_1.Delete)("sheets"),
    __param(0, (0, common_1.Query)("projectId")),
    __param(1, (0, common_1.Query)("subProjectId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], MachineValuationController.prototype, "deleteAllSheets", null);
__decorate([
    (0, common_1.Delete)("sheets/:id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
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
