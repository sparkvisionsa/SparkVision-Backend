import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { resolveRequestContext } from "@/server/auth-tracking/context";
import { DefaultValuesService } from "./default-values.service";

@Controller("company/default-values")
export class DefaultValuesController {
  constructor(private readonly svc: DefaultValuesService) {}

  private async requireCompany(req: Request) {
    const ctx = await resolveRequestContext(req);
    if (!ctx.user || !ctx.company) throw new ForbiddenException();
    return { companyId: ctx.company._id.toString(), user: ctx.user };
  }

  @Get()
  async get(@Req() req: Request, @Query("productId") productId?: string) {
    const { companyId } = await this.requireCompany(req);
    return this.svc.getSettings(companyId, productId);
  }

  @Get("resolved")
  async resolved(@Req() req: Request, @Query("productId") productId?: string) {
    const { companyId } = await this.requireCompany(req);
    return this.svc.getResolved(companyId, productId);
  }

  @Put()
  async save(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Query("productId") productId?: string,
  ) {
    const { companyId } = await this.requireCompany(req);
    // TODO: restrict to company admins / your "settings" permission, same as the Settings page.
    return this.svc.saveSettings(companyId, productId, body);
  }

  @Get("assignment-number/next")
  async next(@Req() req: Request, @Query("productId") productId?: string) {
    const { companyId } = await this.requireCompany(req);
    const value = await this.svc.previewAssignmentNumber(companyId, productId);
    return { value };
  }
}
