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
exports.AdminController = void 0;
const common_1 = require("@nestjs/common");
const context_1 = require("../server/auth-tracking/context");
const service_1 = require("../server/auth-tracking/service");
let AdminController = class AdminController {
    async analytics(req, res) {
        const result = await (0, service_1.getAdminAnalytics)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async config(req, res) {
        const result = await (0, service_1.getAdminConfigPayload)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async updateConfig(req, res, body) {
        const result = await (0, service_1.updateAdminConfigPayload)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async users(req, res) {
        const result = await (0, service_1.listAdminUsers)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async updateUserState(req, res, body) {
        const result = await (0, service_1.updateAdminUserState)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async activities(req, res) {
        const result = await (0, service_1.listAdminActivities)(req);
        const format = typeof req.query.format === "string" ? req.query.format : undefined;
        (0, context_1.applyContextCookies)(res, result.context);
        if (format === "csv" || format === "excel") {
            const filename = format === "excel" ? "spark-vision-activities.xlsx.csv" : "spark-vision-activities.csv";
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
            res.status(200).send(result.payload);
            return;
        }
        if (format === "pdf") {
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.setHeader("Content-Disposition", "attachment; filename=\"spark-vision-activities.pdf.txt\"");
            res.status(200).send(result.payload);
            return;
        }
        res.status(200).json(result.payload);
    }
};
exports.AdminController = AdminController;
__decorate([
    (0, common_1.Get)("admin/analytics"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "analytics", null);
__decorate([
    (0, common_1.Get)("admin/config"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "config", null);
__decorate([
    (0, common_1.Put)("admin/config"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateConfig", null);
__decorate([
    (0, common_1.Get)("admin/users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "users", null);
__decorate([
    (0, common_1.Patch)("admin/users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "updateUserState", null);
__decorate([
    (0, common_1.Get)("admin/activities"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AdminController.prototype, "activities", null);
exports.AdminController = AdminController = __decorate([
    (0, common_1.Controller)()
], AdminController);
