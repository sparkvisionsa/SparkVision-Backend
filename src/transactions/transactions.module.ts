import { Module } from "@nestjs/common";
import { TransactionsController } from "./transactions-api.controllers";
import { TransactionsMongoService } from "./transactions-mongo.service";
import { TransactionsMediaController } from "./transactions-media.controller";
import { TransactionsMediaService } from "./transactions-media.service";
import { TransactionsNotesController } from "./transactions-notes.controller"; // ← add
import { TransactionsNotesService } from "./transactions-notes.service"; // ← add

@Module({
  controllers: [
    TransactionsController,
    TransactionsMediaController,
    TransactionsNotesController, // ← add
  ],
  providers: [
    TransactionsMongoService,
    TransactionsMediaService,
    TransactionsNotesService, // ← add
  ],
})
export class TransactionsModule {}
