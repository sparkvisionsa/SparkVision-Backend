import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { ClientsMongoService } from "./clients-mongo.service";

@Controller("client-types")
export class ClientTypesController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.clients.listClientTypes(request, query);
  }

  @Post()
  create(@Req() request: Request, @Body() body: { name?: string; productId?: unknown }) {
    return this.clients.createClientType(request, body);
  }

  @Patch(":id")
  update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: { name?: string; productId?: unknown },
  ) {
    return this.clients.updateClientType(request, id, body);
  }

  @Delete(":id")
  remove(@Req() request: Request, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.clients.deleteClientType(request, id, query);
  }
}

@Controller("form-templates")
export class FormTemplatesController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.clients.listFormTemplates(request, query);
  }

  @Post()
  create(
    @Req() request: Request,
    @Body() body: { name?: string; fields?: unknown; productId?: unknown },
  ) {
    return this.clients.createFormTemplate(request, body);
  }

  @Get(":id")
  getOne(@Req() request: Request, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.clients.getFormTemplate(request, id, query);
  }

  @Patch(":id")
  update(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: { name?: string; fields?: unknown; productId?: unknown },
  ) {
    return this.clients.updateFormTemplate(request, id, body);
  }

  @Delete(":id")
  remove(@Req() request: Request, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.clients.deleteFormTemplate(request, id, query);
  }
}

@Controller("clients")
export class ClientsCrudController {
  constructor(private readonly clients: ClientsMongoService) {}

  @Get()
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.clients.listClients(request, query);
  }

  @Post()
  create(@Req() request: Request, @Body() body: Record<string, unknown>) {
    return this.clients.createClient(request, body);
  }

  @Get(":id")
  getOne(@Req() request: Request, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.clients.getClient(request, id, query);
  }

  @Patch(":id")
  update(@Req() request: Request, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.clients.updateClient(request, id, body);
  }

  @Delete(":id")
  remove(@Req() request: Request, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    return this.clients.deleteClient(request, id, query);
  }
}
