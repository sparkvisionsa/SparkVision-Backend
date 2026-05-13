import { Module } from "@nestjs/common";
import { AssetsController } from "./assets.controller";
import { AssetImportService } from "./asset-import.service";
import { AssetImportCacheService } from "./asset-import-cache.service";
import { AssetsService } from "./assets.service";
import { AssetListCacheService } from "./asset-list-cache.service";
import { AssetAuditService } from "./asset-audit.service";
import { AssetProjectAccessService } from "./asset-project-access.service";
import { AssetJwtGuard } from "./asset-auth.guard";

@Module({
  controllers: [AssetsController],
  providers: [
    AssetImportService,
    AssetImportCacheService,
    AssetListCacheService,
    AssetAuditService,
    AssetProjectAccessService,
    AssetsService,
    AssetJwtGuard,
  ],
})
export class AssetsModule {}
