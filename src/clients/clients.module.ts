import { Module } from "@nestjs/common";
import {
  ClientTypesController,
  ClientsCrudController,
  FormTemplatesController,
} from "./clients-api.controllers";
import { ClientsMongoService } from "./clients-mongo.service";

@Module({
  controllers: [ClientTypesController, FormTemplatesController, ClientsCrudController],
  providers: [ClientsMongoService],
})
export class ClientsModule {}
