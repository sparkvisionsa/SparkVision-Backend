import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { TransactionsPdfHtmlService } from "./transactions-pdf.service";

@Controller("transactions")
export class TransactionsPdfController {
  constructor(private readonly svc: TransactionsPdfHtmlService) {}

  @Get(":id/pdf")
  async downloadReport(
    @Param("id") id: string,
    @Query("disposition") disposition: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const mode = disposition === "inline" ? "inline" : "attachment";
    await this.svc.generatePdf(id, res, mode);
  }
}
