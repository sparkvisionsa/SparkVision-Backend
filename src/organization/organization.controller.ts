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
  createCompanyReportOnlySignatory,
  createCompanyUserByCompanyAdmin,
  deleteCompanyBySuperAdmin,
  deleteCompanyMemberBySuperAdmin,
  deleteCompanyReportOnlySignatory,
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
  updateCompanyReportOnlySignatory,
  updateCompanyReportOnlySignatorySignature,
  updateCompanyUserByCompanyAdmin,
} from "@/server/auth-tracking/service";
import {
  createAssetDescription,
  createAssetDescriptionCategory,
  createAssetDescriptionName,
  createAssetDescriptionType,
  deleteAssetDescription,
  deleteAssetDescriptionCategory,
  deleteAssetDescriptionName,
  deleteAssetDescriptionType,
  getCompanyAssetDescriptions,
  updateAssetDescription,
  updateAssetDescriptionCategory,
  updateAssetDescriptionMainImage,
  updateAssetDescriptionName,
  updateAssetDescriptionType,
} from "./asset-descriptions.service";

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

  @Post("company/report-signatories")
  async createReportSignatory(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await createCompanyReportOnlySignatory(req, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/report-signatories/:signatoryId")
  async patchReportSignatory(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("signatoryId") signatoryId: string,
    @Body() body: unknown,
  ) {
    const result = await updateCompanyReportOnlySignatory(req, signatoryId, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/report-signatories/:signatoryId/signature")
  async patchReportSignatorySignature(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("signatoryId") signatoryId: string,
    @Body() body: unknown,
  ) {
    const result = await updateCompanyReportOnlySignatorySignature(
      req,
      signatoryId,
      body ?? req.body,
    );
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/report-signatories/:signatoryId")
  async deleteReportSignatory(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("signatoryId") signatoryId: string,
  ) {
    const result = await deleteCompanyReportOnlySignatory(req, signatoryId);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("company/asset-descriptions")
  async listAssetDescriptions(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getCompanyAssetDescriptions(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("company/asset-descriptions/categories")
  async createAssetDescriptionCategoryRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await createAssetDescriptionCategory(req, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/asset-descriptions/categories/:id")
  async patchAssetDescriptionCategoryRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await updateAssetDescriptionCategory(req, id, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/asset-descriptions/categories/:id")
  async deleteAssetDescriptionCategoryRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const result = await deleteAssetDescriptionCategory(req, id);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("company/asset-descriptions/types")
  async createAssetDescriptionTypeRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await createAssetDescriptionType(req, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/asset-descriptions/types/:id")
  async patchAssetDescriptionTypeRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await updateAssetDescriptionType(req, id, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/asset-descriptions/types/:id")
  async deleteAssetDescriptionTypeRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const result = await deleteAssetDescriptionType(req, id);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("company/asset-descriptions/names")
  async createAssetDescriptionNameRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await createAssetDescriptionName(req, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/asset-descriptions/names/:id")
  async patchAssetDescriptionNameRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await updateAssetDescriptionName(req, id, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/asset-descriptions/names/:id")
  async deleteAssetDescriptionNameRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const result = await deleteAssetDescriptionName(req, id);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("company/asset-descriptions")
  async createAssetDescriptionRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await createAssetDescription(req, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/asset-descriptions/:id")
  async patchAssetDescriptionRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await updateAssetDescription(req, id, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("company/asset-descriptions/:id/main-image")
  async patchAssetDescriptionMainImageRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await updateAssetDescriptionMainImage(req, id, body ?? req.body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete("company/asset-descriptions/:id")
  async deleteAssetDescriptionRoute(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Param("id") id: string,
  ) {
    const result = await deleteAssetDescription(req, id);
    applyContextCookies(res, result.context);
    return result.payload;
  }
}
