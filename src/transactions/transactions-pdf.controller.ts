import { Controller, Get, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { TransactionsPdfService } from "./transactions-pdf.service";

@Controller("transactions")
export class TransactionsPdfController {
  constructor(private readonly svc: TransactionsPdfService) {}

  /**
   * GET /transactions/:id/pdf
   * Streams a PDF valuation report directly to the browser.
   * The client sets: window.open(`/api/transactions/${id}/pdf`)
   * or uses an <a href=...> with download attribute.
   */
  @Get(":id/pdf")
  async downloadPdf(
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.svc.generatePdf(id, res);
  }
}
