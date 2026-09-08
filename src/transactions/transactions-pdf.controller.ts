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
    @Query("format") format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const mode = disposition === "inline" ? "inline" : "attachment";
    const wantsPdf = format === "pdf";

    // If wants HTML, you'll need to handle it differently
    if (!wantsPdf) {
      // You need to implement HTML generation or redirect
      await this.svc.generatePdf(id, res);
          }

    // For PDF, call the existing method
    await this.svc.generatePdf(id, res);
  }
}
