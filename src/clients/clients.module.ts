import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  ClientTypesController,
  ClientsCrudController,
  FormTemplatesController,
} from "./clients-api.controllers";
import { ClientsMongoService } from "./clients-mongo.service";
import { Client, ClientSchema } from "./schemas/client.schema";
import { ClientType, ClientTypeSchema } from "./schemas/client-type.schema";
import { FormTemplate, FormTemplateSchema } from "./schemas/form-template.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClientType.name, schema: ClientTypeSchema },
      { name: FormTemplate.name, schema: FormTemplateSchema },
      { name: Client.name, schema: ClientSchema },
    ]),
  ],
  controllers: [ClientTypesController, FormTemplatesController, ClientsCrudController],
  providers: [ClientsMongoService],
})
export class ClientsModule {}
