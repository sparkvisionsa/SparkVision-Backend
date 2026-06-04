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
import { TransactionsMongoService } from "./transactions-mongo.service";
import { resolveRequestContext } from "@/server/auth-tracking/context";

const multerStorage = diskStorage({
  destination: join(process.cwd(), "uploads"),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

async function resolveSessionMeta(req: Request): Promise<{
  createdByUserId: string | null;
  companyId: string | null;
}> {
  try {
    const context = await resolveRequestContext(req);
    return {
      createdByUserId: context.user?._id.toString() ?? null,
      companyId: context.company?._id.toString() ?? null,
    };
  } catch {
    return { createdByUserId: null, companyId: null };
  }
}

@Controller("transactions")
export class TransactionsController {
  constructor(private readonly svc: TransactionsMongoService) {}

  @Get()
  async list(@Req() req: Request) {
    const { companyId } = await resolveSessionMeta(req);

    let userId: string | null = null;
    let userRole: string | null = null;
    try {
      const context = await resolveRequestContext(req);
      userId = context.user?._id.toString() ?? null;
      userRole = context.user?.role ?? null;
    } catch {}

    return this.svc.listTransactions(
      companyId,
      userRole === "inspector" ? userId : null,
    );
  }

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ storage: multerStorage }))
  async create(
    @Req() req: Request,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const meta = await resolveSessionMeta(req);
    return this.svc.createTransaction(
      req.body as Record<string, string>,
      files ?? [],
      meta,
    );
  }

  @Patch(":id/completed")
  setCompleted(
    @Param("id") id: string,
    @Body() body: { isCompleted: boolean },
  ) {
    return this.svc.setCompleted(id, body.isCompleted ?? false);
  }

  @Get("freelance-inspectors")
  listFreelanceInspectors() {
    return this.svc.listFreelanceInspectors();
  }

  @Get(":id")
  async getOne(@Param("id") id: string, @Req() req: Request) {
    const { createdByUserId, companyId } = await resolveSessionMeta(req);
    // Resolve role from request context
    let userRole: string | null = null;
    try {
      const context = await resolveRequestContext(req);
      userRole = context.user?.role ?? null;
    } catch {}
    return this.svc.getTransaction(id, userRole === "inspector");
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.svc.updateTransaction(id, body, []);
  }

  @Patch(":id/inspectors")
  assignInspectors(
    @Param("id") id: string,
    @Body() body: { inspectorIds?: string[] },
  ) {
    return this.svc.assignInspectors(id, body.inspectorIds ?? []);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.deleteTransaction(id);
  }
}
