import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { tryCoerceToObjectId } from "@/common/object-id.util";
import { MV_PROJECTS_COLLECTION } from "@/machine-valuation/collections";
import { mvProjectSharesCompany } from "@/machine-valuation/mv-project-scope.util";
import type { MvProjectDoc } from "@/machine-valuation/types";
import { getMongoDb } from "@/server/mongodb";
import type { UserMongoDoc } from "@/server/auth-tracking/types";

@Injectable()
export class AssetProjectAccessService {
  async assertProjectAccess(
    projectId: ObjectId,
    user: UserMongoDoc,
    options?: {
      claimOwnershipIfMissing?: boolean;
      /** الشركة النشطة في الجلسة — تسمح لجميع أعضاء الشركة بالوصول لمشروع له `companyId` مطابق. */
      activeCompanyId?: ObjectId | null;
    },
  ) {
    const db = await getMongoDb();
    const project = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne(
      { _id: projectId },
      {
        projection: {
          _id: 1,
          name: 1,
          userId: 1,
          companyId: 1,
          updatedAt: 1,
        },
      },
    );

    if (!project) {
      throw new NotFoundException("المشروع غير موجود.");
    }

    if (user.role === "super_admin") {
      return project;
    }

    const activeCo = options?.activeCompanyId ?? null;
    if (activeCo && mvProjectSharesCompany(project, activeCo)) {
      return project;
    }

    const creatorOid = tryCoerceToObjectId(project.userId);
    const ownsProject =
      (creatorOid != null && creatorOid.equals(user._id)) ||
      (typeof project.userId === "string" && project.userId === user._id.toString());

    if (ownsProject) {
      return project;
    }

    if (!project.userId && options?.claimOwnershipIfMissing) {
      const now = new Date();
      const $set: { userId: ObjectId; updatedAt: Date; companyId?: ObjectId } = {
        userId: user._id,
        updatedAt: now,
      };
      if (activeCo) {
        $set.companyId = activeCo;
      }
      await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).updateOne(
        { _id: projectId, userId: { $exists: false } },
        { $set },
      );
      return project;
    }

    if (project.userId) {
      throw new ForbiddenException("لا تملك صلاحية الوصول إلى هذا المشروع.");
    }

    return project;
  }
}
