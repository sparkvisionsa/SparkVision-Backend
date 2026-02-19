import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "@/server/auth-tracking/service";

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpError) {
      response.status(exception.status).json({
        error: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      response.status(status).json(payload);
      return;
    }

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        error: "invalid_payload",
        message: "Invalid request payload.",
        details: {
          issues: exception.issues,
        },
      });
      return;
    }

    this.logger.error("Unhandled API error", exception as Error);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: "internal_error",
      message: "Unexpected server error.",
    });
  }
}
