import { Controller, Get, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { TransactionsRealEstateReportService } from "./transactions-real-estate-report.service";

@Controller("transactions")
export class TransactionsPdfController {
  constructor(private readonly svc: TransactionsRealEstateReportService) {}

  /**
   * GET /transactions/:id/pdf
   *
   * Historically streamed a PDF built by the old pdf-worker/generate_pdf.py.
   * Now streams a .docx built from the company's real-estate Word template
   * (word-worker/merge_real_estate_docx.py). Route path kept as-is so the
   * frontend doesn't need to change; response content-type/disposition now
   * reflect the .docx output.
   *
   * The client sets: window.open(`/api/transactions/${id}/pdf`)
   * or uses an <a href=...> with download attribute.
   */
  @Get(":id/pdf")
  async downloadReport(
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.svc.generateReport(id, res);
  }
}
