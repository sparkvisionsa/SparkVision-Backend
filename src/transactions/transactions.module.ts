import { Module } from "@nestjs/common";
import { DefaultValuesModule } from "../default-values/default-values.module"; // adjust path to where you put the folder
import { TransactionsController } from "./transactions-api.controllers";
import { TransactionsMongoService } from "./transactions-mongo.service";
import { TransactionsMediaController } from "./transactions-media.controller";
import { TransactionsMediaService } from "./transactions-media.service";
import { TransactionsNotesController } from "./transactions-notes.controller";
import { TransactionsNotesService } from "./transactions-notes.service";
import { TransactionsPdfController } from "./transactions-pdf.controller";
import { TransactionsPdfHtmlService } from "./transactions-pdf.service";
import { TransactionsRealEstateReportService } from "./transactions-real-estate-report.service";
import { TransactionsVisionService } from "./transactions-ocr.service";
import { RealEstateReportTemplateController } from "./real-estate-report-template.controller";
import { RealEstateReportTemplateService } from "./real-estate-report-template.service";

@Module({
  imports: [DefaultValuesModule], // ← add this
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
    TransactionsPdfHtmlService,
  ],
})
export class TransactionsModule {}
