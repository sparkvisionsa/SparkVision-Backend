import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";
import { extname, join } from "path";
import { Request } from "express";
import { TransactionsMediaService } from "./transactions-media.service";
import { TransactionsVisionService } from "./transactions-ocr.service";
import { BadRequestException } from "@nestjs/common";

// ─── Shared multer storage (reuse the same uploads/ dir) ─────────────────────
//
//

const multerStorage = diskStorage({
  destination: join(process.cwd(), "uploads"),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("transactions")
export class TransactionsMediaController {
  constructor(
    private readonly svc: TransactionsMediaService,
    private readonly ocr: TransactionsVisionService,
  ) {}

  // ── Edit core fields ────────────────────────────────────────────────────────
  //
  // PUT /transactions/:id/core
  //
  // Accepts JSON: any subset of the editable core fields.
  // Deliberately a separate route from PATCH /transactions/:id so the
  // evalData updater (used by the evaluation page) is never disturbed.
  //
  @Patch(":id/core")
  editCore(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.svc.editCoreFields(id, body);
  }

  // ── Attachments ─────────────────────────────────────────────────────────────

  // GET /transactions/:id/attachments
  @Get(":id/attachments")
  listAttachments(@Param("id") id: string) {
    return this.svc.listAttachments(id);
  }

  // POST /transactions/:id/attachments
  // multipart/form-data
  // Fields:
  //   files[]           — the binary files
  //   names[<original>] — optional display name keyed by original filename
  //                       e.g. names[deed.pdf] = "صك الملكية"
  @Post(":id/attachments")
  @UseInterceptors(AnyFilesInterceptor({ storage: multerStorage }))
  addAttachments(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    const names = this.extractNames(req.body);
    return this.svc.addAttachments(id, files ?? [], names);
  }

  // PATCH /transactions/:id/attachments/:attId
  // JSON: { name: "..." }
  @Patch(":id/attachments/:attId")
  renameAttachment(
    @Param("id") id: string,
    @Param("attId") attId: string,
    @Body("name") name: string,
  ) {
    return this.svc.renameAttachment(id, attId, name ?? "");
  }

  // DELETE /transactions/:id/attachments/:attId
  @Delete(":id/attachments/:attId")
  deleteAttachment(@Param("id") id: string, @Param("attId") attId: string) {
    return this.svc.deleteAttachment(id, attId);
  }

  // DELETE /transactions/:id/attachments
  // JSON: { ids: ["id1", "id2"] }
  @Delete(":id/attachments")
  bulkDeleteAttachments(@Param("id") id: string, @Body("ids") ids: string[]) {
    return this.svc.bulkDeleteAttachments(id, ids ?? []);
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  // GET /transactions/:id/images
  @Get(":id/images")
  listImages(@Param("id") id: string) {
    return this.svc.listImages(id);
  }

  // POST /transactions/:id/images
  // multipart/form-data — same naming convention as attachments
  @Post(":id/images")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: multerStorage,
      fileFilter: (_req, file, cb) => {
        // Accept image/* only
        cb(null, file.mimetype.startsWith("image/"));
      },
    }),
  )
  addImages(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    const names = this.extractNames(req.body);
    return this.svc.addImages(id, files ?? [], names);
  }

  // ✅ MUST be BEFORE :imgId
  @Patch(":id/images/reorder")
  reorderImages(
    @Param("id") id: string,
    @Body("order") order: { id: string; sortIndex: number }[],
  ) {
    return this.svc.reorderImages(id, order ?? []);
  }

  // ✅ AFTER reorder
  @Patch(":id/images/:imgId")
  renameImage(
    @Param("id") id: string,
    @Param("imgId") imgId: string,
    @Body("name") name: string,
  ) {
    return this.svc.renameImage(id, imgId, name ?? "");
  }

  // DELETE /transactions/:id/images/:imgId
  @Delete(":id/images/:imgId")
  deleteImage(@Param("id") id: string, @Param("imgId") imgId: string) {
    return this.svc.deleteImage(id, imgId);
  }

  // DELETE /transactions/:id/images
  // JSON: { ids: ["id1", "id2"] }
  @Delete(":id/images")
  bulkDeleteImages(@Param("id") id: string, @Body("ids") ids: string[]) {
    return this.svc.bulkDeleteImages(id, ids ?? []);
  }

  @Post(":id/ocr")
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: multerStorage,
      fileFilter: (_req, file, cb) => {
        cb(null, file.mimetype.startsWith("image/"));
      },
    }),
  )
  async extractOcr(
    @Param("id") id: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException("لم يتم إرفاق أي صورة");
    }

    const file = files[0];
    const relativePath = `uploads/${file.filename}`;

    return this.ocr.extractFromImage(relativePath);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Extracts the optional display-name map from the multipart body.
   * The frontend sends: names[original.pdf] = "Display Name"
   */
  private extractNames(body: Record<string, unknown>): Record<string, string> {
    const names: Record<string, string> = {};
    const raw = body?.["names"];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "string") names[k] = v;
      }
    }
    return names;
  }
}
