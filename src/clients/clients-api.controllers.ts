import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { ClientsMongoService } from "./clients-mongo.service";

@Controller("client-types")
export class ClientTypesController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list() {
    return this.clients.listClientTypes();
  }

  @Post()
  create(@Body() body: { name?: string }) {
    return this.clients.createClientType(body.name ?? "");
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { name?: string }) {
    return this.clients.updateClientType(id, body.name ?? "");
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.clients.deleteClientType(id);
  }
}

@Controller("form-templates")
export class FormTemplatesController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list() {
    return this.clients.listFormTemplates();
  }

  @Post()
  create(@Body() body: { name?: string; fields?: unknown }) {
    return this.clients.createFormTemplate(body);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.clients.getFormTemplate(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { name?: string; fields?: unknown }) {
    return this.clients.updateFormTemplate(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.clients.deleteFormTemplate(id);
  }
}

@Controller("clients")
export class ClientsCrudController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list() {
    return this.clients.listClients();
  }

  @Post()
  create(@Body() body: Record<string, unknown>) {
    return this.clients.createClient(body);
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.clients.getClient(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.clients.updateClient(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.clients.deleteClient(id);
  }
}
