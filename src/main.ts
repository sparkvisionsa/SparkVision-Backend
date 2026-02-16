import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { WinstonModule } from "nest-winston";
import { format, transports } from "winston";
import { AppModule } from "./app.module";
import { triggerSourceIndexWarmup } from "./server/source-indexes";

function parseCorsOrigins() {
  const raw = process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    transports: [new transports.Console()],
  });

  const app = await NestFactory.create(AppModule, { logger });

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: parseCorsOrigins(),
    credentials: true,
  });

  app.setGlobalPrefix("api", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });

  const port = Number(process.env.PORT ?? 5000);
  await app.listen(port);
  triggerSourceIndexWarmup();
  Logger.log(`Backend listening on http://localhost:${port}`, "Bootstrap");
}

bootstrap();
