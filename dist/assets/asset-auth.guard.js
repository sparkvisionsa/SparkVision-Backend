"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetJwtGuard = void 0;
const common_1 = require("@nestjs/common");
const collections_1 = require("../server/auth-tracking/collections");
const context_1 = require("../server/auth-tracking/context");
let AssetJwtGuard = class AssetJwtGuard {
    async canActivate(context) {
        await (0, collections_1.ensureAuthTrackingInitialized)();
        const request = context.switchToHttp().getRequest();
        const authContext = await (0, context_1.resolveRequestContext)(request);
        if (!authContext.user) {
            throw new common_1.UnauthorizedException("تسجيل الدخول مطلوب للوصول إلى الأصول.");
        }
        if (authContext.isIdentityBlocked || authContext.isUserBlocked || authContext.user.isBlocked) {
            throw new common_1.ForbiddenException("تم حظر الوصول إلى هذا الحساب.");
        }
        request.assetAuthContext = authContext;
        request.assetUser = authContext.user;
        request.assetActiveCompanyId = authContext.company?._id ?? null;
        return true;
    }
};
exports.AssetJwtGuard = AssetJwtGuard;
exports.AssetJwtGuard = AssetJwtGuard = __decorate([
    (0, common_1.Injectable)()
], AssetJwtGuard);
