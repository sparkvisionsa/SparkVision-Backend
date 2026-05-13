import "./register-path-aliases";
import compression from "compression";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RequestMethod } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { WinstonModule } from "nest-winston";
import { format, transports } from "winston";
import { AppModule } from "./app.module";
import { triggerSourceIndexWarmup } from "./server/source-indexes";
import { join } from "path";

function parseCorsOrigins() {
  const raw =
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_ORIGIN ??
    "http://localhost:3000";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const logger = WinstonModule.createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.json(),
    ),
    transports: [new transports.Console()],
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
  });
  app.useBodyParser("json", { limit: "100mb" });
  app.useBodyParser("urlencoded", { limit: "100mb", extended: true });

<<<<<<< HEAD
  app.use(helmet());
  /** تعطيل ضغط الاستجابة لبث GridFS/إعادة توجيه الملفات — يتجنب تلف الملفات الثنائية ويعمل مع الوكيل. */
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const path = String(req.originalUrl || req.url || "")
      .split("?")[0]
      .toLowerCase();
    if (path.includes("/inspectorfiles/") && path.includes("/download")) {
      req.headers["x-no-compression"] = "true";
    }
    next();
  });
=======
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      crossOriginOpenerPolicy: { policy: "unsafe-none" },
      crossOriginEmbedderPolicy: false,
    }),
  );
>>>>>>> 2121466ef76411d7264141305fc6471690b9511c
  app.use(compression());
  app.use(cookieParser());

  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads",
    setHeaders: (res, path) => {
      if (path.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
      }
    },
  });

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
