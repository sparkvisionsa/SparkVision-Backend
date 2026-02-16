import { Body, Controller, Get, Patch, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { applyContextCookies } from "@/server/auth-tracking/context";
import {
  getAdminAnalytics,
  getAdminConfigPayload,
  listAdminActivities,
  listAdminUsers,
  updateAdminConfigPayload,
  updateAdminUserState,
} from "@/server/auth-tracking/service";

@Controller()
export class AdminController {
  @Get("admin/analytics")
  async analytics(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getAdminAnalytics(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("admin/config")
  async config(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getAdminConfigPayload(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Put("admin/config")
  async updateConfig(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await updateAdminConfigPayload(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("admin/users")
  async users(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await listAdminUsers(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("admin/users")
  async updateUserState(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await updateAdminUserState(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("admin/activities")
  async activities(@Req() req: Request, @Res() res: Response) {
    const result = await listAdminActivities(req);
    const format = typeof req.query.format === "string" ? req.query.format : undefined;

    applyContextCookies(res, result.context);

    if (format === "csv" || format === "excel") {
      const filename =
        format === "excel" ? "spark-vision-activities.xlsx.csv" : "spark-vision-activities.csv";
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      res.status(200).send(result.payload as string);
      return;
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"spark-vision-activities.pdf.txt\"");
      res.status(200).send(result.payload as string);
      return;
    }

    res.status(200).json(result.payload);
  }
}
