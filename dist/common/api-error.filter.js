"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var ApiErrorFilter_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiErrorFilter = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const service_1 = require("../server/auth-tracking/service");
let ApiErrorFilter = ApiErrorFilter_1 = class ApiErrorFilter {
    constructor() {
        this.logger = new common_1.Logger(ApiErrorFilter_1.name);
    }
    catch(exception, host) {
        const response = host.switchToHttp().getResponse();
        if (exception instanceof service_1.HttpError) {
            response.status(exception.status).json({
                error: exception.code,
                message: exception.message,
                ...(exception.details ? { details: exception.details } : {}),
            });
            return;
        }
        if (exception instanceof common_1.HttpException) {
            const status = exception.getStatus();
            const payload = exception.getResponse();
            response.status(status).json(payload);
            return;
        }
        if (exception instanceof zod_1.ZodError) {
            response.status(common_1.HttpStatus.BAD_REQUEST).json({
                error: "invalid_payload",
                message: "Invalid request payload.",
                details: {
                    issues: exception.issues,
                },
            });
            return;
        }
        this.logger.error("Unhandled API error", exception);
        response.status(common_1.HttpStatus.INTERNAL_SERVER_ERROR).json({
            error: "internal_error",
            message: "Unexpected server error.",
        });
    }
};
exports.ApiErrorFilter = ApiErrorFilter;
exports.ApiErrorFilter = ApiErrorFilter = ApiErrorFilter_1 = __decorate([
    (0, common_1.Catch)()
], ApiErrorFilter);
