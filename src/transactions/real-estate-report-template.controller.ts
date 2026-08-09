import {
  Body,
  Controller,
  Delete,
  Get,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { RealEstateReportTemplateService } from "./real-estate-report-template.service";
import {
  applyContextCookies,
  resolveRequestContext,
} from "@/server/auth-tracking/context";

/**
 * قالب Word للتقارير العقارية (transactions).
 * منفصل تماماً عن قالب تقييم الآلات (machine-valuation report-defaults) —
 * الشركة نفسها مشتركة، لكن كل منتج له slot قالب مستقل حتى لا يتم استبدال
 * أحدهما بالآخر عن طريق الخطأ.
 */
@Controller("company/real-estate-report-template")
export class RealEstateReportTemplateController {
  constructor(private readonly svc: RealEstateReportTemplateService) {}

  @Get()
  async getTemplate(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const template = await this.svc.getTemplate(context);
    return { template };
  }

  @Put()
  async upsertTemplate(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { fileName?: string; fileDataUrl?: string; sizeBytes?: number },
  ) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    const template = await this.svc.upsertTemplate(context, body);
    return { template };
  }

  @Delete()
  async deleteTemplate(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const context = await resolveRequestContext(req);
    applyContextCookies(res, context);
    await this.svc.deleteTemplate(context);
    return { deleted: true };
  }
}
