import { Injectable } from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import { ASSET_AUDIT_LOGS_COLLECTION, ensureAssetsCollectionsInitialized } from "./collections";
import type { AssetAuditAction, AssetAuditLogDoc, AssetType } from "./types";

export interface AssetAuditActor {
  userId: string;
  username: string;
}

@Injectable()
export class AssetAuditService {
  async log(
    projectId: ObjectId,
    actor: AssetAuditActor,
    action: AssetAuditAction,
    changes: Record<string, unknown>,
    options?: {
      assetId?: ObjectId;
      assetType?: AssetType;
    },
  ) {
    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const doc: AssetAuditLogDoc = {
      _id: new ObjectId(),
      projectId,
      ...(options?.assetId ? { assetId: options.assetId } : {}),
      ...(options?.assetType ? { assetType: options.assetType } : {}),
      action,
      changes,
      actorUserId: actor.userId,
      actorUsername: actor.username,
      createdAt: new Date(),
    };

    await db.collection<AssetAuditLogDoc>(ASSET_AUDIT_LOGS_COLLECTION).insertOne(doc);
  }

  async logMany(
    entries: Array<{
      projectId: ObjectId;
      actor: AssetAuditActor;
      action: AssetAuditAction;
      changes: Record<string, unknown>;
      assetId?: ObjectId;
      assetType?: AssetType;
    }>,
  ) {
    if (entries.length === 0) return;

    const db = await getMongoDb();
    await ensureAssetsCollectionsInitialized(db);

    const docs: AssetAuditLogDoc[] = entries.map((entry) => ({
      _id: new ObjectId(),
      projectId: entry.projectId,
      ...(entry.assetId ? { assetId: entry.assetId } : {}),
      ...(entry.assetType ? { assetType: entry.assetType } : {}),
      action: entry.action,
      changes: entry.changes,
      actorUserId: entry.actor.userId,
      actorUsername: entry.actor.username,
      createdAt: new Date(),
    }));

    await db.collection<AssetAuditLogDoc>(ASSET_AUDIT_LOGS_COLLECTION).insertMany(docs, {
      ordered: false,
    });
  }
}
