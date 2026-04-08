import { Module } from "@nestjs/common";
import { MachineValuationController } from "./machine-valuation.controller";
import { MachineValuationService } from "./machine-valuation.service";
import { FileParserService } from "./file-parser.service";

@Module({
  controllers: [MachineValuationController],
  providers: [MachineValuationService, FileParserService],
})
export class MachineValuationModule {}
