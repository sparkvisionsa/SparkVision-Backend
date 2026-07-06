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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateBlankImportRowDto = exports.RenameImportSheetDto = exports.DeleteAssetColumnQueryDto = exports.RenameSheetColumnDto = exports.AddAssetColumnDto = exports.DeleteImportSheetQueryDto = exports.BulkDeleteAssetsDto = exports.BulkReassignAssetTypeDto = exports.BulkUpdateAssetsDto = exports.UpdateAssetDto = exports.ExportAssetsQueryDto = exports.ListAssetsQueryDto = exports.ListAssetImportsQueryDto = exports.ImportAssetsBodyDto = void 0;
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const ASSET_TYPES = [
    "vehicles",
    "machinery",
    "electronics",
    "furniture",
    "other",
];
const SORT_ORDERS = ["asc", "desc"];
const EXPORT_FORMATS = ["xlsx"];
const COLUMN_TYPES = ["text", "number", "date", "boolean"];
class ImportAssetsBodyDto {
}
exports.ImportAssetsBodyDto = ImportAssetsBodyDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ImportAssetsBodyDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], ImportAssetsBodyDto.prototype, "sourceFileNameUtf8", void 0);
class ListAssetImportsQueryDto {
}
exports.ListAssetImportsQueryDto = ListAssetImportsQueryDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ListAssetImportsQueryDto.prototype, "projectId", void 0);
class ListAssetsQueryDto {
    constructor() {
        this.page = 1;
        this.limit = 50;
    }
}
exports.ListAssetsQueryDto = ListAssetsQueryDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "sheetName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "assetType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "sortBy", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(SORT_ORDERS),
    __metadata("design:type", Object)
], ListAssetsQueryDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value === true || value === "true" || value === "1" || value === 1),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], ListAssetsQueryDto.prototype, "sheetColumns", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], ListAssetsQueryDto.prototype, "schemaAssetType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], ListAssetsQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Object)
], ListAssetsQueryDto.prototype, "limit", void 0);
class ExportAssetsQueryDto {
}
exports.ExportAssetsQueryDto = ExportAssetsQueryDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], ExportAssetsQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], ExportAssetsQueryDto.prototype, "assetType", void 0);
__decorate([
    (0, class_validator_1.IsIn)(EXPORT_FORMATS),
    __metadata("design:type", String)
], ExportAssetsQueryDto.prototype, "format", void 0);
class UpdateAssetDto {
}
exports.UpdateAssetDto = UpdateAssetDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], UpdateAssetDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsNotEmptyObject)(),
    __metadata("design:type", Object)
], UpdateAssetDto.prototype, "changes", void 0);
class BulkUpdateAssetsDto {
}
exports.BulkUpdateAssetsDto = BulkUpdateAssetsDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], BulkUpdateAssetsDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(200),
    (0, class_validator_1.IsMongoId)({ each: true }),
    __metadata("design:type", Array)
], BulkUpdateAssetsDto.prototype, "assetIds", void 0);
__decorate([
    (0, class_validator_1.IsObject)(),
    (0, class_validator_1.IsNotEmptyObject)(),
    __metadata("design:type", Object)
], BulkUpdateAssetsDto.prototype, "changes", void 0);
class BulkReassignAssetTypeDto {
}
exports.BulkReassignAssetTypeDto = BulkReassignAssetTypeDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], BulkReassignAssetTypeDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(2000),
    (0, class_validator_1.IsMongoId)({ each: true }),
    __metadata("design:type", Array)
], BulkReassignAssetTypeDto.prototype, "assetIds", void 0);
__decorate([
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], BulkReassignAssetTypeDto.prototype, "assetType", void 0);
class BulkDeleteAssetsDto {
}
exports.BulkDeleteAssetsDto = BulkDeleteAssetsDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], BulkDeleteAssetsDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ArrayMaxSize)(200),
    (0, class_validator_1.IsMongoId)({ each: true }),
    __metadata("design:type", Array)
], BulkDeleteAssetsDto.prototype, "assetIds", void 0);
class DeleteImportSheetQueryDto {
}
exports.DeleteImportSheetQueryDto = DeleteImportSheetQueryDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], DeleteImportSheetQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], DeleteImportSheetQueryDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], DeleteImportSheetQueryDto.prototype, "sheetName", void 0);
class AddAssetColumnDto {
}
exports.AddAssetColumnDto = AddAssetColumnDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "assetType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "columnName", void 0);
__decorate([
    (0, class_validator_1.IsIn)(COLUMN_TYPES),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "columnType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], AddAssetColumnDto.prototype, "sheetName", void 0);
class RenameSheetColumnDto {
}
exports.RenameSheetColumnDto = RenameSheetColumnDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "assetType", void 0);
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "sheetName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(500),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "fieldKey", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], RenameSheetColumnDto.prototype, "newLabel", void 0);
class DeleteAssetColumnQueryDto {
}
exports.DeleteAssetColumnQueryDto = DeleteAssetColumnQueryDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], DeleteAssetColumnQueryDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsIn)(ASSET_TYPES),
    __metadata("design:type", String)
], DeleteAssetColumnQueryDto.prototype, "assetType", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], DeleteAssetColumnQueryDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], DeleteAssetColumnQueryDto.prototype, "sheetName", void 0);
class RenameImportSheetDto {
}
exports.RenameImportSheetDto = RenameImportSheetDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], RenameImportSheetDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], RenameImportSheetDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RenameImportSheetDto.prototype, "oldSheetName", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], RenameImportSheetDto.prototype, "newSheetName", void 0);
class CreateBlankImportRowDto {
}
exports.CreateBlankImportRowDto = CreateBlankImportRowDto;
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], CreateBlankImportRowDto.prototype, "projectId", void 0);
__decorate([
    (0, class_validator_1.IsMongoId)(),
    __metadata("design:type", String)
], CreateBlankImportRowDto.prototype, "importId", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(200),
    __metadata("design:type", String)
], CreateBlankImportRowDto.prototype, "sheetName", void 0);
