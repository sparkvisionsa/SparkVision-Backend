import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import type { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { decodeUploadFilename } from "@/machine-valuation/sheet-rows.util";
import { ASSET_IMPORT_MAX_FILE_BYTES } from "./asset-import.constants";
import { AssetImportService, isAssetImportMultipartAllowed } from "./asset-import.service";
import { AssetJwtGuard, type AssetAuthenticatedRequest } from "./asset-auth.guard";
import { AssetsService } from "./assets.service";
import {
  AddAssetColumnDto,
  BulkDeleteAssetsDto,
  BulkReassignAssetTypeDto,
  BulkUpdateAssetsDto,
  CreateBlankImportRowDto,
  DeleteAssetColumnQueryDto,
  DeleteImportSheetQueryDto,
  ExportAssetsQueryDto,
  RenameImportSheetDto,
  RenameSheetColumnDto,
  ImportAssetsBodyDto,
  ListAssetImportsQueryDto,
  ListAssetsQueryDto,
  UpdateAssetDto,
} from "./dto/assets.dto";

@Controller("assets")
@UseGuards(AssetJwtGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
  }),
)
export class AssetsController {
  constructor(
    private readonly assetImportService: AssetImportService,
    private readonly assetsService: AssetsService,
  ) {}

  @Post("import")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: ASSET_IMPORT_MAX_FILE_BYTES,
      },
      fileFilter: (_, file, callback) => {
        if (!isAssetImportMultipartAllowed(file.mimetype, file.originalname || "")) {
          callback(
            new BadRequestException(
              "نوع الملف أو الامتداد غير مدعوم. استخدم XLSX أو XLSM أو XLS أو CSV. إذا كان الامتداد صحيحاً وما زال يرفض، جرّب متصفحاً آخر أو أعد تسمية الملف بالإنجليزية.",
            ) as Error,
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importAssets(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ImportAssetsBodyDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    if (!file || !request.assetUser) {
      throw new BadRequestException("ملف الاستيراد مطلوب.");
    }

    const originalName =
      body.sourceFileNameUtf8 && body.sourceFileNameUtf8.length > 0
        ? body.sourceFileNameUtf8
        : decodeUploadFilename(file.originalname || "");

    return this.assetImportService.importFile({
      projectId: body.projectId,
      buffer: file.buffer,
      originalName,
      mimeType: file.mimetype,
      user: request.assetUser,
      activeCompanyId: request.assetActiveCompanyId ?? null,
    });
  }

  @Get("imports")
  async listAssetImports(
    @Query() query: ListAssetImportsQueryDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.listAssetImports(
      query,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Get()
  async listAssets(
    @Query() query: ListAssetsQueryDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.listAssets(query, request.assetUser!, request.assetActiveCompanyId ?? null);
  }

  @Post("rows")
  async createBlankImportRow(
    @Body() body: CreateBlankImportRowDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.createBlankImportRow(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Patch("rename-sheet")
  async renameSheet(
    @Body() body: RenameImportSheetDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.renameImportSheet(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Patch("bulk/asset-type")
  async bulkReassignAssetType(
    @Body() body: BulkReassignAssetTypeDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.bulkReassignAssetType(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Patch("bulk")
  async bulkUpdateAssets(
    @Body() body: BulkUpdateAssetsDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.bulkUpdateAssets(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Patch(":id")
  async updateAsset(
    @Param("id") id: string,
    @Body() body: UpdateAssetDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.updateAsset(
      id,
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Delete("bulk")
  async bulkDeleteAssets(
    @Body() body: BulkDeleteAssetsDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.bulkDeleteAssets(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Delete("import-sheet")
  async deleteImportSheet(
    @Query() query: DeleteImportSheetQueryDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.deleteImportSheet(
      query,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Delete("columns/:columnName")
  async deleteColumn(
    @Param("columnName") columnName: string,
    @Query() query: DeleteAssetColumnQueryDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.deleteColumn(
      columnName,
      query,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Delete(":id")
  async deleteAsset(
    @Param("id") id: string,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.deleteAsset(id, request.assetUser!, request.assetActiveCompanyId ?? null);
  }

  @Post("columns/add")
  async addColumn(
    @Body() body: AddAssetColumnDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.addColumn(body, request.assetUser!, request.assetActiveCompanyId ?? null);
  }

  @Patch("columns/rename")
  async renameSheetColumn(
    @Body() body: RenameSheetColumnDto,
    @Req() request: AssetAuthenticatedRequest,
  ) {
    return this.assetsService.renameSheetColumn(
      body,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
  }

  @Get("export")
  async exportAssets(
    @Query() query: ExportAssetsQueryDto,
    @Req() request: AssetAuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const buffer = await this.assetsService.exportAssets(
      query,
      request.assetUser!,
      request.assetActiveCompanyId ?? null,
    );
    const fileName = query.assetType
      ? `assets-${query.assetType}-${query.projectId}.xlsx`
      : `assets-${query.projectId}.xlsx`;

    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );

    return buffer;
  }
}
