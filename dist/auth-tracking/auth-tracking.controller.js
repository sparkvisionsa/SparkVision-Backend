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
exports.AuthTrackingController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const context_1 = require("../server/auth-tracking/context");
const service_1 = require("../server/auth-tracking/service");
const sessionSchema = zod_1.z.object({
    eventType: zod_1.z.enum(["start", "heartbeat", "end"]),
    pageUrl: zod_1.z.string().max(2000).optional(),
    referrer: zod_1.z.string().max(2000).optional(),
    localBackupId: zod_1.z.string().max(200).optional(),
    activeMs: zod_1.z.number().nonnegative().optional(),
    idleMs: zod_1.z.number().nonnegative().optional(),
    durationMs: zod_1.z.number().nonnegative().optional(),
    fingerprint: zod_1.z
        .object({
        canvas: zod_1.z.string().max(500).optional(),
        webgl: zod_1.z.string().max(500).optional(),
        audio: zod_1.z.string().max(500).optional(),
        timezone: zod_1.z.string().max(100).optional(),
        platform: zod_1.z.string().max(100).optional(),
        language: zod_1.z.string().max(30).optional(),
        screenResolution: zod_1.z.string().max(50).optional(),
        deviceMemory: zod_1.z.string().max(20).optional(),
        hardwareConcurrency: zod_1.z.string().max(20).optional(),
    })
        .optional(),
});
let AuthTrackingController = class AuthTrackingController {
    async getSession(req, res) {
        const result = await (0, service_1.getSessionSnapshot)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async login(req, res, body) {
        const result = await (0, service_1.loginUser)(req, body);
        (0, context_1.applyContextCookies)(res, result.context, {
            rememberMe: result.rememberMe,
        });
        return {
            user: result.user,
            profile: result.profile,
            guestAccess: result.guestAccess,
        };
    }
    async register(req, res, body) {
        const result = await (0, service_1.registerUser)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return {
            user: result.user,
            guestAccess: result.guestAccess,
        };
    }
    async logout(req, res) {
        const result = await (0, service_1.logoutUser)(req);
        (0, context_1.applyContextCookies)(res, result.context, { clearSession: true });
        return { success: true };
    }
    async getTrackingSession(req, res) {
        const result = await (0, service_1.getSessionSnapshot)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async updateTrackingSession(req, res, body) {
        const parsed = sessionSchema.parse(body);
        const result = await (0, service_1.handleSessionPayload)(req, parsed);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async trackAction(req, res, body) {
        const result = await (0, service_1.submitTrackingActions)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async getProfile(req, res) {
        const result = await (0, service_1.getUserProfile)(req);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
    async patchProfile(req, res, body) {
        const result = await (0, service_1.updateUserProfile)(req, body);
        (0, context_1.applyContextCookies)(res, result.context);
        return result.payload;
    }
};
exports.AuthTrackingController = AuthTrackingController;
__decorate([
    (0, common_1.Get)("auth/me"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "getSession", null);
__decorate([
    (0, common_1.Post)("auth/login"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "login", null);
__decorate([
    (0, common_1.Post)("auth/register"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "register", null);
__decorate([
    (0, common_1.Post)("auth/logout"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)("track/session"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "getTrackingSession", null);
__decorate([
    (0, common_1.Post)("track/session"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "updateTrackingSession", null);
__decorate([
    (0, common_1.Post)("track/action"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "trackAction", null);
__decorate([
    (0, common_1.Get)("user/profile"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "getProfile", null);
__decorate([
    (0, common_1.Patch)("user/profile"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthTrackingController.prototype, "patchProfile", null);
exports.AuthTrackingController = AuthTrackingController = __decorate([
    (0, common_1.Controller)()
], AuthTrackingController);
