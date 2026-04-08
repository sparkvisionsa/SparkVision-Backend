"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineValuationService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const collections_1 = require("./collections");
const sheet_rows_util_1 = require("./sheet-rows.util");
function toId(raw) {
    if (!mongodb_1.ObjectId.isValid(raw))
        throw new common_1.NotFoundException("Not found");
    return new mongodb_1.ObjectId(raw);
}
let MachineValuationService = class MachineValuationService {
    async listProjects() {
        const db = await (0, mongodb_2.getMongoDb)();
        const projects = await db
            .collection(collections_1.MV_PROJECTS_COLLECTION)
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        const counts = await db
            .collection(collections_1.MV_SUBPROJECTS_COLLECTION)
            .aggregate([
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
    async createProject(name) {
        const n = name?.trim();
        if (!n)
            throw new common_1.BadRequestException("Project name is required");
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const doc = { name: n, createdAt: now, updatedAt: now };
        const { insertedId } = await db.collection(collections_1.MV_PROJECTS_COLLECTION).insertOne(doc);
        return {
            _id: insertedId.toString(),
            name: n,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }
    async getProject(id) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const project = await db.collection(collections_1.MV_PROJECTS_COLLECTION).findOne({ _id });
        if (!project)
            throw new common_1.NotFoundException("Project not found");
        const subProjects = await db
            .collection(collections_1.MV_SUBPROJECTS_COLLECTION)
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
    async deleteProject(id) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        await db.collection(collections_1.MV_SHEETS_COLLECTION).deleteMany({ projectId: _id });
        await db.collection(collections_1.MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: _id });
        const del = await db.collection(collections_1.MV_PROJECTS_COLLECTION).deleteOne({ _id });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException("Project not found");
        return { ok: true };
    }
    async createSubProject(projectId, name) {
        const n = name?.trim();
        if (!n)
            throw new common_1.BadRequestException("Sub-project name is required");
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const proj = await db.collection(collections_1.MV_PROJECTS_COLLECTION).findOne({ _id: pid });
        if (!proj)
            throw new common_1.NotFoundException("Project not found");
        const now = new Date();
        const doc = {
            projectId: pid,
            name: n,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db.collection(collections_1.MV_SUBPROJECTS_COLLECTION).insertOne(doc);
        return {
            _id: insertedId.toString(),
            projectId: pid.toString(),
            name: n,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }
    async getSubProject(projectId, subId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const sub = await db
            .collection(collections_1.MV_SUBPROJECTS_COLLECTION)
            .findOne({ _id: toId(subId), projectId: toId(projectId) });
        if (!sub)
            throw new common_1.NotFoundException("Sub-project not found");
        return {
            _id: sub._id.toString(),
            projectId: sub.projectId.toString(),
            name: sub.name,
            createdAt: sub.createdAt.toISOString(),
            updatedAt: sub.updatedAt.toISOString(),
        };
    }
    async deleteSubProject(projectId, subId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const sid = toId(subId);
        await db.collection(collections_1.MV_SHEETS_COLLECTION).deleteMany({ subProjectId: sid });
        const del = await db
            .collection(collections_1.MV_SUBPROJECTS_COLLECTION)
            .deleteOne({ _id: sid, projectId: toId(projectId) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException("Sub-project not found");
        return { ok: true };
    }
    async listSheets(projectId, subProjectId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const filter = { projectId: toId(projectId) };
        if (subProjectId)
            filter.subProjectId = toId(subProjectId);
        else
            filter.subProjectId = { $exists: false };
        const sheets = await db
            .collection(collections_1.MV_SHEETS_COLLECTION)
            .aggregate([
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
            rows: [],
            rowCount: s.rowCount,
            sourceType: s.sourceType,
            sourceFileName: s.sourceFileName,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
        }));
    }
    async getSheet(id) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const s = await db.collection(collections_1.MV_SHEETS_COLLECTION).findOne({ _id });
        if (!s)
            throw new common_1.NotFoundException("Sheet not found");
        const rows = s.rowValues && s.rowValues.length > 0
            ? (0, sheet_rows_util_1.rowValuesToRecords)(s.headers, s.rowValues)
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
    async createSheet(body) {
        if (!body.name?.trim())
            throw new common_1.BadRequestException("Sheet name required");
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const headers = body.headers || [];
        const rowValues = (0, sheet_rows_util_1.recordsToRowValues)(headers, body.rows || []);
        const doc = {
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
        const { insertedId } = await db.collection(collections_1.MV_SHEETS_COLLECTION).insertOne(doc);
        return {
            _id: insertedId.toString(),
            projectId: doc.projectId.toString(),
            subProjectId: doc.subProjectId?.toString(),
            name: doc.name,
            headers: doc.headers,
            rows: [],
            rowCount: rowValues.length,
            sourceType: doc.sourceType,
            sourceFileName: doc.sourceFileName,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }
    async updateSheet(id, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const now = new Date();
        const $set = { updatedAt: now };
        const $unset = {};
        if (body.name)
            $set.name = body.name.trim();
        if (body.headers)
            $set.headers = body.headers;
        if (body.rows && body.headers) {
            $set.rowValues = (0, sheet_rows_util_1.recordsToRowValues)(body.headers, body.rows);
            $unset.rows = "";
        }
        else if (body.rows && !body.headers) {
            const existing = await db.collection(collections_1.MV_SHEETS_COLLECTION).findOne({ _id });
            if (!existing)
                throw new common_1.NotFoundException("Sheet not found");
            const h = existing.headers;
            $set.rowValues = (0, sheet_rows_util_1.recordsToRowValues)(h, body.rows);
            $unset.rows = "";
        }
        const updatePayload = { $set };
        if (Object.keys($unset).length) {
            updatePayload.$unset = $unset;
        }
        const updated = await db
            .collection(collections_1.MV_SHEETS_COLLECTION)
            .findOneAndUpdate({ _id }, updatePayload, { returnDocument: "after" });
        if (!updated)
            throw new common_1.NotFoundException("Sheet not found");
        const rowCount = updated.rowValues?.length ?? updated.rows?.length ?? 0;
        return {
            _id: updated._id.toString(),
            projectId: updated.projectId.toString(),
            subProjectId: updated.subProjectId?.toString(),
            name: updated.name,
            headers: updated.headers,
            rows: [],
            rowCount,
            sourceType: updated.sourceType,
            sourceFileName: updated.sourceFileName,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    async deleteSheet(id) {
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db.collection(collections_1.MV_SHEETS_COLLECTION).deleteOne({ _id: toId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException("Sheet not found");
        return { ok: true };
    }
    async deleteAllSheets(projectId, subProjectId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const filter = { projectId: toId(projectId) };
        if (subProjectId)
            filter.subProjectId = toId(subProjectId);
        else
            filter.subProjectId = { $exists: false };
        const result = await db.collection(collections_1.MV_SHEETS_COLLECTION).deleteMany(filter);
        return { ok: true, deletedCount: result.deletedCount };
    }
    async listHeaderOptions() {
        const db = await (0, mongodb_2.getMongoDb)();
        const options = await db
            .collection(collections_1.MV_HEADER_OPTIONS_COLLECTION)
            .find({})
            .sort({ name: 1 })
            .toArray();
        return options.map((o) => ({ _id: o._id.toString(), name: o.name }));
    }
    async addHeaderOption(name) {
        const n = name?.trim();
        if (!n)
            throw new common_1.BadRequestException("Header name is required");
        const db = await (0, mongodb_2.getMongoDb)();
        const existing = await db
            .collection(collections_1.MV_HEADER_OPTIONS_COLLECTION)
            .findOne({ name: n });
        if (existing)
            return { _id: existing._id.toString(), name: existing.name };
        const { insertedId } = await db
            .collection(collections_1.MV_HEADER_OPTIONS_COLLECTION)
            .insertOne({ name: n });
        return { _id: insertedId.toString(), name: n };
    }
};
exports.MachineValuationService = MachineValuationService;
exports.MachineValuationService = MachineValuationService = __decorate([
    (0, common_1.Injectable)()
], MachineValuationService);
