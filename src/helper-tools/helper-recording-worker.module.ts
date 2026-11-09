import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { DigitalOceanSpacesService } from "@/machine-valuation/digitalocean-spaces.service";
import { HelperToolsRecordingsService } from "./helper-tools-recordings.service";
import { HelperRecordingWorker } from "./helper-recording-worker";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [".env.local", ".env"] })],
  providers: [DigitalOceanSpacesService, HelperToolsRecordingsService, HelperRecordingWorker],
})
export class HelperRecordingWorkerModule {}
