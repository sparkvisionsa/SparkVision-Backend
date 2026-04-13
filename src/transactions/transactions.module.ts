import { Module } from "@nestjs/common";
import { TransactionsController } from "./transactions-api.controllers";
import { TransactionsMongoService } from "./transactions-mongo.service";

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsMongoService],
})
export class TransactionsModule {}
