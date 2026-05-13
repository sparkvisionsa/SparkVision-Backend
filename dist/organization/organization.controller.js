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
exports.OrganizationController = void 0;
const common_1 = require("@nestjs/common");
const context_1 = require("../server/auth-tracking/context");
const service_1 = require("../server/auth-tracking/service");
let OrganizationController = class OrganizationController {
    async listCompanies(req, res) {
        const result = await (0, service_1.listCompaniesForSuperAdmin)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async companyDetail(req, res, companyId) {
        const result = await (0, service_1.getCompanyDetailForSuperAdmin)(req, companyId);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async createCompany(req, res, body) {
        const result = await (0, service_1.createCompanyBySuperAdmin)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async updateCompany(req, res, companyId, body) {
        const result = await (0, service_1.updateCompanyBySuperAdmin)(req, companyId, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async deleteCompany(req, res, companyId) {
        const result = await (0, service_1.deleteCompanyBySuperAdmin)(req, companyId);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async deleteCompanyUser(req, res, companyId, userId) {
        const result = await (0, service_1.deleteCompanyMemberBySuperAdmin)(req, companyId, userId);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async listCompanyUsers(req, res) {
        const result = await (0, service_1.listCompanyUsersForCompanyAdmin)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async companyReportDefaults(req, res) {
        const result = await (0, service_1.getCompanyReportDefaultsForMember)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async patchCompanyBranding(req, res, body) {
        const result = await (0, service_1.updateCompanyBrandingByCompanyAdmin)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async patchCompanyUserSignature(req, res, body) {
        const result = await (0, service_1.updateCompanyMemberReportSignatureByCompanyAdmin)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async createCompanyUser(req, res, body) {
        let payload = body ?? req.body;
        if (typeof payload === "string") {
            try {
                payload = JSON.parse(payload);
            }
            catch {
                payload = {};
            }
        }
        const result = await (0, service_1.createCompanyUserByCompanyAdmin)(req, payload);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async patchCompanyUserAsCompanyAdmin(req, res, userId, body) {
        let payload = body ?? req.body;
        if (typeof payload === "string") {
            try {
                payload = JSON.parse(payload);
            }
            catch {
                payload = {};
            }
        }
        const result = await (0, service_1.updateCompanyUserByCompanyAdmin)(req, userId, payload);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async deleteCompanyUserAsCompanyAdmin(req, res, userId) {
        const result = await (0, service_1.deleteCompanyUserByCompanyAdmin)(req, userId);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
};
exports.OrganizationController = OrganizationController;
__decorate([
    (0, common_1.Get)("admin/companies"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "listCompanies", null);
__decorate([
    (0, common_1.Get)("admin/companies/:companyId/detail"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("companyId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "companyDetail", null);
__decorate([
    (0, common_1.Post)("admin/companies"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "createCompany", null);
__decorate([
    (0, common_1.Patch)("admin/companies/:companyId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("companyId")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "updateCompany", null);
__decorate([
    (0, common_1.Delete)("admin/companies/:companyId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("companyId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "deleteCompany", null);
__decorate([
    (0, common_1.Delete)("admin/companies/:companyId/users/:userId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("companyId")),
    __param(3, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, String]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "deleteCompanyUser", null);
__decorate([
    (0, common_1.Get)("company/users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "listCompanyUsers", null);
__decorate([
    (0, common_1.Get)("company/report-defaults"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "companyReportDefaults", null);
__decorate([
    (0, common_1.Patch)("company/branding"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "patchCompanyBranding", null);
__decorate([
    (0, common_1.Patch)("company/user-signature"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "patchCompanyUserSignature", null);
__decorate([
    (0, common_1.Post)("company/users"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "createCompanyUser", null);
__decorate([
    (0, common_1.Patch)("company/users/:userId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("userId")),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "patchCompanyUserAsCompanyAdmin", null);
__decorate([
    (0, common_1.Delete)("company/users/:userId"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], OrganizationController.prototype, "deleteCompanyUserAsCompanyAdmin", null);
exports.OrganizationController = OrganizationController = __decorate([
    (0, common_1.Controller)()
], OrganizationController);
