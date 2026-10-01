import { Module } from "@nestjs/common";
import { MachineValuationController } from "./machine-valuation.controller";
import { MachineValuationService } from "./machine-valuation.service";
import { FileParserService } from "./file-parser.service";
import { DigitalOceanSpacesService } from "./digitalocean-spaces.service";
import { MvRealtimeService } from "./mv-realtime.service";
import { WordTemplateMergeService } from "./word-template-merge.service";
import { PptxTemplateMergeService } from "./pptx-template-merge.service";
import { DataExtractionService } from "./data-extraction.service";
import { DataExtractionHistoryService } from "./data-extraction-history.service";
import { AttachmentUploadService } from "./attachment-upload.service";
import { AssetMediaRealtimeService } from "./asset-media-realtime";

@Module({
  controllers: [MachineValuationController],
  providers: [
    MachineValuationService,
    AttachmentUploadService,
    AssetMediaRealtimeService,
    FileParserService,
    DigitalOceanSpacesService,
    MvRealtimeService,
    WordTemplateMergeService,
    PptxTemplateMergeService,
    DataExtractionService,
    DataExtractionHistoryService,
  ],
})
export class MachineValuationModule {}
