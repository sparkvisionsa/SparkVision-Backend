import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { TransactionsRealEstateReportService } from "./transactions-real-estate-report.service";

@Controller("transactions")
export class TransactionsPdfController {
  constructor(private readonly svc: TransactionsRealEstateReportService) {}

  @Get(":id/pdf")
  async downloadReport(
    @Param("id") id: string,
    @Query("disposition") disposition: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const mode = disposition === "inline" ? "inline" : "attachment";
    await this.svc.generateReport(id, res, mode);
  }
}
