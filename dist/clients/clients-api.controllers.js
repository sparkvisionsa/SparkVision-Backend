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
exports.ClientsCrudController = exports.FormTemplatesController = exports.ClientTypesController = void 0;
const common_1 = require("@nestjs/common");
const clients_mongo_service_1 = require("./clients-mongo.service");
let ClientTypesController = class ClientTypesController {
    constructor(clients) {
        this.clients = clients;
    }
    list(request, query) {
        return this.clients.listClientTypes(request, query);
    }
    create(request, body) {
        return this.clients.createClientType(request, body);
    }
    update(request, id, body) {
        return this.clients.updateClientType(request, id, body);
    }
    remove(request, id, query) {
        return this.clients.deleteClientType(request, id, query);
    }
};
exports.ClientTypesController = ClientTypesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ClientTypesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ClientTypesController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClientTypesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClientTypesController.prototype, "remove", null);
exports.ClientTypesController = ClientTypesController = __decorate([
    (0, common_1.Controller)("client-types"),
    __metadata("design:paramtypes", [clients_mongo_service_1.ClientsMongoService])
], ClientTypesController);
let FormTemplatesController = class FormTemplatesController {
    constructor(clients) {
        this.clients = clients;
    }
    list(request, query) {
        return this.clients.listFormTemplates(request, query);
    }
    create(request, body) {
        return this.clients.createFormTemplate(request, body);
    }
    getOne(request, id, query) {
        return this.clients.getFormTemplate(request, id, query);
    }
    update(request, id, body) {
        return this.clients.updateFormTemplate(request, id, body);
    }
    remove(request, id, query) {
        return this.clients.deleteFormTemplate(request, id, query);
    }
};
exports.FormTemplatesController = FormTemplatesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], FormTemplatesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], FormTemplatesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FormTemplatesController.prototype, "getOne", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FormTemplatesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], FormTemplatesController.prototype, "remove", null);
exports.FormTemplatesController = FormTemplatesController = __decorate([
    (0, common_1.Controller)("form-templates"),
    __metadata("design:paramtypes", [clients_mongo_service_1.ClientsMongoService])
], FormTemplatesController);
let ClientsCrudController = class ClientsCrudController {
    constructor(clients) {
        this.clients = clients;
    }
    list(request, query) {
        return this.clients.listClients(request, query);
    }
    create(request, body) {
        return this.clients.createClient(request, body);
    }
    getOne(request, id, query) {
        return this.clients.getClient(request, id, query);
    }
    update(request, id, body) {
        return this.clients.updateClient(request, id, body);
    }
    remove(request, id, query) {
        return this.clients.deleteClient(request, id, query);
    }
};
exports.ClientsCrudController = ClientsCrudController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ClientsCrudController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ClientsCrudController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClientsCrudController.prototype, "getOne", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClientsCrudController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ClientsCrudController.prototype, "remove", null);
exports.ClientsCrudController = ClientsCrudController = __decorate([
    (0, common_1.Controller)("clients"),
    __metadata("design:paramtypes", [clients_mongo_service_1.ClientsMongoService])
], ClientsCrudController);
