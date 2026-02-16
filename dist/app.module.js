"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const cache_manager_1 = require("@nestjs/cache-manager");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const throttler_1 = require("@nestjs/throttler");
const health_controller_1 = require("./health/health.controller");
const sources_controller_1 = require("./sources/sources.controller");
const auth_tracking_controller_1 = require("./auth-tracking/auth-tracking.controller");
const admin_controller_1 = require("./admin/admin.controller");
const api_error_filter_1 = require("./common/api-error.filter");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: [".env.local", ".env"],
            }),
            cache_manager_1.CacheModule.register({
                isGlobal: true,
                ttl: 30_000,
                max: 250,
            }),
            throttler_1.ThrottlerModule.forRoot([
                {
                    ttl: 60_000,
                    limit: 120,
                },
            ]),
        ],
        controllers: [
            health_controller_1.HealthController,
            sources_controller_1.SourcesController,
            auth_tracking_controller_1.AuthTrackingController,
            admin_controller_1.AdminController,
        ],
        providers: [
            {
                provide: core_1.APP_FILTER,
                useClass: api_error_filter_1.ApiErrorFilter,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: throttler_1.ThrottlerGuard,
            },
        ],
    })
], AppModule);
