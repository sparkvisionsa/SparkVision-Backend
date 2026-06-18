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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientTypeSchema = exports.ClientType = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const clientsModule_1 = require("../../server/models/clientsModule");
let ClientType = class ClientType {
};
exports.ClientType = ClientType;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Schema.Types.ObjectId, default: null, index: true }),
    __metadata("design:type", Object)
], ClientType.prototype, "companyId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: "real-estate-valuation", index: true }),
    __metadata("design:type", String)
], ClientType.prototype, "productId", void 0);
__decorate([
    (0, mongoose_1.Prop)({ required: true, trim: true }),
    __metadata("design:type", String)
], ClientType.prototype, "name", void 0);
exports.ClientType = ClientType = __decorate([
    (0, mongoose_1.Schema)({
        collection: clientsModule_1.CLIENT_TYPES_COLLECTION,
        timestamps: { createdAt: true, updatedAt: false },
    })
], ClientType);
exports.ClientTypeSchema = mongoose_1.SchemaFactory.createForClass(ClientType);
