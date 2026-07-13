"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseModule = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongodb_1 = require("../server/mongodb");
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Module)({
        imports: [
            mongoose_1.MongooseModule.forRootAsync({
                useFactory: () => {
                    (0, mongodb_1.applyMongoDnsFromEnv)();
                    const uri = process.env.MONGO_URL_SCRAPPING;
                    const dbName = process.env.MONGO_DBNAME_SCRAPPING;
                    if (!uri) {
                        throw new Error("Missing MONGO_URL_SCRAPPING environment variable.");
                    }
                    if (!dbName) {
                        throw new Error("Missing MONGO_DBNAME_SCRAPPING environment variable.");
                    }
                    return {
                        uri,
                        dbName,
                        serverSelectionTimeoutMS: 30_000,
                    };
                },
            }),
        ],
    })
], DatabaseModule);
