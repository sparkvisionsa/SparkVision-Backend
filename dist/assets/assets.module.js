"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetsModule = void 0;
const common_1 = require("@nestjs/common");
const assets_controller_1 = require("./assets.controller");
const asset_import_service_1 = require("./asset-import.service");
const asset_import_cache_service_1 = require("./asset-import-cache.service");
const assets_service_1 = require("./assets.service");
const asset_list_cache_service_1 = require("./asset-list-cache.service");
const asset_audit_service_1 = require("./asset-audit.service");
const asset_project_access_service_1 = require("./asset-project-access.service");
const asset_auth_guard_1 = require("./asset-auth.guard");
let AssetsModule = class AssetsModule {
};
exports.AssetsModule = AssetsModule;
exports.AssetsModule = AssetsModule = __decorate([
    (0, common_1.Module)({
        controllers: [assets_controller_1.AssetsController],
        providers: [
            asset_import_service_1.AssetImportService,
            asset_import_cache_service_1.AssetImportCacheService,
            asset_list_cache_service_1.AssetListCacheService,
            asset_audit_service_1.AssetAuditService,
            asset_project_access_service_1.AssetProjectAccessService,
            assets_service_1.AssetsService,
            asset_auth_guard_1.AssetJwtGuard,
        ],
    })
], AssetsModule);
