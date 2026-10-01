import { createHash } from "node:crypto";
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { type ChangeStream, type Db, ObjectId } from "mongodb";
import { RealtimeService } from "../realtime/realtime.service";
import { getMongoDb } from "../server/mongodb";
import { ASSETS_COLLECTION } from "../assets/collections";
import { MV_ITEMS_COLLECTION, MV_PROJECTS_COLLECTION, MV_SUBPROJECTS_COLLECTION } from "./collections";

// Hash the actual media, not updatedAt: external inspection apps can update nested
// images without touching the asset timestamp. No media is returned by this endpoint.
export async function assetMediaRevision(db: Db, projectId: ObjectId) {
  const hash = createHash("sha256");
  for (const collection of [ASSETS_COLLECTION, MV_ITEMS_COLLECTION, MV_SUBPROJECTS_COLLECTION]) {
    hash.update(collection);
    const rows = db.collection(collection).find({ projectId }, { projection: {
      _id: 1, images: 1, voiceNotes: 1, mainImage: 1, parent: 1, name: 1, isAssetFolder: 1, updatedAt: 1,
    } }).sort({ _id: 1 });
    for await (const row of rows) hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}

@Injectable()
export class AssetMediaRealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private stream?: ChangeStream;
  private stopped = false;
  private retry?: NodeJS.Timeout;
  private readonly logger = new Logger(AssetMediaRealtimeService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  constructor(private readonly realtime: RealtimeService) {}

  onApplicationBootstrap() { void this.start(); }

  async start() {
    if (this.stopped || this.stream) return;
    try {
      const db = await getMongoDb();
      if (this.stopped) return;
      const stream = db.watch([{ $match: {
        "ns.coll": { $in: [ASSETS_COLLECTION, MV_ITEMS_COLLECTION, MV_SUBPROJECTS_COLLECTION] },
        operationType: { $in: ["insert", "update", "replace", "delete"] },
      } }], { fullDocument: "updateLookup" });
      this.stream = stream;
      stream.on("change", change => {
        const doc = "fullDocument" in change ? change.fullDocument : null;
        const pid = doc?.projectId?.toString();
        // Deletes may have no pre-image. A data-free invalidation is safe for all
        // authenticated clients; their subsequent reads still enforce project access.
        const key = pid && ObjectId.isValid(pid) ? pid : "*";
        if (this.pending.has(key)) return;
        this.pending.set(key, setTimeout(() => {
          this.pending.delete(key);
          void this.publish(db, key).catch(() => this.realtime.assetsInvalidated());
        }, 150));
      });
      stream.on("error", () => {
        if (this.stream !== stream) return;
        this.stream = undefined;
        void stream.close().catch(() => undefined);
        this.scheduleRetry();
      });
    } catch { this.scheduleRetry(); }
  }

  private async publish(db: Db, projectId: string) {
    if (this.stopped) return;
    if (projectId === "*") { this.realtime.assetsInvalidated(); return; }
    const project = await db.collection(MV_PROJECTS_COLLECTION).findOne({ _id: new ObjectId(projectId) }, { projection: { companyId: 1, userId: 1 } });
    if (!project) return;
    this.realtime.resourceChanged(project.companyId?.toString() ?? null, project.userId?.toString() ?? "", "assets", projectId);
  }

  private scheduleRetry() {
    if (this.stopped || this.retry) return;
    this.logger.warn("Asset change stream unavailable; clients retain revision polling. Retrying in 60 seconds.");
    this.retry = setTimeout(() => { this.retry = undefined; void this.start(); }, 60_000);
    this.retry.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    await this.stream?.close();
  }
}
