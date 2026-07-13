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
exports.AssetsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const sheet_rows_util_1 = require("../machine-valuation/sheet-rows.util");
const asset_import_constants_1 = require("./asset-import.constants");
const asset_import_service_1 = require("./asset-import.service");
const asset_auth_guard_1 = require("./asset-auth.guard");
const assets_service_1 = require("./assets.service");
const assets_dto_1 = require("./dto/assets.dto");
let AssetsController = class AssetsController {
    constructor(assetImportService, assetsService) {
        this.assetImportService = assetImportService;
        this.assetsService = assetsService;
    }
    async importAssets(file, body, request) {
        if (!file || !request.assetUser) {
            throw new common_1.BadRequestException("ملف الاستيراد مطلوب.");
        }
        const originalName = body.sourceFileNameUtf8 && body.sourceFileNameUtf8.length > 0
            ? body.sourceFileNameUtf8
            : (0, sheet_rows_util_1.decodeUploadFilename)(file.originalname || "");
        return this.assetImportService.importFile({
            projectId: body.projectId,
            buffer: file.buffer,
            originalName,
            mimeType: file.mimetype,
            user: request.assetUser,
            activeCompanyId: request.assetActiveCompanyId ?? null,
        });
    }
    async listAssetImports(query, request) {
        return this.assetsService.listAssetImports(query, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async listAssets(query, request) {
        return this.assetsService.listAssets(query, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async createBlankImportRow(body, request) {
        return this.assetsService.createBlankImportRow(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async renameSheet(body, request) {
        return this.assetsService.renameImportSheet(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async bulkReassignAssetType(body, request) {
        return this.assetsService.bulkReassignAssetType(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async bulkUpdateAssets(body, request) {
        return this.assetsService.bulkUpdateAssets(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async updateAsset(id, body, request) {
        return this.assetsService.updateAsset(id, body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async bulkDeleteAssets(body, request) {
        return this.assetsService.bulkDeleteAssets(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async deleteImportSheet(query, request) {
        return this.assetsService.deleteImportSheet(query, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async deleteColumn(columnName, query, request) {
        return this.assetsService.deleteColumn(columnName, query, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async deleteAsset(id, request) {
        return this.assetsService.deleteAsset(id, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async addColumn(body, request) {
        return this.assetsService.addColumn(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async renameSheetColumn(body, request) {
        return this.assetsService.renameSheetColumn(body, request.assetUser, request.assetActiveCompanyId ?? null);
    }
    async exportAssets(query, request, response) {
        const buffer = await this.assetsService.exportAssets(query, request.assetUser, request.assetActiveCompanyId ?? null);
        const fileName = query.assetType
            ? `assets-${query.assetType}-${query.projectId}.xlsx`
            : `assets-${query.projectId}.xlsx`;
        response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
        return buffer;
    }
};
exports.AssetsController = AssetsController;
__decorate([
    (0, common_1.Post)("import"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        limits: {
            fileSize: asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES,
        },
        fileFilter: (_, file, callback) => {
            if (!(0, asset_import_service_1.isAssetImportMultipartAllowed)(file.mimetype, file.originalname || "")) {
                callback(new common_1.BadRequestException("نوع الملف أو الامتداد غير مدعوم. استخدم XLSX أو XLSM أو XLS أو CSV. إذا كان الامتداد صحيحاً وما زال يرفض، جرّب متصفحاً آخر أو أعد تسمية الملف بالإنجليزية."), false);
                return;
            }
            callback(null, true);
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, assets_dto_1.ImportAssetsBodyDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "importAssets", null);
__decorate([
    (0, common_1.Get)("imports"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.ListAssetImportsQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "listAssetImports", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.ListAssetsQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "listAssets", null);
__decorate([
    (0, common_1.Post)("rows"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.CreateBlankImportRowDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "createBlankImportRow", null);
__decorate([
    (0, common_1.Patch)("rename-sheet"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.RenameImportSheetDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "renameSheet", null);
__decorate([
    (0, common_1.Patch)("bulk/asset-type"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.BulkReassignAssetTypeDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "bulkReassignAssetType", null);
__decorate([
    (0, common_1.Patch)("bulk"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.BulkUpdateAssetsDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "bulkUpdateAssets", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assets_dto_1.UpdateAssetDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "updateAsset", null);
__decorate([
    (0, common_1.Delete)("bulk"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.BulkDeleteAssetsDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "bulkDeleteAssets", null);
__decorate([
    (0, common_1.Delete)("import-sheet"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.DeleteImportSheetQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "deleteImportSheet", null);
__decorate([
    (0, common_1.Delete)("columns/:columnName"),
    __param(0, (0, common_1.Param)("columnName")),
    __param(1, (0, common_1.Query)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, assets_dto_1.DeleteAssetColumnQueryDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "deleteColumn", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "deleteAsset", null);
__decorate([
    (0, common_1.Post)("columns/add"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.AddAssetColumnDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "addColumn", null);
__decorate([
    (0, common_1.Patch)("columns/rename"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.RenameSheetColumnDto, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "renameSheetColumn", null);
__decorate([
    (0, common_1.Get)("export"),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [assets_dto_1.ExportAssetsQueryDto, Object, Object]),
    __metadata("design:returntype", Promise)
], AssetsController.prototype, "exportAssets", null);
exports.AssetsController = AssetsController = __decorate([
    (0, common_1.Controller)("assets"),
    (0, common_1.UseGuards)(asset_auth_guard_1.AssetJwtGuard),
    (0, common_1.UsePipes)(new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
    })),
    __metadata("design:paramtypes", [asset_import_service_1.AssetImportService,
        assets_service_1.AssetsService])
], AssetsController);
