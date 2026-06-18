import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { applyContextCookies } from "@/server/auth-tracking/context";
import {
  createCompanyBySuperAdmin,
  createCompanyUserByCompanyAdmin,
  deleteCompanyBySuperAdmin,
  deleteCompanyMemberBySuperAdmin,
  deleteCompanyUserByCompanyAdmin,
  getCompanyDetailForSuperAdmin,
  getCurrentCompanyUserSignature,
  getCompanyReportDefaultsForCompanyAdmin,
  getCompanyReportDefaultsForMember,
  listCompaniesForSuperAdmin,
  listCompanyUsersForCompanyAdmin,
  updateCompanyBrandingByCompanyAdmin,
  updateCompanyBySuperAdmin,
  updateCompanyMemberReportSignatureByCompanyAdmin,
  updateCompanyReportDefaultsByCompanyAdmin,
  updateCompanyUserByCompanyAdmin,
} from "@/server/auth-tracking/service";

@Controller()
export class OrganizationController {
  @Get("admin/companies")
  async listCompanies(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await listCompaniesForSuperAdmin(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("admin/companies/:companyId/detail")
  async companyDetail(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("companyId") companyId: string
  ) {
    const result = await getCompanyDetailForSuperAdmin(req, companyId);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("admin/companies")
  async createCompany(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown
  ) {
    const result = await createCompanyBySuperAdmin(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("admin/companies/:companyId")
  async updateCompany(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("companyId") companyId: string,
    @Body() body: unknown
  ) {
    const result = await updateCompanyBySuperAdmin(req, companyId, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("admin/companies/:companyId")
  async deleteCompany(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("companyId") companyId: string
  ) {
    const result = await deleteCompanyBySuperAdmin(req, companyId);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("admin/companies/:companyId/users/:userId")
  async deleteCompanyUser(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("companyId") companyId: string,
    @Param("userId") userId: string
  ) {
    const result = await deleteCompanyMemberBySuperAdmin(req, companyId, userId);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("company/users")
  async listCompanyUsers(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await listCompanyUsersForCompanyAdmin(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("company/report-defaults")
  async companyReportDefaults(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getCompanyReportDefaultsForMember(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/branding")
  async patchCompanyBranding(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown
  ) {
    const result = await updateCompanyBrandingByCompanyAdmin(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("company/admin/report-defaults")
  async companyAdminReportDefaults(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await getCompanyReportDefaultsForCompanyAdmin(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/admin/report-defaults")
  async patchCompanyReportDefaults(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown
  ) {
    const result = await updateCompanyReportDefaultsByCompanyAdmin(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/user-signature")
  async patchCompanyUserSignature(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown
  ) {
    const result = await updateCompanyMemberReportSignatureByCompanyAdmin(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("company/user-signature")
  async getCompanyUserSignature(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getCurrentCompanyUserSignature(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("company/users")
  async createCompanyUser(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown
  ) {
    let payload: unknown = body ?? req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as unknown;
      } catch {
        payload = {};
      }
    }
    const result = await createCompanyUserByCompanyAdmin(req, payload);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/users/:userId")
  async patchCompanyUserAsCompanyAdmin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("userId") userId: string,
    @Body() body: unknown
  ) {
    let payload: unknown = body ?? req.body;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload) as unknown;
      } catch {
        payload = {};
      }
    }
    const result = await updateCompanyUserByCompanyAdmin(req, userId, payload);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/users/:userId")
  async deleteCompanyUserAsCompanyAdmin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("userId") userId: string
  ) {
    const result = await deleteCompanyUserByCompanyAdmin(req, userId);
    applyContextCookies(res, result.context);
    return result.payload;
  }
}
