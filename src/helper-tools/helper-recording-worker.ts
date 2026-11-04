import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { HelperToolsRecordingsService } from "./helper-tools-recordings.service";

@Injectable()
export class HelperRecordingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HelperRecordingWorker.name);
  private worker?: Worker;

  constructor(@Inject(HelperToolsRecordingsService) private readonly recordings: HelperToolsRecordingsService) {}

  onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("REDIS_URL must be set to run the recording worker.");
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (attempt) => Math.min(attempt * 1000, 30_000),
    });
    let redisWarningShown = false;
    const reportUnavailable = () => {
      if (redisWarningShown) return;
      redisWarningShown = true;
      this.logger.warn("Redis is unavailable; the recording worker will resume when Redis reconnects.");
    };
    connection.on("error", reportUnavailable);
    connection.on("ready", () => {
      if (redisWarningShown) this.logger.log("Redis reconnected; recording worker is ready.");
      redisWarningShown = false;
    });
    this.worker = new Worker("helper-recording-processing", async (job) => {
      await this.recordings.processRecording(String(job.data.recordingId), job.attemptsMade >= Number(job.opts.attempts ?? 1) - 1);
    }, {
      connection,
      concurrency: Math.max(1, Number(process.env.RECORDING_WORKER_CONCURRENCY) || 1),
    });
    this.worker.on("error", reportUnavailable);
    this.worker.on("failed", (job, error) => this.logger.error(`Recording job ${job?.id ?? "unknown"} failed: ${error.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
