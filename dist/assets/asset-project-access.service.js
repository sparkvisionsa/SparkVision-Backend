"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetProjectAccessService = void 0;
const common_1 = require("@nestjs/common");
const object_id_util_1 = require("../common/object-id.util");
const collections_1 = require("../machine-valuation/collections");
const mv_project_scope_util_1 = require("../machine-valuation/mv-project-scope.util");
const mongodb_1 = require("../server/mongodb");
let AssetProjectAccessService = class AssetProjectAccessService {
    async assertProjectAccess(projectId, user, options) {
        const db = await (0, mongodb_1.getMongoDb)();
        const project = await db.collection(collections_1.MV_PROJECTS_COLLECTION).findOne({ _id: projectId }, {
            projection: {
                _id: 1,
                name: 1,
                userId: 1,
                companyId: 1,
                updatedAt: 1,
            },
        });
        if (!project) {
            throw new common_1.NotFoundException("المشروع غير موجود.");
        }
        if (user.role === "super_admin") {
            return project;
        }
        const activeCo = options?.activeCompanyId ?? null;
        if (activeCo && (0, mv_project_scope_util_1.mvProjectSharesCompany)(project, activeCo)) {
            return project;
        }
        const creatorOid = (0, object_id_util_1.tryCoerceToObjectId)(project.userId);
        const ownsProject = (creatorOid != null && creatorOid.equals(user._id)) ||
            (typeof project.userId === "string" && project.userId === user._id.toString());
        if (ownsProject) {
            return project;
        }
        if (!project.userId && options?.claimOwnershipIfMissing) {
            const now = new Date();
            const $set = {
                userId: user._id,
                updatedAt: now,
            };
            if (activeCo) {
                $set.companyId = activeCo;
            }
            await db.collection(collections_1.MV_PROJECTS_COLLECTION).updateOne({ _id: projectId, userId: { $exists: false } }, { $set });
            return project;
        }
        if (project.userId) {
            throw new common_1.ForbiddenException("لا تملك صلاحية الوصول إلى هذا المشروع.");
        }
        return project;
    }
};
exports.AssetProjectAccessService = AssetProjectAccessService;
exports.AssetProjectAccessService = AssetProjectAccessService = __decorate([
    (0, common_1.Injectable)()
], AssetProjectAccessService);
