"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineValuationModule = void 0;
const common_1 = require("@nestjs/common");
const machine_valuation_controller_1 = require("./machine-valuation.controller");
const machine_valuation_service_1 = require("./machine-valuation.service");
const file_parser_service_1 = require("./file-parser.service");
let MachineValuationModule = class MachineValuationModule {
};
exports.MachineValuationModule = MachineValuationModule;
exports.MachineValuationModule = MachineValuationModule = __decorate([
    (0, common_1.Module)({
        controllers: [machine_valuation_controller_1.MachineValuationController],
        providers: [machine_valuation_service_1.MachineValuationService, file_parser_service_1.FileParserService],
    })
], MachineValuationModule);
