"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetAuditService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const collections_1 = require("./collections");
let AssetAuditService = class AssetAuditService {
    async log(projectId, actor, action, changes, options) {
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const doc = {
            _id: new mongodb_1.ObjectId(),
            projectId,
            ...(options?.assetId ? { assetId: options.assetId } : {}),
            ...(options?.assetType ? { assetType: options.assetType } : {}),
            action,
            changes,
            actorUserId: actor.userId,
            actorUsername: actor.username,
            createdAt: new Date(),
        };
        await db.collection(collections_1.ASSET_AUDIT_LOGS_COLLECTION).insertOne(doc);
    }
    async logMany(entries) {
        if (entries.length === 0)
            return;
        const db = await (0, mongodb_2.getMongoDb)();
        await (0, collections_1.ensureAssetsCollectionsInitialized)(db);
        const docs = entries.map((entry) => ({
            _id: new mongodb_1.ObjectId(),
            projectId: entry.projectId,
            ...(entry.assetId ? { assetId: entry.assetId } : {}),
            ...(entry.assetType ? { assetType: entry.assetType } : {}),
            action: entry.action,
            changes: entry.changes,
            actorUserId: entry.actor.userId,
            actorUsername: entry.actor.username,
            createdAt: new Date(),
        }));
        await db.collection(collections_1.ASSET_AUDIT_LOGS_COLLECTION).insertMany(docs, {
            ordered: false,
        });
    }
};
exports.AssetAuditService = AssetAuditService;
exports.AssetAuditService = AssetAuditService = __decorate([
    (0, common_1.Injectable)()
], AssetAuditService);
