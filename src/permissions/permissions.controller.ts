import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { applyContextCookies } from "@/server/auth-tracking/context";
import {
  createPermissionProfile,
  deletePermissionProfile,
  getMyEffectivePermissions,
  listPermissionProfiles,
  updatePermissionProfile,
  updateUserPermissionAssignment,
} from "./permissions.service";

@Controller("company/permissions")
export class PermissionsController {
  @Get()
  async list(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await listPermissionProfiles(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("effective")
  async effective(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getMyEffectivePermissions(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post()
  async create(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown) {
    const result = await createPermissionProfile(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch(":id")
  async update(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id") id: string, @Body() body: unknown) {
    const result = await updatePermissionProfile(req, id, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Delete(":id")
  async remove(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("id") id: string) {
    const result = await deletePermissionProfile(req, id);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Put("users/:userId")
  async assign(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Param("userId") userId: string, @Body() body: unknown) {
    const result = await updateUserPermissionAssignment(req, userId, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }
}

