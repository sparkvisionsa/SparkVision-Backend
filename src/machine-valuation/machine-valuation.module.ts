import { Module } from "@nestjs/common";
import { MachineValuationController } from "./machine-valuation.controller";
import { MachineValuationService } from "./machine-valuation.service";
import { FileParserService } from "./file-parser.service";
import { DigitalOceanSpacesService } from "./digitalocean-spaces.service";
import { MvRealtimeService } from "./mv-realtime.service";

@Module({
  controllers: [MachineValuationController],
  providers: [MachineValuationService, FileParserService, DigitalOceanSpacesService, MvRealtimeService],
})
export class MachineValuationModule {}
