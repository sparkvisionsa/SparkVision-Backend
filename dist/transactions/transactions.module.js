"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsModule = void 0;
const common_1 = require("@nestjs/common");
const transactions_api_controllers_1 = require("./transactions-api.controllers");
const transactions_mongo_service_1 = require("./transactions-mongo.service");
const transactions_media_controller_1 = require("./transactions-media.controller");
const transactions_media_service_1 = require("./transactions-media.service");
const transactions_notes_controller_1 = require("./transactions-notes.controller");
const transactions_notes_service_1 = require("./transactions-notes.service");
let TransactionsModule = class TransactionsModule {
};
exports.TransactionsModule = TransactionsModule;
exports.TransactionsModule = TransactionsModule = __decorate([
    (0, common_1.Module)({
        controllers: [
            transactions_api_controllers_1.TransactionsController,
            transactions_media_controller_1.TransactionsMediaController,
            transactions_notes_controller_1.TransactionsNotesController,
        ],
        providers: [
            transactions_mongo_service_1.TransactionsMongoService,
            transactions_media_service_1.TransactionsMediaService,
            transactions_notes_service_1.TransactionsNotesService,
        ],
    })
], TransactionsModule);
