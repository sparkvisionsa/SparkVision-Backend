import { Module } from "@nestjs/common";
import { HelperToolsAuthGuard } from "./helper-tools-auth";
import { HelperToolsController } from "./helper-tools.controller";
import { HelperToolsRecordingsService } from "./helper-tools-recordings.service";
import { HelperPdfsController } from "./helper-pdfs.controller";
import { HelperPdfsService } from "./helper-pdfs.service";
import { DigitalOceanSpacesService } from "@/machine-valuation/digitalocean-spaces.service";
import { HelperRecordingWorker } from "./helper-recording-worker";

@Module({
  controllers: [HelperToolsController, HelperPdfsController],
  providers: [HelperToolsRecordingsService, HelperPdfsService, HelperToolsAuthGuard, DigitalOceanSpacesService, HelperRecordingWorker],
})
export class HelperToolsModule {}
