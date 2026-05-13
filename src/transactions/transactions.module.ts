import { Module } from "@nestjs/common";
import { TransactionsController } from "./transactions-api.controllers";
import { TransactionsMongoService } from "./transactions-mongo.service";
import { TransactionsMediaController } from "./transactions-media.controller";
import { TransactionsMediaService } from "./transactions-media.service";
import { TransactionsNotesController } from "./transactions-notes.controller";
import { TransactionsNotesService } from "./transactions-notes.service";
import { TransactionsPdfController } from "./transactions-pdf.controller"; // ← add
import { TransactionsPdfService } from "./transactions-pdf.service"; // ← add
import { TransactionsVisionService } from "./transactions-ocr.service";

@Module({
  controllers: [
    TransactionsController,
    TransactionsMediaController,
    TransactionsNotesController,
    TransactionsPdfController, // ← add
  ],
  providers: [
    TransactionsMongoService,
    TransactionsMediaService,
    TransactionsVisionService,
    TransactionsNotesService,
    TransactionsPdfService, // ← add
  ],
})
export class TransactionsModule {}
