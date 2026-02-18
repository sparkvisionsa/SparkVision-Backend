"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourcesController = void 0;
const common_1 = require("@nestjs/common");
const query_utils_1 = require("../common/query-utils");
const carsSourceController_1 = require("../server/controllers/carsSourceController");
const harajScrapeController_1 = require("../server/controllers/harajScrapeController");
const yallaMotorController_1 = require("../server/controllers/yallaMotorController");
const syarahController_1 = require("../server/controllers/syarahController");
const context_1 = require("../server/auth-tracking/context");
const service_1 = require("../server/auth-tracking/service");
function parseFields(value) {
    return value === "options" || value === "modelYears" ? value : undefined;
}
function parseCountMode(value) {
    return value === "none" ? "none" : "exact";
}
function parseHarajLikeQuery(req) {
    return {
        search: (0, query_utils_1.readQueryString)(req, "search"),
        exactSearch: (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "exactSearch")) ??
            (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "match")),
        city: (0, query_utils_1.readQueryString)(req, "city"),
        minPrice: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "minPrice")),
        maxPrice: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "maxPrice")),
        hasImage: (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "hasImage")),
        hasPrice: (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "hasPrice")),
        hasComments: (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "hasComments")),
        hasMileage: (0, query_utils_1.parseBoolean)((0, query_utils_1.readQueryString)(req, "hasMileage")),
        dateFrom: (0, query_utils_1.readQueryString)(req, "dateFrom"),
        dateTo: (0, query_utils_1.readQueryString)(req, "dateTo"),
        sort: (0, query_utils_1.readQueryString)(req, "sort"),
        page: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "page")),
        limit: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "limit")),
        tag0: (0, query_utils_1.readQueryString)(req, "tag0"),
        tag1: (0, query_utils_1.readQueryString)(req, "tag1"),
        tag2: (0, query_utils_1.readQueryString)(req, "tag2"),
        carModelYear: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "carModelYear")),
        mileage: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "mileage")),
        mileageMin: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "mileageMin")),
        mileageMax: (0, query_utils_1.parseNumber)((0, query_utils_1.readQueryString)(req, "mileageMax")),
        excludeTag1: (0, query_utils_1.readQueryString)(req, "excludeTag1"),
        fields: parseFields((0, query_utils_1.readQueryString)(req, "fields")),
        countMode: parseCountMode((0, query_utils_1.readQueryString)(req, "countMode")),
    };
}
function parseCarsSourcesQuery(req) {
    return {
        ...parseHarajLikeQuery(req),
        sources: (0, query_utils_1.parseSources)((0, query_utils_1.readQueryString)(req, "sources")),
    };
}
function parseSyarahQuery(req) {
    return parseHarajLikeQuery(req);
}
let SourcesController = class SourcesController {
    async listCarsSourcesRoute(req, res) {
        const fields = (0, query_utils_1.readQueryString)(req, "fields");
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: fields !== "options" && fields !== "modelYears",
            attemptReason: "cars_sources_query",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        return (0, carsSourceController_1.listCarsSources)(parseCarsSourcesQuery(req));
    }
    async listHarajScrapesRoute(req, res) {
        const fields = (0, query_utils_1.readQueryString)(req, "fields");
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: fields !== "options" && fields !== "modelYears",
            attemptReason: "haraj_query",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        return (0, harajScrapeController_1.listHarajScrapes)(parseHarajLikeQuery(req));
    }
    async getHarajScrapeByIdRoute(id, req, res) {
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: false,
            attemptReason: "haraj_detail",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        const doc = await (0, harajScrapeController_1.getHarajScrapeById)(id);
        if (!doc) {
            res.status(404);
            return { error: "Not found" };
        }
        return doc;
    }
    async listYallaMotorsRoute(req, res) {
        const fields = (0, query_utils_1.readQueryString)(req, "fields");
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: fields !== "options" && fields !== "modelYears",
            attemptReason: "yallamotor_query",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        return (0, yallaMotorController_1.listYallaMotors)(parseHarajLikeQuery(req));
    }
    async getYallaMotorByIdRoute(id, req, res) {
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: false,
            attemptReason: "yallamotor_detail",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        const doc = await (0, yallaMotorController_1.getYallaMotorById)(id);
        if (!doc) {
            res.status(404);
            return { error: "Not found" };
        }
        return doc;
    }
    async listSyarahsRoute(req, res) {
        const fields = (0, query_utils_1.readQueryString)(req, "fields");
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: fields !== "options" && fields !== "modelYears",
            attemptReason: "syarah_query",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        return (0, syarahController_1.listSyarahs)(parseSyarahQuery(req));
    }
    async getSyarahByIdRoute(id, req, res) {
        const guard = await (0, service_1.enforceGuestAccess)(req, {
            incrementAttempt: false,
            attemptReason: "syarah_detail",
        });
        (0, context_1.applyContextCookies)(res, guard.context);
        const doc = await (0, syarahController_1.getSyarahById)(id);
        if (!doc) {
            res.status(404);
            return { error: "Not found" };
        }
        return doc;
    }
};
exports.SourcesController = SourcesController;
__decorate([
    (0, common_1.Get)("cars-sources"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "listCarsSourcesRoute", null);
__decorate([
    (0, common_1.Get)("haraj-scrape"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "listHarajScrapesRoute", null);
__decorate([
    (0, common_1.Get)("haraj-scrape/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "getHarajScrapeByIdRoute", null);
__decorate([
    (0, common_1.Get)("yallamotor-scrape"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "listYallaMotorsRoute", null);
__decorate([
    (0, common_1.Get)("yallamotor-scrape/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "getYallaMotorByIdRoute", null);
__decorate([
    (0, common_1.Get)("syarah-scrape"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "listSyarahsRoute", null);
__decorate([
    (0, common_1.Get)("syarah-scrape/:id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "getSyarahByIdRoute", null);
exports.SourcesController = SourcesController = __decorate([
    (0, common_1.Controller)()
], SourcesController);
