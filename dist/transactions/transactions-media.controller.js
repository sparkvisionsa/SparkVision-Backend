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
exports.TransactionsMediaController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const transactions_media_service_1 = require("./transactions-media.service");
const multerStorage = (0, multer_1.diskStorage)({
    destination: (0, path_1.join)(process.cwd(), "uploads"),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${(0, path_1.extname)(file.originalname)}`);
    },
});
let TransactionsMediaController = class TransactionsMediaController {
    constructor(svc) {
        this.svc = svc;
    }
    editCore(id, body) {
        return this.svc.editCoreFields(id, body);
    }
    listAttachments(id) {
        return this.svc.listAttachments(id);
    }
    addAttachments(id, files, req) {
        const names = this.extractNames(req.body);
        return this.svc.addAttachments(id, files ?? [], names);
    }
    renameAttachment(id, attId, name) {
        return this.svc.renameAttachment(id, attId, name ?? "");
    }
    deleteAttachment(id, attId) {
        return this.svc.deleteAttachment(id, attId);
    }
    bulkDeleteAttachments(id, ids) {
        return this.svc.bulkDeleteAttachments(id, ids ?? []);
    }
    listImages(id) {
        return this.svc.listImages(id);
    }
    addImages(id, files, req) {
        const names = this.extractNames(req.body);
        return this.svc.addImages(id, files ?? [], names);
    }
    reorderImages(id, order) {
        return this.svc.reorderImages(id, order ?? []);
    }
    renameImage(id, imgId, name) {
        return this.svc.renameImage(id, imgId, name ?? "");
    }
    deleteImage(id, imgId) {
        return this.svc.deleteImage(id, imgId);
    }
    bulkDeleteImages(id, ids) {
        return this.svc.bulkDeleteImages(id, ids ?? []);
    }
    extractNames(body) {
        const names = {};
        const raw = body?.["names"];
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            for (const [k, v] of Object.entries(raw)) {
                if (typeof v === "string")
                    names[k] = v;
            }
        }
        return names;
    }
};
exports.TransactionsMediaController = TransactionsMediaController;
__decorate([
    (0, common_1.Patch)(":id/core"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "editCore", null);
__decorate([
    (0, common_1.Get)(":id/attachments"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "listAttachments", null);
__decorate([
    (0, common_1.Post)(":id/attachments"),
    (0, common_1.UseInterceptors)((0, platform_express_1.AnyFilesInterceptor)({ storage: multerStorage })),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array, Object]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "addAttachments", null);
__decorate([
    (0, common_1.Patch)(":id/attachments/:attId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("attId")),
    __param(2, (0, common_1.Body)("name")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "renameAttachment", null);
__decorate([
    (0, common_1.Delete)(":id/attachments/:attId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("attId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "deleteAttachment", null);
__decorate([
    (0, common_1.Delete)(":id/attachments"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)("ids")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "bulkDeleteAttachments", null);
__decorate([
    (0, common_1.Get)(":id/images"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "listImages", null);
__decorate([
    (0, common_1.Post)(":id/images"),
    (0, common_1.UseInterceptors)((0, platform_express_1.AnyFilesInterceptor)({
        storage: multerStorage,
        fileFilter: (_req, file, cb) => {
            cb(null, file.mimetype.startsWith("image/"));
        },
    })),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array, Object]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "addImages", null);
__decorate([
    (0, common_1.Patch)(":id/images/reorder"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)("order")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "reorderImages", null);
__decorate([
    (0, common_1.Patch)(":id/images/:imgId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("imgId")),
    __param(2, (0, common_1.Body)("name")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "renameImage", null);
__decorate([
    (0, common_1.Delete)(":id/images/:imgId"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Param)("imgId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "deleteImage", null);
__decorate([
    (0, common_1.Delete)(":id/images"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)("ids")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", void 0)
], TransactionsMediaController.prototype, "bulkDeleteImages", null);
exports.TransactionsMediaController = TransactionsMediaController = __decorate([
    (0, common_1.Controller)("transactions"),
    __metadata("design:paramtypes", [transactions_media_service_1.TransactionsMediaService])
], TransactionsMediaController);
