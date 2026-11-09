const moduleAlias = require("module-alias") as typeof import("module-alias");
moduleAlias.addAlias("@", __dirname.replace(/[\\/]helper-tools$/, ""));

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { HelperRecordingWorkerModule } from "./helper-recording-worker.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(HelperRecordingWorkerModule, { logger: ["error", "warn", "log"] });
  const logger = new Logger("HelperRecordingWorker");
  logger.log("Screen recording worker is running.");
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void bootstrap();
