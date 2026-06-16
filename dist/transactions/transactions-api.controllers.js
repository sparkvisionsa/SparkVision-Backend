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
exports.TransactionsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const path_1 = require("path");
const transactions_mongo_service_1 = require("./transactions-mongo.service");
const context_1 = require("../server/auth-tracking/context");
const multerStorage = (0, multer_1.diskStorage)({
    destination: (0, path_1.join)(process.cwd(), "uploads"),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${unique}${(0, path_1.extname)(file.originalname)}`);
    },
});
async function resolveSessionMeta(req) {
    try {
        const context = await (0, context_1.resolveRequestContext)(req);
        return {
            createdByUserId: context.user?._id.toString() ?? null,
            companyId: context.company?._id.toString() ?? null,
        };
    }
    catch {
        return { createdByUserId: null, companyId: null };
    }
}
let TransactionsController = class TransactionsController {
    constructor(svc) {
        this.svc = svc;
    }
    async list(req) {
        const { companyId } = await resolveSessionMeta(req);
        let userId = null;
        let userRole = null;
        try {
            const context = await (0, context_1.resolveRequestContext)(req);
            userId = context.user?._id.toString() ?? null;
            userRole = context.user?.role ?? null;
        }
        catch { }
        return this.svc.listTransactions(companyId, userRole === "inspector" ? userId : null);
    }
    async create(req, files) {
        const meta = await resolveSessionMeta(req);
        return this.svc.createTransaction(req.body, files ?? [], meta);
    }
    setCompleted(id, body) {
        return this.svc.setCompleted(id, body.isCompleted ?? false);
    }
    listFreelanceInspectors() {
        return this.svc.listFreelanceInspectors();
    }
    async getOne(id, req) {
        const { createdByUserId, companyId } = await resolveSessionMeta(req);
        let userRole = null;
        try {
            const context = await (0, context_1.resolveRequestContext)(req);
            userRole = context.user?.role ?? null;
        }
        catch { }
        return this.svc.getTransaction(id, userRole === "inspector");
    }
    update(id, body) {
        return this.svc.updateTransaction(id, body, []);
    }
    assignInspectors(id, body) {
        return this.svc.assignInspectors(id, body.inspectorIds ?? []);
    }
    remove(id) {
        return this.svc.deleteTransaction(id);
    }
};
exports.TransactionsController = TransactionsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], TransactionsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.AnyFilesInterceptor)({ storage: multerStorage })),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array]),
    __metadata("design:returntype", Promise)
], TransactionsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id/completed"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TransactionsController.prototype, "setCompleted", null);
__decorate([
    (0, common_1.Get)("freelance-inspectors"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TransactionsController.prototype, "listFreelanceInspectors", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], TransactionsController.prototype, "getOne", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TransactionsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(":id/inspectors"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], TransactionsController.prototype, "assignInspectors", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], TransactionsController.prototype, "remove", null);
exports.TransactionsController = TransactionsController = __decorate([
    (0, common_1.Controller)("transactions"),
    __metadata("design:paramtypes", [transactions_mongo_service_1.TransactionsMongoService])
], TransactionsController);
