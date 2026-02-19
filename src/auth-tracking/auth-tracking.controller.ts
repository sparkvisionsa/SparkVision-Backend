import { Body, Controller, Get, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { applyContextCookies } from "@/server/auth-tracking/context";
import {
  getSessionSnapshot,
  handleSessionPayload,
  HttpError,
  loginUser,
  logoutUser,
  registerUser,
  submitTrackingActions,
  updateUserProfile,
  getUserProfile,
} from "@/server/auth-tracking/service";

const sessionSchema = z.object({
  eventType: z.enum(["start", "heartbeat", "end"]),
  pageUrl: z.string().max(2000).optional(),
  referrer: z.string().max(2000).optional(),
  localBackupId: z.string().max(200).optional(),
  activeMs: z.number().nonnegative().optional(),
  idleMs: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  fingerprint: z
    .object({
      canvas: z.string().max(500).optional(),
      webgl: z.string().max(500).optional(),
      audio: z.string().max(500).optional(),
      timezone: z.string().max(100).optional(),
      platform: z.string().max(100).optional(),
      language: z.string().max(30).optional(),
      screenResolution: z.string().max(50).optional(),
      deviceMemory: z.string().max(20).optional(),
      hardwareConcurrency: z.string().max(20).optional(),
    })
    .optional(),
});

@Controller()
export class AuthTrackingController {
  @Get("auth/me")
  async getSession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getSessionSnapshot(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("auth/login")
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await loginUser(req, body);
    applyContextCookies(res, result.context, {
      rememberMe: result.rememberMe,
    });
    return {
      user: result.user,
      profile: result.profile,
      guestAccess: result.guestAccess,
    };
  }

  @Post("auth/register")
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await registerUser(req, body);
    applyContextCookies(res, result.context);
    return {
      user: result.user,
      guestAccess: result.guestAccess,
    };
  }

  @Post("auth/logout")
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await logoutUser(req);
    applyContextCookies(res, result.context, { clearSession: true });
    return { success: true };
  }

  @Get("track/session")
  async getTrackingSession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getSessionSnapshot(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("track/session")
  async updateTrackingSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const parsed = sessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError(400, "invalid_payload", "Invalid session payload.", {
        issues: parsed.error.issues,
      });
    }
    const result = await handleSessionPayload(req, parsed.data);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Post("track/action")
  async trackAction(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await submitTrackingActions(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Get("user/profile")
  async getProfile(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await getUserProfile(req);
    applyContextCookies(res, result.context);
    return result.payload;
  }

  @Patch("user/profile")
  async patchProfile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const result = await updateUserProfile(req, body);
    applyContextCookies(res, result.context);
    return result.payload;
  }
}
