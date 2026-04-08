import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import {
  MV_PROJECTS_COLLECTION,
  MV_SUBPROJECTS_COLLECTION,
  MV_SHEETS_COLLECTION,
  MV_HEADER_OPTIONS_COLLECTION,
} from "./collections";
import type {
  MvProjectDoc,
  MvSubProjectDoc,
  MvSheetDoc,
  MvHeaderOptionDoc,
} from "./types";
import {
  recordsToRowValues,
  rowValuesToRecords,
  type MvRowValue,
} from "./sheet-rows.util";

function toId(raw: string): ObjectId {
  if (!ObjectId.isValid(raw)) throw new NotFoundException("Not found");
  return new ObjectId(raw);
}

@Injectable()
export class MachineValuationService {
  /* ───────── Projects ───────── */

  async listProjects() {
    const db = await getMongoDb();
    const projects = await db
      .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const counts = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .aggregate<{ _id: ObjectId; count: number }>([
        { $group: { _id: "$projectId", count: { $sum: 1 } } },
      ])
      .toArray();
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.count]));

    return projects.map((p) => ({
      _id: p._id.toString(),
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      subProjectCount: countMap.get(p._id.toString()) ?? 0,
    }));
  }

  async createProject(name: string) {
    const n = name?.trim();
    if (!n) throw new BadRequestException("Project name is required");
    const db = await getMongoDb();
    const now = new Date();
    const doc: Omit<MvProjectDoc, "_id"> = { name: n, createdAt: now, updatedAt: now };
    const { insertedId } = await db.collection(MV_PROJECTS_COLLECTION).insertOne(doc);
    return {
      _id: insertedId.toString(),
      name: n,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getProject(id: string) {
    const db = await getMongoDb();
    const _id = toId(id);
    const project = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id });
    if (!project) throw new NotFoundException("Project not found");

    const subProjects = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find({ projectId: _id })
      .sort({ createdAt: -1 })
      .toArray();

    return {
      project: {
        _id: project._id.toString(),
        name: project.name,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      },
      subProjects: subProjects.map((s) => ({
        _id: s._id.toString(),
        projectId: s.projectId.toString(),
        name: s.name,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  async deleteProject(id: string) {
    const db = await getMongoDb();
    const _id = toId(id);
    await db.collection(MV_SHEETS_COLLECTION).deleteMany({ projectId: _id });
    await db.collection(MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: _id });
    const del = await db.collection(MV_PROJECTS_COLLECTION).deleteOne({ _id });
    if (del.deletedCount === 0) throw new NotFoundException("Project not found");
    return { ok: true };
  }

  /* ───────── Sub-Projects ───────── */

  async createSubProject(projectId: string, name: string) {
    const n = name?.trim();
    if (!n) throw new BadRequestException("Sub-project name is required");
    const db = await getMongoDb();
    const pid = toId(projectId);
    const proj = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id: pid });
    if (!proj) throw new NotFoundException("Project not found");

    const now = new Date();
    const doc: Omit<MvSubProjectDoc, "_id"> = {
      projectId: pid,
      name: n,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection(MV_SUBPROJECTS_COLLECTION).insertOne(doc);
    return {
      _id: insertedId.toString(),
      projectId: pid.toString(),
      name: n,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async getSubProject(projectId: string, subId: string) {
    const db = await getMongoDb();
    const sub = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .findOne({ _id: toId(subId), projectId: toId(projectId) });
    if (!sub) throw new NotFoundException("Sub-project not found");
    return {
      _id: sub._id.toString(),
      projectId: sub.projectId.toString(),
      name: sub.name,
      createdAt: sub.createdAt.toISOString(),
      updatedAt: sub.updatedAt.toISOString(),
    };
  }

  async deleteSubProject(projectId: string, subId: string) {
    const db = await getMongoDb();
    const sid = toId(subId);
    await db.collection(MV_SHEETS_COLLECTION).deleteMany({ subProjectId: sid });
    const del = await db
      .collection(MV_SUBPROJECTS_COLLECTION)
      .deleteOne({ _id: sid, projectId: toId(projectId) });
    if (del.deletedCount === 0) throw new NotFoundException("Sub-project not found");
    return { ok: true };
  }

  /* ───────── Sheets ───────── */

  async listSheets(projectId: string, subProjectId?: string) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { projectId: toId(projectId) };
    if (subProjectId) filter.subProjectId = toId(subProjectId);
    else filter.subProjectId = { $exists: false };

    const sheets = await db
      .collection<MvSheetDoc>(MV_SHEETS_COLLECTION)
      .aggregate<{
        _id: ObjectId;
        projectId: ObjectId;
        subProjectId?: ObjectId;
        name: string;
        headers: string[];
        sourceType: "file-import" | "manual";
        sourceFileName?: string;
        createdAt: Date;
        updatedAt: Date;
        rowCount: number;
      }>([
        { $match: filter },
        { $sort: { createdAt: -1 } },
        {
          $project: {
            projectId: 1,
            subProjectId: 1,
            name: 1,
            headers: 1,
            sourceType: 1,
            sourceFileName: 1,
            createdAt: 1,
            updatedAt: 1,
            rowCount: {
              $cond: {
                if: { $gt: [{ $size: { $ifNull: ["$rowValues", []] } }, 0] },
                then: { $size: "$rowValues" },
                else: { $size: { $ifNull: ["$rows", []] } },
              },
            },
          },
        },
      ])
      .toArray();

    return sheets.map((s) => ({
      _id: s._id.toString(),
      projectId: s.projectId.toString(),
      subProjectId: s.subProjectId?.toString(),
      name: s.name,
      headers: s.headers,
      rows: [] as Record<string, string | number | null>[],
      rowCount: s.rowCount,
      sourceType: s.sourceType,
      sourceFileName: s.sourceFileName,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  async getSheet(id: string) {
    const db = await getMongoDb();
    const _id = toId(id);
    const s = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({ _id });
    if (!s) throw new NotFoundException("Sheet not found");

    const rows =
      s.rowValues && s.rowValues.length > 0
        ? rowValuesToRecords(s.headers, s.rowValues)
        : (s.rows ?? []);

    const rowCount = rows.length;

    return {
      _id: s._id.toString(),
      projectId: s.projectId.toString(),
      subProjectId: s.subProjectId?.toString(),
      name: s.name,
      headers: s.headers,
      rows,
      rowCount,
      sourceType: s.sourceType,
      sourceFileName: s.sourceFileName,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async createSheet(body: {
    projectId: string;
    subProjectId?: string;
    name: string;
    headers: string[];
    rows: Record<string, string | number | null>[];
    sourceType: "file-import" | "manual";
    sourceFileName?: string;
  }) {
    if (!body.name?.trim()) throw new BadRequestException("Sheet name required");
    const db = await getMongoDb();
    const now = new Date();
    const headers = body.headers || [];
    const rowValues = recordsToRowValues(headers, body.rows || []);
    const doc: Omit<MvSheetDoc, "_id"> = {
      projectId: toId(body.projectId),
      ...(body.subProjectId ? { subProjectId: toId(body.subProjectId) } : {}),
      name: body.name.trim(),
      headers,
      rowValues,
      sourceType: body.sourceType || "manual",
      sourceFileName: body.sourceFileName,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db.collection(MV_SHEETS_COLLECTION).insertOne(doc as MvSheetDoc);
    return {
      _id: insertedId.toString(),
      projectId: doc.projectId.toString(),
      subProjectId: (doc.subProjectId as ObjectId | undefined)?.toString(),
      name: doc.name,
      headers: doc.headers,
      rows: [] as Record<string, string | number | null>[],
      rowCount: rowValues.length,
      sourceType: doc.sourceType,
      sourceFileName: doc.sourceFileName,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  async updateSheet(
    id: string,
    body: {
      name?: string;
      headers?: string[];
      rows?: Record<string, string | number | null>[];
    },
  ) {
    const db = await getMongoDb();
    const _id = toId(id);
    const now = new Date();
    const $set: Record<string, unknown> = { updatedAt: now };
    const $unset: Record<string, "" | 1> = {};
    if (body.name) $set.name = body.name.trim();
    if (body.headers) $set.headers = body.headers;
    if (body.rows && body.headers) {
      $set.rowValues = recordsToRowValues(body.headers, body.rows);
      $unset.rows = "";
    } else if (body.rows && !body.headers) {
      const existing = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({ _id });
      if (!existing) throw new NotFoundException("Sheet not found");
      const h = existing.headers;
      $set.rowValues = recordsToRowValues(h, body.rows);
      $unset.rows = "";
    }

    const updatePayload: Record<string, unknown> = { $set };
    if (Object.keys($unset).length) {
      updatePayload.$unset = $unset;
    }

    const updated = await db
      .collection<MvSheetDoc>(MV_SHEETS_COLLECTION)
      .findOneAndUpdate({ _id }, updatePayload as never, { returnDocument: "after" });
    if (!updated) throw new NotFoundException("Sheet not found");

    const rowCount =
      updated.rowValues?.length ?? updated.rows?.length ?? 0;

    return {
      _id: updated._id.toString(),
      projectId: updated.projectId.toString(),
      subProjectId: updated.subProjectId?.toString(),
      name: updated.name,
      headers: updated.headers,
      rows: [] as Record<string, string | number | null>[],
      rowCount,
      sourceType: updated.sourceType,
      sourceFileName: updated.sourceFileName,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteSheet(id: string) {
    const db = await getMongoDb();
    const del = await db.collection(MV_SHEETS_COLLECTION).deleteOne({ _id: toId(id) });
    if (del.deletedCount === 0) throw new NotFoundException("Sheet not found");
    return { ok: true };
  }

  /** Delete every sheet for the project (root) or for one sub-project when subProjectId is set */
  async deleteAllSheets(projectId: string, subProjectId?: string) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = { projectId: toId(projectId) };
    if (subProjectId) filter.subProjectId = toId(subProjectId);
    else filter.subProjectId = { $exists: false };

    const result = await db.collection(MV_SHEETS_COLLECTION).deleteMany(filter);
    return { ok: true, deletedCount: result.deletedCount };
  }

  /* ───────── Header Options ───────── */

  async listHeaderOptions() {
    const db = await getMongoDb();
    const options = await db
      .collection<MvHeaderOptionDoc>(MV_HEADER_OPTIONS_COLLECTION)
      .find({})
      .sort({ name: 1 })
      .toArray();
    return options.map((o) => ({ _id: o._id.toString(), name: o.name }));
  }

  async addHeaderOption(name: string) {
    const n = name?.trim();
    if (!n) throw new BadRequestException("Header name is required");
    const db = await getMongoDb();
    const existing = await db
      .collection<MvHeaderOptionDoc>(MV_HEADER_OPTIONS_COLLECTION)
      .findOne({ name: n });
    if (existing) return { _id: existing._id.toString(), name: existing.name };

    const { insertedId } = await db
      .collection(MV_HEADER_OPTIONS_COLLECTION)
      .insertOne({ name: n } as unknown as MvHeaderOptionDoc);
    return { _id: insertedId.toString(), name: n };
  }
}
