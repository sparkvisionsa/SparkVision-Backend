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

const multerStorage = diskStorage({
  destination: join(process.cwd(), "uploads"),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${extname(file.originalname)}`);
  },
});

@Controller("transactions")
export class TransactionsController {
  constructor(private readonly svc: TransactionsMongoService) {}

  @Get()
  list() {
    return this.svc.listTransactions();
  }

  // POST uses multipart/form-data (file uploads from NewTransactionPage)
  @Post()
  @UseInterceptors(AnyFilesInterceptor({ storage: multerStorage }))
  create(@Req() req: Request, @UploadedFiles() files: Express.Multer.File[]) {
    return this.svc.createTransaction(
      req.body as Record<string, string>,
      files ?? [],
    );
  }

  @Get(":id")
  getOne(@Param("id") id: string) {
    return this.svc.getTransaction(id);
  }

  // PATCH uses application/json (evalData update from TransactionEvaluationPage).
  // No file uploads on PATCH — the template attachments are set on creation only.
  @Patch(":id")
  update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.svc.updateTransaction(id, body, []);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.svc.deleteTransaction(id);
  }
}
