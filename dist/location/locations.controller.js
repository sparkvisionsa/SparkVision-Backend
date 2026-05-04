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
exports.LocationsSeedController = exports.NeighborhoodsController = exports.CitiesController = exports.RegionsController = void 0;
const common_1 = require("@nestjs/common");
const locations_service_1 = require("./locations.service");
let RegionsController = class RegionsController {
    constructor(svc) {
        this.svc = svc;
    }
    list() {
        return this.svc.listRegions();
    }
    create(body) {
        return this.svc.createRegion(body);
    }
    update(id, body) {
        return this.svc.updateRegion(id, body);
    }
    remove(id) {
        return this.svc.deleteRegion(id);
    }
};
exports.RegionsController = RegionsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], RegionsController.prototype, "remove", null);
exports.RegionsController = RegionsController = __decorate([
    (0, common_1.Controller)("locations/regions"),
    __metadata("design:paramtypes", [locations_service_1.LocationsService])
], RegionsController);
let CitiesController = class CitiesController {
    constructor(svc) {
        this.svc = svc;
    }
    list(regionId) {
        return this.svc.listCities(regionId);
    }
    create(body) {
        return this.svc.createCity(body);
    }
    update(id, body) {
        return this.svc.updateCity(id, body);
    }
    remove(id) {
        return this.svc.deleteCity(id);
    }
};
exports.CitiesController = CitiesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("regionId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CitiesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], CitiesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CitiesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CitiesController.prototype, "remove", null);
exports.CitiesController = CitiesController = __decorate([
    (0, common_1.Controller)("locations/cities"),
    __metadata("design:paramtypes", [locations_service_1.LocationsService])
], CitiesController);
let NeighborhoodsController = class NeighborhoodsController {
    constructor(svc) {
        this.svc = svc;
    }
    list(regionId, cityId) {
        return this.svc.listNeighborhoods(regionId, cityId);
    }
    create(body) {
        return this.svc.createNeighborhood(body);
    }
    update(id, body) {
        return this.svc.updateNeighborhood(id, body);
    }
    remove(id) {
        return this.svc.deleteNeighborhood(id);
    }
};
exports.NeighborhoodsController = NeighborhoodsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("regionId")),
    __param(1, (0, common_1.Query)("cityId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], NeighborhoodsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NeighborhoodsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], NeighborhoodsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], NeighborhoodsController.prototype, "remove", null);
exports.NeighborhoodsController = NeighborhoodsController = __decorate([
    (0, common_1.Controller)("locations/neighborhoods"),
    __metadata("design:paramtypes", [locations_service_1.LocationsService])
], NeighborhoodsController);
let LocationsSeedController = class LocationsSeedController {
    constructor(svc) {
        this.svc = svc;
    }
    async seed(body) {
        const results = {};
        if (body.regions?.length) {
            results.regions = await this.svc.bulkSeedRegions(body.regions);
        }
        if (body.cities?.length) {
            results.cities = await this.svc.bulkSeedCities(body.cities);
        }
        if (body.neighborhoods?.length) {
            results.neighborhoods = await this.svc.bulkSeedNeighborhoods(body.neighborhoods);
        }
        return results;
    }
};
exports.LocationsSeedController = LocationsSeedController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], LocationsSeedController.prototype, "seed", null);
exports.LocationsSeedController = LocationsSeedController = __decorate([
    (0, common_1.Controller)("locations/seed"),
    __metadata("design:paramtypes", [locations_service_1.LocationsService])
], LocationsSeedController);
