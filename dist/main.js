"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const compression_1 = __importDefault(require("compression"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const common_2 = require("@nestjs/common");
const nest_winston_1 = require("nest-winston");
const winston_1 = require("winston");
const app_module_1 = require("./app.module");
const source_indexes_1 = require("./server/source-indexes");
function parseCorsOrigins() {
    const raw = process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
async function bootstrap() {
    const logger = nest_winston_1.WinstonModule.createLogger({
        level: process.env.LOG_LEVEL ?? "info",
        format: winston_1.format.combine(winston_1.format.timestamp(), winston_1.format.errors({ stack: true }), winston_1.format.json()),
        transports: [new winston_1.transports.Console()],
    });
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { logger });
    app.use((0, helmet_1.default)());
    app.use((0, compression_1.default)());
    app.use((0, cookie_parser_1.default)());
    app.enableCors({
        origin: parseCorsOrigins(),
        credentials: true,
    });
    app.setGlobalPrefix("api", {
        exclude: [{ path: "health", method: common_2.RequestMethod.GET }],
    });
    const port = Number(process.env.PORT ?? 5000);
    await app.listen(port);
    (0, source_indexes_1.triggerSourceIndexWarmup)();
    common_1.Logger.log(`Backend listening on http://localhost:${port}`, "Bootstrap");
}
bootstrap();
