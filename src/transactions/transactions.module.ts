import { Module } from "@nestjs/common";
import { TransactionsController } from "./transactions-api.controllers";
import { TransactionsMongoService } from "./transactions-mongo.service";
import { TransactionsMediaController } from "./transactions-media.controller";
import { TransactionsMediaService } from "./transactions-media.service";
import { TransactionsNotesController } from "./transactions-notes.controller";
import { TransactionsNotesService } from "./transactions-notes.service";
import { TransactionsPdfController } from "./transactions-pdf.controller";
import { TransactionsRealEstateReportService } from "./transactions-real-estate-report.service";
import { TransactionsVisionService } from "./transactions-ocr.service";
import { RealEstateReportTemplateController } from "./real-estate-report-template.controller";
import { RealEstateReportTemplateService } from "./real-estate-report-template.service";

@Module({
  controllers: [
    TransactionsController,
    TransactionsMediaController,
    TransactionsNotesController,
    TransactionsPdfController,
    RealEstateReportTemplateController,
  ],
  providers: [
    TransactionsMongoService,
    TransactionsMediaService,
    TransactionsVisionService,
    TransactionsNotesService,
    TransactionsRealEstateReportService,
    RealEstateReportTemplateService,
  ],
})
export class TransactionsModule {}
