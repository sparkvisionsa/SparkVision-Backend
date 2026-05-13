"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MachineValuationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineValuationService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = require("node:fs/promises");
const node_crypto_1 = require("node:crypto");
const object_id_util_1 = require("../common/object-id.util");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const collections_1 = require("../server/auth-tracking/collections");
const collections_2 = require("./collections");
const digitalocean_spaces_service_1 = require("./digitalocean-spaces.service");
const inspector_files_constants_1 = require("./inspector-files.constants");
const inspector_files_util_1 = require("./inspector-files.util");
const inspector_download_range_util_1 = require("./inspector-download-range.util");
const sheet_rows_util_1 = require("./sheet-rows.util");
const mv_project_scope_util_1 = require("./mv-project-scope.util");
const collections_3 = require("../assets/collections");
const asset_import_utils_1 = require("../assets/asset-import.utils");
const asset_import_constants_1 = require("../assets/asset-import.constants");
const MV_PHOTO_FOLDER_FILTER = { isAssetFolder: true };
const EXTERNAL_ASSET_IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MV_VALUATION_EXCEL_SCOPE = "valuation-excel";
function toId(raw) {
    if (!mongodb_1.ObjectId.isValid(raw))
        throw new common_1.NotFoundException("Not found");
    return new mongodb_1.ObjectId(raw);
}
function normalizeWorkflowStatus(raw) {
    if (raw === "review" || raw === "approved" || raw === "new")
        return raw;
    return "new";
}
function normalizeReportType(raw) {
    if (raw === "advanced")
        return "advanced";
    return "simple";
}
function projectWorkflowStatus(doc) {
    return normalizeWorkflowStatus(doc.workflowStatus);
}
function projectReportType(doc) {
    return normalizeReportType(doc.reportType);
}
function sanitizeOptionalText(value, maxLength = 1000) {
    if (value == null)
        return "";
    return String(value).trim().slice(0, maxLength);
}
function sanitizeCoordinate(value, kind) {
    if (value === undefined || value === null || value === "")
        return null;
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n))
        return null;
    if (kind === "lat" && (n < -90 || n > 90))
        return null;
    if (kind === "lng" && (n < -180 || n > 180))
        return null;
    return Math.round(n * 1_000_000) / 1_000_000;
}
function sanitizeProjectLocations(value, strict = true) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        if (!strict)
            return [];
        throw new common_1.BadRequestException("locations must be an array");
    }
    return value
        .slice(0, 10)
        .map((item) => {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const region = sanitizeOptionalText(data.region, 120);
        const city = sanitizeOptionalText(data.city, 120);
        const latitude = sanitizeCoordinate(data.latitude ?? data.lat, "lat");
        const longitude = sanitizeCoordinate(data.longitude ?? data.lng, "lng");
        const mapUrl = sanitizeOptionalText(data.mapUrl ?? data.url, 600);
        if (!region && !city && latitude === null && longitude === null && !mapUrl) {
            return null;
        }
        return {
            region,
            city,
            latitude,
            longitude,
            ...(mapUrl ? { mapUrl } : {}),
        };
    })
        .filter((item) => item != null);
}
function sanitizeProjectContacts(value, strict = true) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        if (!strict)
            return [];
        throw new common_1.BadRequestException("contacts must be an array");
    }
    return value
        .slice(0, 10)
        .flatMap((item, index) => {
        if (typeof item === "string") {
            const phone = sanitizeOptionalText(item, 60);
            return phone
                ? [{ type: index === 1 ? "secondary" : "primary", phone }]
                : [];
        }
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const type = data.type === "secondary" ? "secondary" : "primary";
        const phone = sanitizeOptionalText(data.phone ?? data.value ?? data.number, 60);
        return phone ? [{ type, phone }] : [];
    });
}
function sanitizeIsoDateOnly(value) {
    const text = sanitizeOptionalText(value, 32);
    if (!text)
        return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text))
        return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime()))
        return "";
    return parsed.toISOString().slice(0, 10);
}
function sanitizeFinalValue(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(n))
        return null;
    return Math.max(0, Math.round(n * 100) / 100);
}
function sanitizeReportData(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    return {
        valuationMethod: sanitizeOptionalText(data.valuationMethod, 120),
        valuationPurpose: sanitizeOptionalText(data.valuationPurpose, 120),
        valuePremise: sanitizeOptionalText(data.valuePremise, 120),
        includeAssetImages: data.includeAssetImages !== false,
        includeValuationAccountImages: data.includeValuationAccountImages !== false,
        reportIssueDate: sanitizeIsoDateOnly(data.reportIssueDate),
        inspectionDate: sanitizeIsoDateOnly(data.inspectionDate),
        valuationDate: sanitizeIsoDateOnly(data.valuationDate),
        clientName: sanitizeOptionalText(data.clientName, 180),
        clientEmail: sanitizeOptionalText(data.clientEmail, 180),
        clientPhone: sanitizeOptionalText(data.clientPhone, 60),
        importantAssumptions: sanitizeOptionalText(data.importantAssumptions, 4000),
        specialAssumptions: sanitizeOptionalText(data.specialAssumptions, 4000),
        finalValue: sanitizeFinalValue(data.finalValue),
        finalValueWords: sanitizeOptionalText(data.finalValueWords, 500),
    };
}
const MV_VALUATION_WORKSPACE_MAX_JSON_CHARS = 9_500_000;
function jsonDeepClone(value) {
    return JSON.parse(JSON.stringify(value));
}
function sanitizeValuationAccountingWorkspaceForPersist(raw) {
    if (raw == null) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace is required when provided");
    }
    let obj;
    if (typeof raw === "string") {
        try {
            obj = JSON.parse(raw);
        }
        catch {
            throw new common_1.BadRequestException("valuationAccountingWorkspace must be valid JSON");
        }
    }
    else if (typeof raw === "object") {
        obj = jsonDeepClone(raw);
    }
    else {
        throw new common_1.BadRequestException("valuationAccountingWorkspace must be an object");
    }
    if (!obj || typeof obj !== "object") {
        throw new common_1.BadRequestException("valuationAccountingWorkspace invalid");
    }
    if (obj.version !== 1) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace version must be 1");
    }
    const sources = obj.sources;
    if (sources != null && !Array.isArray(sources)) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace.sources invalid");
    }
    if (Array.isArray(sources)) {
        for (const s of sources) {
            if (s && typeof s === "object") {
                const row = s;
                const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
                if (fid)
                    delete row.dataUrl;
            }
        }
    }
    const images = obj.images;
    if (images != null && !Array.isArray(images)) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace.images invalid");
    }
    if (Array.isArray(images)) {
        for (const im of images) {
            if (im && typeof im === "object") {
                const row = im;
                const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
                if (fid)
                    delete row.dataUrl;
            }
        }
    }
    obj.version = 1;
    if (typeof obj.includeInReport !== "boolean") {
        obj.includeInReport = true;
    }
    let serialized = JSON.stringify(obj);
    if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
        if (Array.isArray(obj.sources)) {
            for (const s of obj.sources) {
                if (s && typeof s === "object") {
                    delete s.importResult;
                }
            }
        }
        serialized = JSON.stringify(obj);
    }
    if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace exceeds maximum allowed size");
    }
    return obj;
}
function sanitizeValuationAccountingWorkspaceForClient(raw) {
    if (raw == null)
        return undefined;
    try {
        if (typeof raw === "string") {
            return JSON.parse(raw);
        }
        return jsonDeepClone(raw);
    }
    catch {
        return undefined;
    }
}
function sanitizeValuationReadyExcelWorkspaceForPersist(raw) {
    if (raw == null) {
        throw new common_1.BadRequestException("valuationReadyExcelWorkspace is required when provided");
    }
    let obj;
    if (typeof raw === "string") {
        try {
            obj = JSON.parse(raw);
        }
        catch {
            throw new common_1.BadRequestException("valuationReadyExcelWorkspace must be valid JSON");
        }
    }
    else if (typeof raw === "object") {
        obj = jsonDeepClone(raw);
    }
    else {
        throw new common_1.BadRequestException("valuationReadyExcelWorkspace must be an object");
    }
    if (obj.version !== 1) {
        throw new common_1.BadRequestException("valuationReadyExcelWorkspace version must be 1");
    }
    const accountImages = obj.accountImages;
    if (accountImages != null && !Array.isArray(accountImages)) {
        throw new common_1.BadRequestException("valuationReadyExcelWorkspace.accountImages invalid");
    }
    if (Array.isArray(accountImages)) {
        obj.accountImages = accountImages
            .map((im) => {
            if (!im || typeof im !== "object")
                return null;
            const row = { ...im };
            const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
            if (fid)
                delete row.dataUrl;
            return row;
        })
            .filter((x) => x != null);
    }
    let serialized = JSON.stringify(obj);
    if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
        if ("importResult" in obj) {
            delete obj.importResult;
        }
        serialized = JSON.stringify(obj);
    }
    if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
        throw new common_1.BadRequestException("valuationReadyExcelWorkspace exceeds maximum allowed size");
    }
    return obj;
}
function sanitizeValuationReadyExcelWorkspaceForClient(raw) {
    if (raw == null)
        return undefined;
    try {
        if (typeof raw === "string") {
            return JSON.parse(raw);
        }
        return jsonDeepClone(raw);
    }
    catch {
        return undefined;
    }
}
function mvProjectDateToIso(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }
    if (typeof value === "string" || typeof value === "number") {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime()))
            return d.toISOString();
    }
    return new Date(0).toISOString();
}
function toSafeNonNegativeInt(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n))
            return Math.max(0, Math.trunc(n));
    }
    if (value != null && typeof value.valueOf === "function") {
        const v = Number(value.valueOf());
        if (Number.isFinite(v))
            return Math.max(0, Math.trunc(v));
    }
    return 0;
}
function mvProjectIdString(project) {
    const id = project?._id;
    if (id == null)
        return null;
    if (id instanceof mongodb_1.ObjectId)
        return id.toString();
    if (typeof id === "string" || typeof id === "number")
        return String(id);
    if (typeof id.toString === "function") {
        return id.toString();
    }
    return null;
}
const DEFAULT_PROJECT_SUBFOLDERS = [
    "1.ملفات العميل",
    "2.صور المعاينة",
    "3.اعداد مسودة التقرير و حسابات القيمة",
    "4.التقرير بالتوقيع",
    "5.ملفات التسليم النهائية",
];
const DEFAULT_PHOTOS_SUBFOLDER_NAME = "2.صور المعاينة";
const ASSET_TYPE_VALUES = [
    "vehicles",
    "machinery",
    "electronics",
    "furniture",
    "other",
];
const ASSET_TYPE_SET = new Set(ASSET_TYPE_VALUES);
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 84;
const MAX_COLUMN_WIDTH = 480;
const ALLOWED_FONT_FAMILIES = new Set([
    "default",
    "sans",
    "display",
    "serif",
    "mono",
]);
const ALLOWED_FONT_WEIGHTS = new Set(["normal", "bold"]);
const ALLOWED_TEXT_ALIGN = new Set(["start", "center", "end"]);
const ALLOWED_COLUMN_FORMATS = new Set([
    "general",
    "number",
    "currency",
    "percent",
    "date",
]);
function getParentIdFromDoc(sub) {
    if (sub.parent !== undefined && sub.parent !== null) {
        return sub.parent;
    }
    if (sub.parent === null)
        return null;
    const legacy = sub.parentSubProjectId;
    return legacy;
}
function isRootSubProject(sub) {
    const p = getParentIdFromDoc(sub);
    return p === undefined || p === null;
}
function picMatchKeyForMvSub(sub) {
    const p = getParentIdFromDoc(sub);
    if (p == null)
        return null;
    return `${p.toString()}\u001f${normalizeSubProjectName(sub.name)}`;
}
function picMatchKeyForPicDoc(pic) {
    const par = pic.parent;
    const nm = pic.name ?? "";
    if (par == null) {
        return `__\u001f${normalizeSubProjectName(nm)}`;
    }
    return `${par.toString()}\u001f${normalizeSubProjectName(nm)}`;
}
function buildPicAssetDocument(projectId, parentFolderId, name, now, createdBy) {
    const id = new mongodb_1.ObjectId();
    return {
        _id: id,
        assetId: id.toString(),
        projectId,
        assetType: "other",
        rawData: {},
        normalizedData: {},
        importedAt: now,
        updatedAt: now,
        status: "pending_review",
        parent: parentFolderId,
        name,
        isAssetFolder: true,
        writtenDescription: null,
        condition: null,
        brand: null,
        code: null,
        model: null,
        manufactureYear: null,
        kilometersDriven: null,
        isPresent: true,
        createdBy,
        images: [],
        voiceNotes: [],
        isDone: true,
        createdAt: now,
    };
}
async function backfillMissingPicAssets(db, projectId, parentFolderId, names, createdBy) {
    if (names.length === 0)
        return;
    const now = new Date();
    const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
    const pa = db.collection(collections_3.ASSETS_COLLECTION);
    const queryNames = Array.from(new Set(names.map((n) => normalizeSubProjectName(n)).filter(Boolean)));
    if (queryNames.length === 0)
        return;
    const subs = await sp
        .find({
        projectId,
        $or: [
            { parent: parentFolderId },
            { parentSubProjectId: parentFolderId },
        ],
        name: { $in: queryNames },
    })
        .toArray();
    for (const sub of subs) {
        const parentRef = getParentIdFromDoc(sub) ?? parentFolderId;
        const has = await pa.findOne({
            projectId,
            parent: parentRef,
            name: sub.name,
            ...MV_PHOTO_FOLDER_FILTER,
        });
        if (has)
            continue;
        await pa.insertOne(buildPicAssetDocument(projectId, parentRef, sub.name, now, createdBy));
    }
}
function filterSubProjectsForInspector(subs, photosName) {
    if (subs.length === 0)
        return subs;
    const byId = new Map(subs.map((s) => [s._id.toString(), s]));
    const photosRoot = subs.find((s) => isRootSubProject(s) && s.name === photosName);
    if (!photosRoot)
        return subs;
    const photosId = photosRoot._id;
    return subs.filter((s) => isUnderOrIsPhotos(s, photosId, byId));
}
function isUnderOrIsPhotos(s, photosId, byId) {
    if (s._id.equals(photosId))
        return true;
    const seen = new Set();
    let cur = s;
    while (cur) {
        const p = getParentIdFromDoc(cur);
        if (p === undefined || p === null) {
            return false;
        }
        if (p.equals(photosId))
            return true;
        if (seen.has(cur._id.toString()))
            return false;
        seen.add(cur._id.toString());
        cur = byId.get(p.toString());
    }
    return false;
}
function filterFolderEntriesForInspector(entries, photosName) {
    if (entries.length === 0)
        return entries;
    const byId = new Map(entries.map((e) => [e._id, e]));
    const photosRoot = entries.find((e) => e.parent == null && e.name === photosName);
    if (!photosRoot)
        return entries;
    const photosId = photosRoot._id;
    return entries.filter((e) => isEntryUnderOrIsPhotos(e, photosId, byId));
}
function isEntryUnderOrIsPhotos(e, photosId, byId) {
    if (e._id === photosId)
        return true;
    const seen = new Set();
    let cur = e;
    while (cur) {
        if (cur.parent == null) {
            return false;
        }
        if (cur.parent === photosId)
            return true;
        if (seen.has(cur._id))
            return false;
        seen.add(cur._id);
        cur = byId.get(cur.parent);
    }
    return false;
}
function toObjectIdListFromStringIds(fieldLabel, ids) {
    if (ids === undefined)
        return undefined;
    const out = [];
    for (const raw of ids) {
        if (typeof raw !== "string" || !mongodb_1.ObjectId.isValid(raw)) {
            throw new common_1.BadRequestException(`Invalid id in ${fieldLabel}`);
        }
        out.push(new mongodb_1.ObjectId(raw));
    }
    return out;
}
function gridFsIdArrayToStrings(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        if (item instanceof mongodb_1.ObjectId)
            out.push(item.toString());
        else if (typeof item === "string" && mongodb_1.ObjectId.isValid(item))
            out.push(item);
    }
    return out;
}
function normalizeAssetTypeForApi(raw) {
    if (raw === undefined || raw === null)
        return "other";
    const s = String(raw).toLowerCase().trim();
    if (s === "vehicle" || s === "vehicles" || s === "car" || s === "cars")
        return "vehicles";
    if (s === "machine" || s === "machinery" || s === "industrial")
        return "machinery";
    if (s === "electronic" || s === "electronics" || s === "it")
        return "electronics";
    if (s === "furniture" || s === "furnitures")
        return "furniture";
    if (typeof raw === "string" && ASSET_TYPE_SET.has(raw))
        return raw;
    if (s === "other" || s === "")
        return "other";
    return "other";
}
function coerceNumberishField(v) {
    if (v == null)
        return null;
    if (typeof v === "number" && Number.isFinite(v))
        return v;
    if (typeof v === "string") {
        const t = v.trim();
        if (t === "")
            return null;
        const n = Number(t);
        if (Number.isFinite(n))
            return n;
        return t;
    }
    return null;
}
function serializePicAssetImages(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (item instanceof mongodb_1.ObjectId) {
            out.push({ fileId: item.toString() });
            continue;
        }
        if (typeof item === "string" && mongodb_1.ObjectId.isValid(item)) {
            out.push({ fileId: item });
            continue;
        }
        if (item && typeof item === "object" && "url" in item) {
            const u = item.url;
            if (typeof u === "string" && u.length > 0) {
                const o = item;
                const row = {
                    url: o.url,
                    publicId: typeof o.publicId === "string" ? o.publicId : undefined,
                    _id: o._id instanceof mongodb_1.ObjectId
                        ? o._id.toString()
                        : typeof o._id === "string"
                            ? o._id
                            : undefined,
                    createdAt: o.createdAt instanceof Date
                        ? o.createdAt.toISOString()
                        : typeof o.createdAt === "string"
                            ? o.createdAt
                            : undefined,
                };
                if (typeof o.mediaType === "string" && o.mediaType.length > 0) {
                    row.mediaType = o.mediaType;
                }
                if (typeof o.mimeType === "string" && o.mimeType.length > 0) {
                    row.mimeType = o.mimeType;
                }
                if (o.duration === null) {
                    row.duration = null;
                }
                else if (typeof o.duration === "number" && Number.isFinite(o.duration)) {
                    row.duration = o.duration;
                }
                else if (typeof o.duration === "string" && o.duration.trim() !== "" && Number.isFinite(Number(o.duration))) {
                    row.duration = Number(o.duration);
                }
                if (o.thumbnailUrl === null) {
                    row.thumbnailUrl = null;
                }
                else if (typeof o.thumbnailUrl === "string" && o.thumbnailUrl.length > 0) {
                    row.thumbnailUrl = o.thumbnailUrl;
                }
                if (typeof o.includeInReport === "boolean") {
                    row.includeInReport = o.includeInReport;
                }
                out.push(row);
            }
        }
    }
    return out;
}
function serializePicAssetVoiceNotes(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const item of raw) {
        if (item instanceof mongodb_1.ObjectId) {
            out.push({ fileId: item.toString() });
            continue;
        }
        if (typeof item === "string" && mongodb_1.ObjectId.isValid(item)) {
            out.push({ fileId: item });
            continue;
        }
        if (item && typeof item === "object" && "url" in item) {
            const u = item.url;
            if (typeof u === "string" && u.length > 0) {
                const o = item;
                const dur = o.duration;
                out.push({
                    url: o.url,
                    publicId: typeof o.publicId === "string" ? o.publicId : undefined,
                    _id: o._id instanceof mongodb_1.ObjectId
                        ? o._id.toString()
                        : typeof o._id === "string"
                            ? o._id
                            : undefined,
                    createdAt: o.createdAt instanceof Date
                        ? o.createdAt.toISOString()
                        : typeof o.createdAt === "string"
                            ? o.createdAt
                            : undefined,
                    duration: typeof dur === "number" && Number.isFinite(dur)
                        ? dur
                        : typeof dur === "string" && /^\d+(\.\d+)?$/.test(dur)
                            ? Number(dur)
                            : undefined,
                });
            }
        }
    }
    return out;
}
function normalizePicAssetMediaArrayForPatch(raw, field) {
    if (!Array.isArray(raw)) {
        throw new common_1.BadRequestException(`${field} must be an array`);
    }
    const out = [];
    for (const item of raw) {
        if (typeof item === "string" && mongodb_1.ObjectId.isValid(item)) {
            out.push(new mongodb_1.ObjectId(item));
            continue;
        }
        if (item && typeof item === "object" && "fileId" in item) {
            const fid = item.fileId;
            if (typeof fid === "string" && mongodb_1.ObjectId.isValid(fid)) {
                out.push(new mongodb_1.ObjectId(fid));
                continue;
            }
        }
        if (item && typeof item === "object" && "url" in item) {
            const o = item;
            if (typeof o.url !== "string" || o.url.length === 0) {
                throw new common_1.BadRequestException(`Invalid ${field} entry: missing url`);
            }
            let oid;
            if (o._id != null) {
                if (o._id instanceof mongodb_1.ObjectId) {
                    oid = o._id;
                }
                else if (typeof o._id === "string" && mongodb_1.ObjectId.isValid(o._id)) {
                    oid = new mongodb_1.ObjectId(o._id);
                }
                else {
                    throw new common_1.BadRequestException(`Invalid ${field} _id`);
                }
            }
            else {
                oid = new mongodb_1.ObjectId();
            }
            let createdAt;
            if (o.createdAt instanceof Date) {
                createdAt = o.createdAt;
            }
            else if (typeof o.createdAt === "string" || typeof o.createdAt === "number") {
                const d = new Date(o.createdAt);
                createdAt = Number.isNaN(d.getTime()) ? new Date() : d;
            }
            else {
                createdAt = new Date();
            }
            const sub = {
                url: o.url,
                _id: oid,
                createdAt,
            };
            if (typeof o.publicId === "string" && o.publicId.length > 0) {
                sub.publicId = o.publicId;
            }
            if (field === "images") {
                if (typeof o.mediaType === "string" && o.mediaType.length > 0) {
                    sub.mediaType = o.mediaType;
                }
                if (typeof o.mimeType === "string" && o.mimeType.length > 0) {
                    sub.mimeType = o.mimeType;
                }
                if (o.thumbnailUrl === null) {
                    sub.thumbnailUrl = null;
                }
                else if (typeof o.thumbnailUrl === "string") {
                    sub.thumbnailUrl = o.thumbnailUrl;
                }
                if (typeof o.includeInReport === "boolean") {
                    sub.includeInReport = o.includeInReport;
                }
                if (o.duration === null) {
                    sub.duration = null;
                }
                else if (typeof o.duration === "number" && Number.isFinite(o.duration)) {
                    sub.duration = o.duration;
                }
                else if (typeof o.duration === "string" && o.duration.trim() !== "" && Number.isFinite(Number(o.duration))) {
                    sub.duration = Number(o.duration);
                }
            }
            if (field === "voiceNotes" && o.duration != null) {
                const d = o.duration;
                if (typeof d === "number" && Number.isFinite(d)) {
                    sub.duration = d;
                }
                else if (typeof d === "string" && d.trim() !== "" && Number.isFinite(Number(d))) {
                    sub.duration = Number(d);
                }
            }
            out.push(sub);
            continue;
        }
        throw new common_1.BadRequestException(`Invalid ${field} entry`);
    }
    return out;
}
function serializeMvSubProject(sub, idFallback) {
    const oid = sub._id ?? idFallback?._id;
    const proj = sub.projectId ?? idFallback?.projectId;
    if (oid == null || proj == null) {
        throw new common_1.BadRequestException("Sub-project record is missing _id or projectId");
    }
    const p = getParentIdFromDoc(sub);
    return {
        _id: oid.toString(),
        projectId: proj.toString(),
        parent: p != null ? p.toString() : null,
        name: sub.name,
        createdAt: mvProjectDateToIso(sub.createdAt),
        updatedAt: mvProjectDateToIso(sub.updatedAt),
    };
}
function serializePicAsset(pic, idFallback) {
    const parentRaw = pic.parent;
    const createdSrc = pic.createdAt ?? pic.importedAt ?? pic.updatedAt;
    const oid = pic._id ?? idFallback?._id;
    const proj = pic.projectId ?? idFallback?.projectId;
    if (oid == null || proj == null) {
        throw new common_1.BadRequestException("Asset record is missing _id or projectId");
    }
    return {
        _id: oid.toString(),
        projectId: proj.toString(),
        parent: parentRaw != null ? parentRaw.toString() : "",
        name: pic.name ?? "",
        importId: pic.importId instanceof mongodb_1.ObjectId ? pic.importId.toString() : null,
        sheetName: typeof pic.sheetName === "string" && pic.sheetName.trim() ? pic.sheetName : null,
        createdAt: mvProjectDateToIso(createdSrc),
        updatedAt: mvProjectDateToIso(pic.updatedAt),
        isAssetFolder: true,
        writtenDescription: pic.writtenDescription,
        condition: pic.condition,
        assetType: normalizeAssetTypeForApi(pic.assetType),
        brand: pic.brand,
        code: pic.code,
        model: pic.model,
        manufactureYear: coerceNumberishField(pic.manufactureYear),
        kilometersDriven: coerceNumberishField(pic.kilometersDriven),
        isPresent: pic.isPresent,
        createdBy: pic.createdBy instanceof mongodb_1.ObjectId
            ? pic.createdBy.toString()
            : pic.createdBy != null
                ? String(pic.createdBy)
                : null,
        images: serializePicAssetImages(pic.images),
        voiceNotes: serializePicAssetVoiceNotes(pic.voiceNotes),
        isDone: pic.isDone === true,
    };
}
function serializePicAssetSummary(pic) {
    const full = serializePicAsset(pic);
    const imgN = typeof pic.imageCount === "number" && Number.isFinite(pic.imageCount)
        ? Math.max(0, Math.floor(pic.imageCount))
        : full.images.length;
    const vnN = typeof pic.voiceNoteCount === "number" && Number.isFinite(pic.voiceNoteCount)
        ? Math.max(0, Math.floor(pic.voiceNoteCount))
        : full.voiceNotes.length;
    return {
        ...full,
        images: [],
        voiceNotes: [],
        imageCount: imgN,
        voiceNoteCount: vnN,
    };
}
function sanitizeColor(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed))
        return undefined;
    return trimmed.toUpperCase();
}
function sanitizeSpreadsheetMeta(meta, rowCount, colCount) {
    if (!meta || typeof meta !== "object")
        return undefined;
    const raw = meta;
    const next = {};
    if (Array.isArray(raw.columnFormats) && raw.columnFormats.length > 0) {
        next.columnFormats = Array.from({ length: colCount }, (_, idx) => {
            const val = raw.columnFormats?.[idx];
            return ALLOWED_COLUMN_FORMATS.has(val ?? "")
                ? val
                : "general";
        });
    }
    if (Array.isArray(raw.columnWidths) && raw.columnWidths.length > 0) {
        next.columnWidths = Array.from({ length: colCount }, (_, idx) => {
            const val = raw.columnWidths?.[idx];
            if (typeof val !== "number" || !Number.isFinite(val))
                return DEFAULT_COLUMN_WIDTH;
            return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(val)));
        });
    }
    if (typeof raw.frozenCols === "number" && Number.isFinite(raw.frozenCols)) {
        next.frozenCols = Math.max(0, Math.min(colCount, Math.round(raw.frozenCols)));
    }
    if (Array.isArray(raw.cellStyles) && raw.cellStyles.length > 0) {
        next.cellStyles = Array.from({ length: rowCount }, (_, rowIndex) => Array.from({ length: colCount }, (_, colIndex) => {
            const style = raw.cellStyles?.[rowIndex]?.[colIndex];
            if (!style || typeof style !== "object")
                return null;
            const normalized = {
                backgroundColor: sanitizeColor(style.backgroundColor),
                textColor: sanitizeColor(style.textColor),
                fontSize: typeof style.fontSize === "number" && Number.isFinite(style.fontSize)
                    ? Math.max(10, Math.min(28, Math.round(style.fontSize)))
                    : undefined,
                fontFamily: ALLOWED_FONT_FAMILIES.has(style.fontFamily ?? "")
                    ? style.fontFamily
                    : undefined,
                fontWeight: ALLOWED_FONT_WEIGHTS.has(style.fontWeight ?? "")
                    ? style.fontWeight
                    : undefined,
                textAlign: ALLOWED_TEXT_ALIGN.has(style.textAlign ?? "")
                    ? style.textAlign
                    : undefined,
            };
            if (!normalized.backgroundColor &&
                !normalized.textColor &&
                !normalized.fontSize &&
                !normalized.fontFamily &&
                !normalized.fontWeight &&
                !normalized.textAlign) {
                return null;
            }
            return normalized;
        }));
    }
    if (!next.columnFormats &&
        !next.columnWidths &&
        next.frozenCols === undefined &&
        !next.cellStyles) {
        return undefined;
    }
    return next;
}
function normalizeSubProjectName(raw) {
    if (typeof raw !== "string")
        return "";
    return raw.trim().replace(/\s+/g, " ");
}
function sanitizeGeneratedFolderName(raw) {
    const normalized = normalizeSubProjectName(String(raw ?? ""));
    if (!normalized)
        return null;
    const cleaned = normalized.replace(/[\\/:*?"<>|]+/g, "-").trim();
    return cleaned.length > 0 ? cleaned : null;
}
function sanitizeUploadedFileName(raw) {
    const base = String(raw ?? "")
        .split(/[\\/]/)
        .pop()
        ?.trim() ?? "";
    const cleaned = base.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").trim();
    return cleaned || "file";
}
function sanitizeUploadedPathPart(raw) {
    const cleaned = String(raw ?? "")
        .trim()
        .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
        .replace(/\s+/g, " ")
        .replace(/^\.+$/, "")
        .trim();
    return cleaned.slice(0, 120);
}
function sanitizeUploadedRelativePath(raw, fallbackFileName) {
    const parts = String(raw ?? "")
        .replace(/\\/g, "/")
        .split("/")
        .map(sanitizeUploadedPathPart)
        .filter(Boolean);
    if (parts.length === 0)
        return fallbackFileName;
    parts[parts.length - 1] = sanitizeUploadedFileName(parts[parts.length - 1]);
    return parts.join("/").slice(0, 900) || fallbackFileName;
}
function folderPathFromRelativePath(relativePath) {
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length <= 1)
        return "";
    return parts.slice(0, -1).join("/");
}
function normalizeMvAssetFolderPath(raw) {
    return String(raw ?? "")
        .trim()
        .replace(/\\/g, "/")
        .split("/")
        .map(sanitizeUploadedPathPart)
        .filter(Boolean)
        .join("/");
}
function extractFileExtension(fileName) {
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot <= 0 || lastDot === fileName.length - 1)
        return undefined;
    return fileName.slice(lastDot + 1).trim().toLowerCase() || undefined;
}
function isLikelyImageUpload(fileName, mimeType) {
    if (mimeType?.toLowerCase().startsWith("image/"))
        return true;
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg|tif|tiff)$/i.test(fileName);
}
function imageExtensionFromMimeType(mimeType) {
    const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (normalized === "image/jpeg" || normalized === "image/jpg")
        return "jpg";
    if (normalized === "image/png")
        return "png";
    if (normalized === "image/gif")
        return "gif";
    if (normalized === "image/webp")
        return "webp";
    if (normalized === "image/bmp")
        return "bmp";
    if (normalized === "image/heic")
        return "heic";
    if (normalized === "image/heif")
        return "heif";
    if (normalized === "image/svg+xml")
        return "svg";
    if (normalized === "image/tiff")
        return "tif";
    return undefined;
}
function fileNameFromExternalAssetImageUrl(url, folderName, imageIndex, mimeType) {
    let lastPathPart = "";
    try {
        lastPathPart = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    }
    catch {
        lastPathPart = "";
    }
    const fromUrl = sanitizeUploadedFileName(lastPathPart);
    if (fromUrl !== "file" && isLikelyImageUpload(fromUrl, mimeType))
        return fromUrl;
    const extension = imageExtensionFromMimeType(mimeType) ?? "jpg";
    const folderBase = sanitizeUploadedPathPart(folderName) || "asset";
    return sanitizeUploadedFileName(`${folderBase}-${imageIndex + 1}.${extension}`);
}
function picAssetExternalImageUrl(raw) {
    if (!raw || typeof raw !== "object" || raw instanceof mongodb_1.ObjectId || !("url" in raw))
        return null;
    const rawUrl = raw.url;
    if (typeof rawUrl !== "string")
        return null;
    const url = rawUrl.trim();
    if (!/^https?:\/\//i.test(url))
        return null;
    return { url, rawUrl };
}
function picAssetImageIncludeInReport(raw) {
    if (!raw || typeof raw !== "object" || raw instanceof mongodb_1.ObjectId)
        return false;
    return raw.includeInReport === true;
}
function picAssetImageDisplayOrder(raw, fallback) {
    if (!raw || typeof raw !== "object" || raw instanceof mongodb_1.ObjectId)
        return fallback;
    const displayOrder = raw.displayOrder;
    if (typeof displayOrder === "number" && Number.isFinite(displayOrder))
        return displayOrder;
    return fallback;
}
async function fetchExternalAssetImageBuffer(url) {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), EXTERNAL_ASSET_IMAGE_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: ac.signal, redirect: "follow" });
        if (!response.ok)
            return null;
        const contentLength = Number(response.headers.get("content-length") ?? "");
        if (Number.isFinite(contentLength) && contentLength > asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES)
            return null;
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
        if (contentType && !contentType.startsWith("image/") && !isLikelyImageUpload(url, contentType)) {
            return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > asset_import_constants_1.ASSET_IMPORT_MAX_FILE_BYTES)
            return null;
        const mimeType = contentType || "image/jpeg";
        if (!isLikelyImageUpload(url, mimeType))
            return null;
        return { data: Buffer.from(arrayBuffer), mimeType };
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timeout);
    }
}
const MV_GRIDFS_PARALLEL_UPLOAD_LIMIT = 24;
async function runWithConcurrency(tasks, limit) {
    if (tasks.length === 0)
        return [];
    const capped = Math.min(Math.max(1, limit), tasks.length);
    const results = new Array(tasks.length);
    let nextIndex = 0;
    async function worker() {
        for (;;) {
            const i = nextIndex++;
            if (i >= tasks.length)
                return;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: capped }, () => worker()));
    return results;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function missingAssetImageFolderPathClause() {
    return {
        $or: [
            { "metadata.folderPath": { $exists: false } },
            { "metadata.folderPath": null },
        ],
    };
}
function assetImageFolderMongoFilter(folderPathNormalized) {
    if (folderPathNormalized === "") {
        return {
            $or: [
                { "metadata.folderPath": "" },
                {
                    $and: [
                        missingAssetImageFolderPathClause(),
                        {
                            $or: [
                                { "metadata.relativePath": { $exists: false } },
                                { "metadata.relativePath": /^[^/]+$/ },
                            ],
                        },
                    ],
                },
            ],
        };
    }
    return {
        $or: [
            { "metadata.folderPath": folderPathNormalized },
            {
                $and: [
                    missingAssetImageFolderPathClause(),
                    { "metadata.relativePath": new RegExp(`^${escapeRegExp(folderPathNormalized)}/[^/]+$`) },
                ],
            },
        ],
    };
}
function compareAssetImageGridDocs(a, b) {
    const oa = a.metadata?.displayOrder;
    const ob = b.metadata?.displayOrder;
    if (typeof oa === "number" && typeof ob === "number" && oa !== ob)
        return oa - ob;
    if (typeof oa === "number" && typeof ob !== "number")
        return -1;
    if (typeof oa !== "number" && typeof ob === "number")
        return 1;
    const pa = String(a.metadata?.relativePath || "").replace(/\\/g, "/");
    const pb = String(b.metadata?.relativePath || "").replace(/\\/g, "/");
    const cmp = pa.localeCompare(pb, "ar", { sensitivity: "base", numeric: true });
    if (cmp !== 0)
        return cmp;
    const da = a.uploadDate instanceof Date ? a.uploadDate.getTime() : 0;
    const dbt = b.uploadDate instanceof Date ? b.uploadDate.getTime() : 0;
    return da - dbt;
}
function mapStoredFileDoc(doc) {
    const uploadDate = doc.uploadDate instanceof Date ? doc.uploadDate : new Date();
    const updatedAt = doc.metadata?.updatedAt instanceof Date ? doc.metadata.updatedAt : uploadDate;
    return {
        _id: doc._id.toString(),
        projectId: doc.metadata?.projectId?.toString?.() ?? "",
        subProjectId: doc.metadata?.subProjectId?.toString?.(),
        picAssetId: doc.metadata?.picAssetId?.toString?.(),
        name: doc.metadata?.originalFileName || doc.filename || "file",
        scope: doc.metadata?.scope,
        relativePath: doc.metadata?.relativePath ||
            doc.metadata?.originalFileName ||
            doc.filename ||
            "file",
        folderPath: doc.metadata?.folderPath ??
            folderPathFromRelativePath(doc.metadata?.relativePath ||
                doc.metadata?.originalFileName ||
                doc.filename ||
                "file"),
        mimeType: doc.metadata?.mimeType || "application/octet-stream",
        extension: doc.metadata?.extension ||
            extractFileExtension(doc.metadata?.originalFileName || doc.filename || ""),
        sizeBytes: typeof doc.length === "number" ? doc.length : 0,
        uploadedAt: uploadDate.toISOString(),
        updatedAt: updatedAt.toISOString(),
        displayOrder: typeof doc.metadata?.displayOrder === "number" ? doc.metadata.displayOrder : undefined,
        includeInReport: doc.metadata?.includeInReport === true,
        ...(typeof doc.metadata?.sourceUrl === "string" && doc.metadata.sourceUrl.length > 0
            ? { sourceUrl: doc.metadata.sourceUrl }
            : {}),
    };
}
function picAssetImageFileObjectId(raw) {
    if (raw instanceof mongodb_1.ObjectId)
        return raw;
    if (typeof raw === "string")
        return (0, object_id_util_1.tryParseObjectId)(raw);
    if (raw && typeof raw === "object" && "fileId" in raw) {
        const fileId = raw.fileId;
        if (fileId instanceof mongodb_1.ObjectId)
            return fileId;
        return typeof fileId === "string" ? (0, object_id_util_1.tryParseObjectId)(fileId) : null;
    }
    return null;
}
async function uploadExternalPicAssetImageToGridFs(db, projectId, ref) {
    const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
    const existing = await col.findOne({
        "metadata.projectId": projectId,
        "metadata.scope": "asset-images",
        "metadata.picAssetId": ref.picAssetId,
        "metadata.sourceUrl": ref.url,
        "metadata.displayOrder": ref.displayOrder,
    });
    if (existing)
        return existing._id;
    const fetched = await fetchExternalAssetImageBuffer(ref.url);
    if (!fetched)
        return null;
    const fileName = fileNameFromExternalAssetImageUrl(ref.url, ref.folderName, ref.imageIndex, fetched.mimeType);
    const folderPath = normalizeMvAssetFolderPath(ref.folderName || "asset");
    const relativePath = sanitizeUploadedRelativePath(folderPath ? `${folderPath}/${fileName}` : fileName, fileName);
    const now = new Date();
    const metadata = {
        projectId,
        picAssetId: ref.picAssetId,
        scope: "asset-images",
        relativePath,
        folderPath,
        mimeType: fetched.mimeType,
        extension: extractFileExtension(fileName) ?? imageExtensionFromMimeType(fetched.mimeType),
        originalFileName: fileName,
        updatedAt: now,
        includeInReport: ref.includeInReport,
        displayOrder: ref.displayOrder,
        sourceUrl: ref.url,
    };
    const bucket = new mongodb_1.GridFSBucket(db, { bucketName: collections_2.MV_FILES_BUCKET });
    return new Promise((resolve, reject) => {
        const uploadStream = bucket.openUploadStream(fileName, { metadata });
        uploadStream.on("error", reject);
        uploadStream.on("finish", () => resolve(uploadStream.id));
        uploadStream.end(fetched.data);
    });
}
async function backfillPicAssetGridFsImagesAsAssetFiles(db, projectId) {
    const picFolders = await db
        .collection(collections_3.ASSETS_COLLECTION)
        .find({
        projectId,
        ...MV_PHOTO_FOLDER_FILTER,
        images: { $exists: true, $ne: [] },
    })
        .project({
        _id: 1,
        name: 1,
        images: 1,
    })
        .toArray();
    const refsByFileId = new Map();
    const externalRefs = [];
    for (const folder of picFolders) {
        const images = Array.isArray(folder.images) ? folder.images : [];
        images.forEach((image, imageIndex) => {
            const fileId = picAssetImageFileObjectId(image);
            const folderName = sanitizeUploadedPathPart(folder.name || "asset");
            if (fileId) {
                const key = fileId.toString();
                if (refsByFileId.has(key))
                    return;
                refsByFileId.set(key, {
                    fileId,
                    picAssetId: folder._id,
                    folderName,
                    imageIndex,
                });
                return;
            }
            const external = picAssetExternalImageUrl(image);
            if (!external)
                return;
            externalRefs.push({
                picAssetId: folder._id,
                folderName,
                imageIndex,
                url: external.url,
                rawUrl: external.rawUrl,
                includeInReport: picAssetImageIncludeInReport(image),
                displayOrder: picAssetImageDisplayOrder(image, imageIndex),
            });
        });
    }
    for (const ref of externalRefs) {
        try {
            await uploadExternalPicAssetImageToGridFs(db, projectId, ref);
        }
        catch {
        }
    }
    if (refsByFileId.size === 0)
        return;
    const fileIds = Array.from(refsByFileId.values()).map((ref) => ref.fileId);
    const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
    const docs = await col
        .find({
        _id: { $in: fileIds },
        $or: [
            { "metadata.projectId": projectId },
            { "metadata.projectId": projectId.toString() },
            { "metadata.projectId": { $exists: false } },
            { "metadata.projectId": null },
        ],
    })
        .toArray();
    const now = new Date();
    const ops = [];
    for (const doc of docs) {
        const ref = refsByFileId.get(doc._id.toString());
        if (!ref)
            continue;
        const existingPicAssetId = doc.metadata?.picAssetId?.toString?.() ?? "";
        const needsPathBackfill = doc.metadata?.scope !== "asset-images" ||
            existingPicAssetId !== ref.picAssetId.toString() ||
            typeof doc.metadata?.relativePath !== "string" ||
            typeof doc.metadata?.folderPath !== "string";
        const needsDisplayOrderBackfill = typeof doc.metadata?.displayOrder !== "number";
        const needsMetadataBackfill = doc.metadata?.projectId?.toString?.() !== projectId.toString() ||
            doc.metadata?.scope !== "asset-images" ||
            existingPicAssetId !== ref.picAssetId.toString() ||
            needsPathBackfill ||
            typeof doc.metadata?.originalFileName !== "string" ||
            doc.metadata?.includeInReport === undefined ||
            needsDisplayOrderBackfill;
        if (!needsMetadataBackfill)
            continue;
        const folderPath = needsPathBackfill
            ? normalizeMvAssetFolderPath(ref.folderName || "asset")
            : normalizeMvAssetFolderPath(doc.metadata?.folderPath ?? "");
        const fileName = sanitizeUploadedFileName(doc.metadata?.originalFileName || doc.filename || `image-${ref.imageIndex + 1}.jpg`);
        const relativePath = needsPathBackfill
            ? sanitizeUploadedRelativePath(folderPath ? `${folderPath}/${fileName}` : fileName, fileName)
            : doc.metadata?.relativePath;
        const setMeta = {
            "metadata.projectId": projectId,
            "metadata.picAssetId": ref.picAssetId,
            "metadata.scope": "asset-images",
            "metadata.folderPath": folderPath,
            "metadata.relativePath": relativePath,
            "metadata.originalFileName": doc.metadata?.originalFileName || fileName,
            "metadata.updatedAt": now,
            "metadata.includeInReport": doc.metadata?.includeInReport === true,
        };
        if (needsDisplayOrderBackfill) {
            setMeta["metadata.displayOrder"] = ref.imageIndex;
        }
        ops.push({
            updateOne: {
                filter: { _id: doc._id },
                update: { $set: setMeta },
            },
        });
    }
    if (ops.length > 0) {
        await col.bulkWrite(ops, { ordered: false });
    }
}
let MachineValuationService = MachineValuationService_1 = class MachineValuationService {
    constructor(inspectorSpaces) {
        this.inspectorSpaces = inspectorSpaces;
        this.logger = new common_1.Logger(MachineValuationService_1.name);
    }
    async migratePhotoFolderAssetsRemoveSubProjectIdField(db) {
        const col = db.collection(collections_3.ASSETS_COLLECTION);
        try {
            const picIdx = await col.listIndexes().toArray();
            for (const spec of picIdx) {
                if (spec.name === "_id_")
                    continue;
                const key = spec.key;
                if (key && Object.prototype.hasOwnProperty.call(key, "subProjectId") && spec.name) {
                    await col.dropIndex(spec.name);
                }
            }
        }
        catch {
        }
        await col
            .updateMany({ ...MV_PHOTO_FOLDER_FILTER, subProjectId: { $exists: true } }, { $unset: { subProjectId: "" } })
            .catch(() => undefined);
    }
    async dropAbandonedLegacyPhotoStorageCollection(db) {
        const legacyName = "pic_assets";
        try {
            const listed = await db.listCollections({ name: legacyName }).toArray();
            if (listed.length === 0)
                return;
            const coll = db.collection(legacyName);
            const n = await coll.estimatedDocumentCount().catch(() => 0);
            if (n > 0) {
                this.logger.warn(`Removing legacy DB collection (${n} doc(s)). Application storage is assets only; migrate data beforehand if needed.`);
            }
            await coll.drop();
            this.logger.log("Unified storage: assets collection only.");
        }
        catch (e) {
            this.logger.warn(`Legacy storage cleanup: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    async onModuleInit() {
        const db = await (0, mongodb_2.getMongoDb)();
        await this.dropAbandonedLegacyPhotoStorageCollection(db);
        const mvCol = db.collection(collections_2.MV_PROJECTS_COLLECTION);
        await mvCol.createIndex({ companyId: 1 }).catch(() => undefined);
        await mvCol.createIndex({ companyId: 1, createdAt: -1 }).catch(() => undefined);
        await mvCol.createIndex({ userId: 1 }).catch(() => undefined);
        await mvCol
            .updateMany({ $or: [{ locations: { $exists: false } }, { locations: null }] }, { $set: { locations: [] } })
            .catch(() => undefined);
        await mvCol
            .updateMany({ $or: [{ contacts: { $exists: false } }, { contacts: null }] }, { $set: { contacts: [] } })
            .catch(() => undefined);
        const { userCompanyMemberships } = (0, collections_1.getAuthCollections)(db);
        const missingCompanyFilter = {
            $or: [
                { companyId: { $exists: false } },
                { companyId: null },
                { companyId: "" },
            ],
        };
        const orphans = await mvCol
            .find(missingCompanyFilter)
            .project({ _id: 1, userId: 1 })
            .toArray();
        const now = new Date();
        for (const p of orphans) {
            const uid = (0, object_id_util_1.tryCoerceToObjectId)(p.userId);
            if (!uid)
                continue;
            const mems = await userCompanyMemberships
                .find({ userId: uid })
                .sort({ createdAt: 1 })
                .toArray();
            if (mems.length === 0)
                continue;
            const chosenCompanyId = mems[0].companyId;
            await mvCol.updateOne({ _id: p._id }, { $set: { companyId: chosenCompanyId, updatedAt: now } });
        }
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const photoAssets = db.collection(collections_3.ASSETS_COLLECTION);
        const itCol = db.collection(collections_2.MV_ITEMS_COLLECTION);
        await this.migratePhotoFolderAssetsRemoveSubProjectIdField(db);
        await photoAssets.createIndex({ projectId: 1, parent: 1 }).catch(() => undefined);
        await itCol.createIndex({ projectId: 1 }).catch(() => undefined);
        const toRename = await sp
            .find({ parentSubProjectId: { $exists: true } })
            .toArray();
        for (const row of toRename) {
            const pse = row.parentSubProjectId;
            if (!pse)
                continue;
            await sp.updateOne({ _id: row._id }, { $set: { parent: pse }, $unset: { parentSubProjectId: "" } });
        }
        await sp
            .updateMany({
            $and: [
                { parent: { $exists: false } },
                { parentSubProjectId: { $exists: false } },
            ],
        }, { $set: { parent: null, updatedAt: new Date() } })
            .catch(() => undefined);
        const photosRootMvFilter = {
            name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
            $or: [
                { parent: null },
                {
                    $and: [
                        { parent: { $exists: false } },
                        { parentSubProjectId: { $exists: false } },
                    ],
                },
            ],
        };
        const legacyPhotosInMv = await sp.find(photosRootMvFilter).toArray();
        for (const leg of legacyPhotosInMv) {
            const d = leg;
            const existsInItems = await itCol.findOne({ _id: d._id, projectId: d.projectId });
            if (existsInItems) {
                await sp.deleteOne({ _id: d._id, projectId: d.projectId }).catch(() => undefined);
                continue;
            }
            try {
                await itCol.insertOne({
                    _id: d._id,
                    projectId: d.projectId,
                    parent: getParentIdFromDoc(d) ?? null,
                    name: d.name,
                    createdAt: d.createdAt,
                    updatedAt: d.updatedAt,
                });
                await sp.deleteOne({ _id: d._id, projectId: d.projectId });
            }
            catch (e) {
                this.logger.warn(`migrate 2.صور المعاينة to items: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        try {
            const picIdByProject = await photoAssets
                .aggregate([
                { $match: MV_PHOTO_FOLDER_FILTER },
                { $group: { _id: "$projectId", picIds: { $addToSet: "$_id" } } },
            ])
                .toArray();
            for (const row of picIdByProject) {
                if (row._id == null || !row.picIds?.length)
                    continue;
                await sp.deleteMany({ projectId: row._id, _id: { $in: row.picIds } });
            }
        }
        catch (e) {
            this.logger.warn(`Remove mv_subprojects rows duplicated with photo-folder asset _id: ${e instanceof Error ? e.message : String(e)}`);
        }
        const legacyWithAssets = await sp
            .find({
            $or: [
                { isAssetFolder: { $exists: true } },
                { images: { $exists: true } },
                { writtenDescription: { $exists: true } },
            ],
        })
            .toArray();
        const nowM = new Date();
        for (const doc of legacyWithAssets) {
            const d = doc;
            if (!getParentIdFromDoc(d))
                continue;
            const p0 = getParentIdFromDoc(d);
            const hasPic = await photoAssets.findOne({
                projectId: d.projectId,
                parent: p0,
                name: d.name,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (hasPic) {
                await sp.updateOne({ _id: d._id }, {
                    $unset: {
                        isAssetFolder: "",
                        writtenDescription: "",
                        condition: "",
                        assetType: "",
                        brand: "",
                        code: "",
                        model: "",
                        manufactureYear: "",
                        kilometersDriven: "",
                        isPresent: "",
                        createdBy: "",
                        images: "",
                        voiceNotes: "",
                        isDone: "",
                    },
                });
                continue;
            }
            const p = getParentIdFromDoc(d);
            const pad = {
                projectId: d.projectId,
                parent: p,
                name: d.name,
                createdAt: d.createdAt,
                updatedAt: nowM,
                isAssetFolder: true,
                writtenDescription: d.writtenDescription ?? null,
                condition: d.condition ?? null,
                assetType: (d.assetType ?? "other"),
                brand: d.brand ?? null,
                code: d.code ?? null,
                model: d.model ?? null,
                manufactureYear: d.manufactureYear ?? null,
                kilometersDriven: d.kilometersDriven ?? null,
                isPresent: d.isPresent !== false,
                createdBy: (0, object_id_util_1.tryCoerceToObjectId)(d.createdBy) ?? null,
                images: d.images ?? [],
                voiceNotes: d.voiceNotes ?? [],
                isDone: true,
            };
            const shell = buildPicAssetDocument(pad.projectId, pad.parent, pad.name, nowM, pad.createdBy);
            await photoAssets.insertOne({
                ...shell,
                writtenDescription: pad.writtenDescription,
                condition: pad.condition,
                assetType: pad.assetType,
                brand: pad.brand,
                code: pad.code,
                model: pad.model,
                manufactureYear: pad.manufactureYear,
                kilometersDriven: pad.kilometersDriven,
                isPresent: pad.isPresent,
                images: pad.images,
                voiceNotes: pad.voiceNotes,
                isDone: true,
                createdAt: pad.createdAt,
                importedAt: pad.createdAt,
                updatedAt: pad.updatedAt,
            });
            await sp.updateOne({ _id: d._id }, {
                $unset: {
                    isAssetFolder: "",
                    writtenDescription: "",
                    condition: "",
                    assetType: "",
                    brand: "",
                    code: "",
                    model: "",
                    manufactureYear: "",
                    kilometersDriven: "",
                    isPresent: "",
                    createdBy: "",
                    images: "",
                    voiceNotes: "",
                    isDone: "",
                },
            });
        }
    }
    buildProjectsVisibleToCompanyFilter(companyIdStr) {
        const coId = (0, object_id_util_1.tryParseObjectId)(companyIdStr);
        if (!coId)
            return { _id: { $in: [] } };
        return {
            $or: [
                { companyId: coId },
                { companyId: coId.toString() },
            ],
        };
    }
    assertProjectInScope(project, ctx) {
        if (ctx.isSuperAdmin)
            return;
        if (!ctx.companyId) {
            throw new common_1.NotFoundException("Project not found");
        }
        const ctxCo = (0, object_id_util_1.tryParseObjectId)(ctx.companyId);
        if (!ctxCo) {
            throw new common_1.NotFoundException("Project not found");
        }
        if ((0, mv_project_scope_util_1.mvProjectSharesCompany)(project, ctxCo)) {
            return;
        }
        throw new common_1.NotFoundException("Project not found");
    }
    async assertInspectorAccessToFolderId(db, projectId, folderId, ctx) {
        if (ctx.userRole !== "inspector")
            return;
        const mvList = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find({ projectId })
            .toArray();
        const itemList = await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .find({ projectId })
            .toArray();
        const picList = await db
            .collection(collections_3.ASSETS_COLLECTION)
            .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
            .toArray();
        const fromMv = mvList.map((m) => {
            const p = getParentIdFromDoc(m);
            return {
                _id: m._id.toString(),
                name: m.name,
                parent: p != null ? p.toString() : null,
            };
        });
        const fromItems = itemList.map((m) => {
            const p = getParentIdFromDoc(m);
            return {
                _id: m._id.toString(),
                name: m.name,
                parent: p != null ? p.toString() : null,
            };
        });
        const mvKeySet = new Set();
        for (const m of mvList) {
            const k = picMatchKeyForMvSub(m);
            if (k)
                mvKeySet.add(k);
        }
        for (const m of itemList) {
            const k = picMatchKeyForMvSub(m);
            if (k)
                mvKeySet.add(k);
        }
        const standalonePics = picList.filter((p) => !mvKeySet.has(picMatchKeyForPicDoc(p)));
        const fromPics = standalonePics
            .filter((p) => p.parent != null)
            .map((p) => ({
            _id: p._id.toString(),
            name: p.name ?? "",
            parent: p.parent.toString(),
        }));
        const combined = [...fromMv, ...fromItems, ...fromPics];
        const allowed = new Set(filterFolderEntriesForInspector(combined, DEFAULT_PHOTOS_SUBFOLDER_NAME).map((e) => e._id));
        if (!allowed.has(folderId.toString())) {
            throw new common_1.NotFoundException("Sub-project not found");
        }
    }
    async loadProjectForAccess(db, projectId, ctx) {
        const project = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOne({ _id: projectId });
        if (!project)
            throw new common_1.NotFoundException("Project not found");
        this.assertProjectInScope(project, ctx);
        return project;
    }
    async upsertPicAssetFoldersOnly(db, projectId, photosParentId, names, createdBy) {
        const uniqueNames = Array.from(new Set(names.map((n) => normalizeSubProjectName(n)).filter(Boolean)));
        if (uniqueNames.length === 0) {
            return { created: [], existing: [] };
        }
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const existing = await pa
            .find({
            projectId,
            parent: photosParentId,
            name: { $in: uniqueNames },
            ...MV_PHOTO_FOLDER_FILTER,
        })
            .toArray();
        const existingNames = new Set(existing.map((d) => normalizeSubProjectName(d.name)));
        const toCreate = uniqueNames.filter((n) => !existingNames.has(n));
        const now = new Date();
        const created = [];
        for (const name of toCreate) {
            const ins = buildPicAssetDocument(projectId, photosParentId, name, now, createdBy);
            const r = await pa.insertOne(ins);
            const row = await pa.findOne({ _id: r.insertedId });
            if (row)
                created.push(row);
        }
        return { created, existing: existing };
    }
    async upsertSubProjects(db, projectId, names, parentId, newDocExtras) {
        const uniqueNames = Array.from(new Set(names.map((name) => normalizeSubProjectName(name)).filter(Boolean)));
        if (uniqueNames.length === 0) {
            return { created: [], existing: [] };
        }
        const filter = {
            projectId,
            name: { $in: uniqueNames },
        };
        if (parentId) {
            filter.$or = [
                { parent: parentId },
                { parentSubProjectId: parentId },
            ];
        }
        else {
            filter.$or = [
                { parent: null },
                {
                    $and: [
                        { parent: { $exists: false } },
                        { parentSubProjectId: { $exists: false } },
                    ],
                },
            ];
        }
        const existing = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find(filter)
            .toArray();
        const existingNames = new Set(existing.map((doc) => normalizeSubProjectName(doc.name)));
        const toCreate = uniqueNames.filter((name) => !existingNames.has(name));
        const now = new Date();
        const extras = newDocExtras ?? {};
        const docs = toCreate.map((name) => ({
            ...extras,
            projectId,
            parent: parentId === undefined ? null : parentId,
            name,
            createdAt: now,
            updatedAt: now,
        }));
        const created = [];
        if (toCreate.length > 0) {
            const result = await db
                .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                .insertMany(docs);
            toCreate.forEach((_, index) => {
                const doc = docs[index];
                const _id = result.insertedIds[index];
                created.push({ _id, ...doc });
            });
        }
        return { created, existing };
    }
    async collectDescendantSubProjectIds(db, projectId, rootId) {
        const subs = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find({ projectId })
            .project({ _id: 1, parent: 1, parentSubProjectId: 1 })
            .toArray();
        const childrenByParent = new Map();
        for (const sub of subs) {
            const par = getParentIdFromDoc(sub);
            if (par == null)
                continue;
            const key = par.toString();
            const bucket = childrenByParent.get(key);
            if (bucket)
                bucket.push(sub._id);
            else
                childrenByParent.set(key, [sub._id]);
        }
        const ids = [];
        const queue = [rootId];
        while (queue.length > 0) {
            const current = queue.shift();
            ids.push(current);
            const children = childrenByParent.get(current.toString()) ?? [];
            queue.push(...children);
        }
        return ids;
    }
    async collectDescendantPicAssetIds(db, projectId, rootPicId) {
        const pics = await db
            .collection(collections_3.ASSETS_COLLECTION)
            .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
            .project({ _id: 1, parent: 1 })
            .toArray();
        const childrenByParent = new Map();
        for (const p of pics) {
            if (p.parent == null)
                continue;
            const key = p.parent.toString();
            const bucket = childrenByParent.get(key);
            if (bucket)
                bucket.push(p._id);
            else
                childrenByParent.set(key, [p._id]);
        }
        const out = [];
        const queue = [rootPicId];
        while (queue.length > 0) {
            const current = queue.shift();
            out.push(current);
            const children = childrenByParent.get(current.toString()) ?? [];
            queue.push(...children);
        }
        return out;
    }
    async collectAllPicForMvDeletion(db, projectId, mvIds) {
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const all = (await db
            .collection(collections_3.ASSETS_COLLECTION)
            .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
            .toArray());
        const mvIdSet = new Set(mvIds.map((id) => id.toString()));
        const toDel = new Set();
        for (const mid of mvIds) {
            const m = (await sp.findOne({ _id: mid, projectId })) ?? (await it.findOne({ _id: mid, projectId }));
            if (!m)
                continue;
            const pFolder = getParentIdFromDoc(m);
            if (pFolder == null)
                continue;
            for (const pRow of all) {
                if (pRow.parent == null)
                    continue;
                if (pRow.parent.equals(pFolder) &&
                    normalizeSubProjectName(pRow.name ?? "") === normalizeSubProjectName(m.name)) {
                    toDel.add(pRow._id.toString());
                }
            }
        }
        for (const p of all) {
            if (p.parent == null)
                continue;
            if (mvIdSet.has(p.parent.toString())) {
                toDel.add(p._id.toString());
            }
        }
        let added = true;
        while (added) {
            added = false;
            for (const p of all) {
                if (toDel.has(p._id.toString()))
                    continue;
                if (p.parent == null)
                    continue;
                if (toDel.has(p.parent.toString())) {
                    toDel.add(p._id.toString());
                    added = true;
                }
            }
        }
        const candidate = [...toDel].map((s) => new mongodb_1.ObjectId(s));
        const existing = await db
            .collection(collections_3.ASSETS_COLLECTION)
            .find({ projectId, _id: { $in: candidate }, ...MV_PHOTO_FOLDER_FILTER })
            .project({ _id: 1 })
            .toArray();
        return existing.map((d) => d._id);
    }
    async isInPhotosHoldingSubtree(db, projectId, photosRootId, folderId) {
        if (folderId.equals(photosRootId))
            return true;
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const seen = new Set();
        let cur = folderId;
        while (cur) {
            if (cur.equals(photosRootId))
                return true;
            if (seen.has(cur.toString()))
                return false;
            seen.add(cur.toString());
            const mv = await sp.findOne({ _id: cur, projectId });
            if (mv) {
                const parentRef = getParentIdFromDoc(mv);
                if (parentRef == null)
                    return false;
                cur = parentRef;
                continue;
            }
            const itDoc = await it.findOne({ _id: cur, projectId });
            if (itDoc) {
                const parentRef = getParentIdFromDoc(itDoc);
                if (parentRef == null)
                    return false;
                cur = parentRef;
                continue;
            }
            const picDoc = (await pa.findOne({ _id: cur, projectId, ...MV_PHOTO_FOLDER_FILTER }));
            if (picDoc) {
                const pPar = picDoc.parent;
                if (pPar == null)
                    return false;
                cur = pPar;
                continue;
            }
            return false;
        }
        return false;
    }
    async ensureInspectionPhotosItemInItems(db, projectId) {
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const existing = await it.findOne({
            projectId,
            name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
            $or: [
                { parent: null },
                {
                    $and: [
                        { parent: { $exists: false } },
                        { parentSubProjectId: { $exists: false } },
                    ],
                },
            ],
        });
        if (existing)
            return existing;
        const now = new Date();
        const ins = await it.insertOne({
            projectId,
            parent: null,
            name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
            createdAt: now,
            updatedAt: now,
        });
        const row = await it.findOne({ _id: ins.insertedId });
        if (!row)
            throw new common_1.BadRequestException("Could not prepare the inspection photos folder");
        return row;
    }
    async ensurePhotosRootFolder(db, projectId) {
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const fromItems = await it.findOne({
            projectId,
            name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
            $or: [
                { parent: null },
                {
                    $and: [
                        { parent: { $exists: false } },
                        { parentSubProjectId: { $exists: false } },
                    ],
                },
            ],
        });
        if (fromItems)
            return fromItems;
        const legacy = await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
            projectId,
            name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
            $or: [
                { parent: null },
                {
                    $and: [
                        { parent: { $exists: false } },
                        { parentSubProjectId: { $exists: false } },
                    ],
                },
            ],
        });
        if (legacy) {
            const doc = {
                projectId: legacy.projectId,
                parent: getParentIdFromDoc(legacy) ?? null,
                name: legacy.name,
                createdAt: legacy.createdAt,
                updatedAt: legacy.updatedAt,
            };
            try {
                await it.insertOne({ _id: legacy._id, ...doc });
            }
            catch (e) {
                const code = e && typeof e === "object" ? e.code : undefined;
                if (code !== 11000)
                    throw e;
            }
            await db
                .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                .deleteOne({ _id: legacy._id, projectId });
            const moved = await it.findOne({ _id: legacy._id, projectId });
            if (moved)
                return moved;
        }
        return this.ensureInspectionPhotosItemInItems(db, projectId);
    }
    getFilesBucket(db) {
        return new mongodb_1.GridFSBucket(db, { bucketName: collections_2.MV_FILES_BUCKET });
    }
    async assertSubProjectContext(db, projectId, subProjectId, ctx) {
        await this.loadProjectForAccess(db, projectId, ctx);
        if (subProjectId) {
            const inMv = await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
                _id: subProjectId,
                projectId,
            });
            const inItem = await db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({
                _id: subProjectId,
                projectId,
            });
            const inPic = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                _id: subProjectId,
                projectId,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (!inMv && !inItem && !inPic) {
                throw new common_1.NotFoundException("Sub-project not found");
            }
            if (ctx.userRole === "inspector") {
                await this.assertInspectorAccessToFolderId(db, projectId, subProjectId, ctx);
            }
        }
    }
    async deleteStoredFiles(db, filter) {
        const bucket = this.getFilesBucket(db);
        const files = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .find(filter, { projection: { _id: 1, metadata: 1 } })
            .toArray();
        for (const file of files) {
            const meta = file.metadata;
            if (meta?.storage === "digitalocean" && meta.spacesKey?.trim()) {
                try {
                    await this.inspectorSpaces.deleteObject(meta.spacesKey.trim());
                }
                catch (err) {
                    this.logger.warn(`deleteStoredFiles Spaces: ${err instanceof Error ? err.message : String(err)}`);
                }
                await db.collection(collections_2.MV_FILES_FILES_COLLECTION).deleteOne({ _id: file._id });
            }
            else {
                try {
                    await bucket.delete(file._id);
                }
                catch (err) {
                    this.logger.warn(`deleteStoredFiles GridFS: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        return files.length;
    }
    async getStoredFileDoc(db, projectId, fileId) {
        const file = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .findOne({
            _id: fileId,
            "metadata.projectId": projectId,
        });
        if (!file)
            throw new common_1.NotFoundException("File not found");
        return file;
    }
    async listProjects(ctx) {
        if (!ctx.isSuperAdmin) {
            if (!ctx.userId) {
                throw new common_1.UnauthorizedException("يجب تسجيل الدخول لعرض مشاريع التقييم.");
            }
            if (!ctx.companyId) {
                throw new common_1.ForbiddenException("يجب أن يكون حسابك مرتبطاً بشركة لعرض مشاريع تقييم الآلات والمعدات.");
            }
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const col = db.collection(collections_2.MV_PROJECTS_COLLECTION);
        const projectListProject = {
            name: 1,
            companyId: 1,
            createdAt: 1,
            updatedAt: 1,
            userId: 1,
            workflowStatus: 1,
            reportType: 1,
            locations: 1,
            contacts: 1,
        };
        let projects;
        if (ctx.isSuperAdmin) {
            projects = (await col
                .find({})
                .project(projectListProject)
                .sort({ createdAt: -1 })
                .toArray());
        }
        else if (ctx.companyId) {
            const filter = this.buildProjectsVisibleToCompanyFilter(ctx.companyId);
            projects = (await col
                .find(filter)
                .project(projectListProject)
                .sort({ createdAt: -1 })
                .toArray());
        }
        else {
            projects = [];
        }
        if (projects.length === 0) {
            return [];
        }
        const projectIds = projects.map((p) => p._id);
        const matchInProjects = { $match: { projectId: { $in: projectIds } } };
        const groupByProject = { $group: { _id: "$projectId", count: { $sum: 1 } } };
        const [counts, itemCounts, sheetAgg] = await Promise.all([
            db
                .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                .aggregate([matchInProjects, groupByProject])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: subProject aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }),
            db
                .collection(collections_2.MV_ITEMS_COLLECTION)
                .aggregate([matchInProjects, groupByProject])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: items aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }),
            db
                .collection(collections_2.MV_SHEETS_COLLECTION)
                .aggregate([matchInProjects, groupByProject])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: sheet aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }),
        ]);
        const countMap = new Map(counts
            .filter((c) => c._id != null)
            .map((c) => [c._id.toString(), toSafeNonNegativeInt(c.count)]));
        const itemMap = new Map(itemCounts
            .filter((c) => c._id != null)
            .map((c) => [c._id.toString(), toSafeNonNegativeInt(c.count)]));
        const sheetMap = new Map(sheetAgg
            .filter((c) => c._id != null)
            .map((c) => [c._id.toString(), toSafeNonNegativeInt(c.count)]));
        const creatorIds = Array.from(new Set(projects
            .map((project) => (0, object_id_util_1.tryCoerceToObjectId)(project.userId))
            .filter((value) => value != null)));
        const creatorNameMap = new Map();
        if (creatorIds.length > 0) {
            try {
                const creatorRows = await (0, collections_1.getAuthCollections)(db).users
                    .find({ _id: { $in: creatorIds } })
                    .project({ _id: 1, username: 1 })
                    .toArray();
                for (const user of creatorRows) {
                    if (user?._id == null)
                        continue;
                    creatorNameMap.set(user._id.toString(), String(user.username ?? ""));
                }
            }
            catch (err) {
                this.logger.warn(`listProjects: user lookup failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return projects
            .map((p) => {
            const idStr = mvProjectIdString(p);
            if (!idStr) {
                this.logger.warn("listProjects: skipped project with missing/invalid _id");
                return null;
            }
            return {
                _id: idStr,
                name: String(p.name ?? ""),
                companyId: (() => {
                    const c = p.companyId;
                    if (c === undefined || c === null || c === "")
                        return null;
                    if (c instanceof mongodb_1.ObjectId)
                        return c.toString();
                    return String(c).trim() || null;
                })(),
                createdAt: mvProjectDateToIso(p.createdAt),
                updatedAt: mvProjectDateToIso(p.updatedAt),
                subProjectCount: toSafeNonNegativeInt(countMap.get(idStr)) + toSafeNonNegativeInt(itemMap.get(idStr)),
                sheetCount: toSafeNonNegativeInt(sheetMap.get(idStr)),
                workflowStatus: projectWorkflowStatus(p),
                reportType: projectReportType(p),
                locations: sanitizeProjectLocations(p.locations, false),
                contacts: sanitizeProjectContacts(p.contacts, false),
                createdByUserId: (() => {
                    const id = (0, object_id_util_1.tryCoerceToObjectId)(p.userId);
                    return id?.toString() ?? (typeof p.userId === "string" ? p.userId : null);
                })(),
                createdByName: (() => {
                    const id = (0, object_id_util_1.tryCoerceToObjectId)(p.userId);
                    return id ? creatorNameMap.get(id.toString()) ?? null : null;
                })(),
            };
        })
            .filter((row) => row != null);
    }
    async createProject(name, ctx, companyIdForSuperAdmin, reportTypeRaw, locationsRaw, contactsRaw) {
        const n = name?.trim();
        if (!n)
            throw new common_1.BadRequestException("Project name is required");
        let resolvedCompanyId;
        if (ctx.isSuperAdmin) {
            const raw = companyIdForSuperAdmin?.trim();
            if (!raw) {
                throw new common_1.BadRequestException("companyId is required");
            }
            const coId = (0, object_id_util_1.tryParseObjectId)(raw);
            if (!coId) {
                throw new common_1.BadRequestException("Invalid companyId");
            }
            const dbCheck = await (0, mongodb_2.getMongoDb)();
            const co = await (0, collections_1.getAuthCollections)(dbCheck).companies.findOne({ _id: coId });
            if (!co) {
                throw new common_1.BadRequestException("Invalid companyId");
            }
            resolvedCompanyId = coId;
        }
        else {
            if (!ctx.userId)
                throw new common_1.UnauthorizedException("Login required");
            if (!ctx.companyId) {
                throw new common_1.ForbiddenException("Company membership required");
            }
            const cid = (0, object_id_util_1.tryParseObjectId)(ctx.companyId);
            if (!cid) {
                throw new common_1.ForbiddenException("Company membership required");
            }
            resolvedCompanyId = cid;
        }
        const uid = ctx.userId ? (0, object_id_util_1.tryParseObjectId)(ctx.userId) : null;
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const reportType = normalizeReportType(reportTypeRaw);
        const locations = sanitizeProjectLocations(locationsRaw);
        const contacts = sanitizeProjectContacts(contactsRaw);
        const doc = {
            name: n,
            companyId: resolvedCompanyId,
            createdAt: now,
            updatedAt: now,
            workflowStatus: "new",
            reportType,
            reportData: {},
            locations,
            contacts,
            inspectorFiles: [],
            ...(uid ? { userId: uid } : {}),
        };
        const { insertedId } = await db.collection(collections_2.MV_PROJECTS_COLLECTION).insertOne(doc);
        const subfolderNames = DEFAULT_PROJECT_SUBFOLDERS.filter((name) => name !== DEFAULT_PHOTOS_SUBFOLDER_NAME);
        await this.upsertSubProjects(db, insertedId, [...subfolderNames]);
        await this.ensureInspectionPhotosItemInItems(db, insertedId);
        return {
            _id: insertedId.toString(),
            name: n,
            companyId: resolvedCompanyId.toString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            workflowStatus: "new",
            reportType,
            reportData: {},
            locations,
            contacts,
            sheetCount: 0,
            subProjectCount: DEFAULT_PROJECT_SUBFOLDERS.length,
            createdByUserId: uid?.toString() ?? null,
            createdByName: null,
            inspectorFiles: [],
        };
    }
    async updateProject(id, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        await this.loadProjectForAccess(db, _id, ctx);
        const now = new Date();
        const b = body ?? {};
        const $set = { updatedAt: now };
        if (b.workflowStatus !== undefined && b.workflowStatus !== null) {
            $set.workflowStatus = normalizeWorkflowStatus(b.workflowStatus);
        }
        if (b.name !== undefined) {
            const nextName = sanitizeOptionalText(b.name, 220);
            if (!nextName)
                throw new common_1.BadRequestException("Project name is required");
            $set.name = nextName;
        }
        if (b.reportType !== undefined && b.reportType !== null) {
            $set.reportType = normalizeReportType(b.reportType);
        }
        if (b.reportData !== undefined) {
            $set.reportData = sanitizeReportData(b.reportData);
        }
        if (b.locations !== undefined) {
            $set.locations = sanitizeProjectLocations(b.locations);
        }
        if (b.contacts !== undefined) {
            $set.contacts = sanitizeProjectContacts(b.contacts);
        }
        if (b.valuationAccountingWorkspace !== undefined) {
            if (b.valuationAccountingWorkspace === null) {
                $set.valuationAccountingWorkspace = null;
            }
            else {
                $set.valuationAccountingWorkspace = sanitizeValuationAccountingWorkspaceForPersist(b.valuationAccountingWorkspace);
            }
        }
        if (b.valuationReadyExcelWorkspace !== undefined) {
            if (b.valuationReadyExcelWorkspace === null) {
                $set.valuationReadyExcelWorkspace = null;
            }
            else {
                $set.valuationReadyExcelWorkspace = sanitizeValuationReadyExcelWorkspaceForPersist(b.valuationReadyExcelWorkspace);
            }
        }
        if (Object.keys($set).length === 1) {
            throw new common_1.BadRequestException("No project fields to update");
        }
        const updated = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOneAndUpdate({ _id }, { $set }, { returnDocument: "after" });
        if (!updated)
            throw new common_1.NotFoundException("Project not found");
        return {
            ok: true,
            project: {
                _id: updated._id.toString(),
                name: updated.name,
                companyId: updated.companyId instanceof mongodb_1.ObjectId
                    ? updated.companyId.toString()
                    : updated.companyId != null && String(updated.companyId).trim() !== ""
                        ? String(updated.companyId).trim()
                        : null,
                createdAt: mvProjectDateToIso(updated.createdAt),
                updatedAt: mvProjectDateToIso(updated.updatedAt),
                workflowStatus: projectWorkflowStatus(updated),
                reportType: projectReportType(updated),
                reportData: sanitizeReportData(updated.reportData),
                locations: sanitizeProjectLocations(updated.locations, false),
                contacts: sanitizeProjectContacts(updated.contacts, false),
                createdByUserId: (0, object_id_util_1.tryCoerceToObjectId)(updated.userId)?.toString() ??
                    (typeof updated.userId === "string" ? updated.userId : null),
                createdByName: null,
                inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(updated.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
                valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(updated.valuationAccountingWorkspace),
                valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(updated.valuationReadyExcelWorkspace),
            },
            updatedAt: now.toISOString(),
        };
    }
    async getProject(id, ctx, opts) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const creatorOid = (0, object_id_util_1.tryCoerceToObjectId)(project.userId);
        const creator = creatorOid
            ? await (0, collections_1.getAuthCollections)(db).users.findOne({ _id: creatorOid }, { projection: { _id: 1, username: 1 } })
            : null;
        const subProjects = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find({ projectId: _id })
            .sort({ createdAt: -1 })
            .toArray();
        const itemRows = await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .find({ projectId: _id })
            .sort({ createdAt: -1 })
            .toArray();
        const sheetCount = await db
            .collection(collections_2.MV_SHEETS_COLLECTION)
            .countDocuments({ projectId: _id });
        const allSubs = [
            ...subProjects.map((s) => s),
            ...itemRows,
        ];
        const picAssetMode = opts?.picAssetMode === "summary" ? "summary" : "full";
        const picRows = picAssetMode === "summary"
            ? (await db
                .collection(collections_3.ASSETS_COLLECTION)
                .aggregate([
                { $match: { projectId: _id, ...MV_PHOTO_FOLDER_FILTER } },
                {
                    $addFields: {
                        imageCount: { $size: { $ifNull: ["$images", []] } },
                        voiceNoteCount: { $size: { $ifNull: ["$voiceNotes", []] } },
                    },
                },
                { $project: { images: 0, voiceNotes: 0 } },
            ])
                .toArray())
            : (await db
                .collection(collections_3.ASSETS_COLLECTION)
                .find({ projectId: _id, ...MV_PHOTO_FOLDER_FILTER })
                .toArray());
        const serPic = (pi) => picAssetMode === "summary" ? serializePicAssetSummary(pi) : serializePicAsset(pi);
        const mvKeySet = new Set();
        for (const s of allSubs) {
            const k = picMatchKeyForMvSub(s);
            if (k)
                mvKeySet.add(k);
        }
        const picByKey = new Map();
        for (const p of picRows) {
            picByKey.set(picMatchKeyForPicDoc(p), p);
        }
        const subsForApi = allSubs.filter((s) => s._id != null && s.projectId != null);
        const mvWithPic = subsForApi.map((s) => {
            const k = picMatchKeyForMvSub(s);
            const pi = k ? picByKey.get(k) : undefined;
            const hasPicIds = pi != null &&
                pi._id != null &&
                pi.projectId != null;
            return {
                ...serializeMvSubProject(s),
                picAsset: hasPicIds ? serPic(pi) : null,
            };
        });
        const standalonePics = picRows.filter((p) => !mvKeySet.has(picMatchKeyForPicDoc(p)));
        const picOnlyRows = standalonePics
            .filter((p) => p._id != null && p.projectId != null)
            .map((p) => ({
            _id: p._id.toString(),
            projectId: p.projectId.toString(),
            parent: p.parent != null ? p.parent.toString() : "",
            name: p.name ?? "",
            createdAt: mvProjectDateToIso(p.createdAt ?? p.importedAt ?? p.updatedAt),
            updatedAt: mvProjectDateToIso(p.updatedAt),
            picAsset: serPic(p),
        }));
        let merged = [...mvWithPic, ...picOnlyRows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        if (ctx.userRole === "inspector") {
            const forInspector = filterSubProjectsForInspector(allSubs, DEFAULT_PHOTOS_SUBFOLDER_NAME);
            const fromTree = forInspector.map((m) => {
                const p = getParentIdFromDoc(m);
                return {
                    _id: m._id.toString(),
                    name: m.name,
                    parent: p != null ? p.toString() : null,
                };
            });
            const fromPics = standalonePics
                .filter((p) => p.parent != null)
                .map((p) => ({
                _id: p._id.toString(),
                name: p.name ?? "",
                parent: p.parent.toString(),
            }));
            const allowed = new Set(filterFolderEntriesForInspector([...fromTree, ...fromPics], DEFAULT_PHOTOS_SUBFOLDER_NAME).map((e) => e._id));
            merged = merged.filter((row) => allowed.has(row._id));
        }
        return {
            project: {
                _id: project._id.toString(),
                name: project.name,
                companyId: project.companyId instanceof mongodb_1.ObjectId
                    ? project.companyId.toString()
                    : project.companyId != null && String(project.companyId).trim() !== ""
                        ? String(project.companyId).trim()
                        : null,
                createdAt: mvProjectDateToIso(project.createdAt),
                updatedAt: mvProjectDateToIso(project.updatedAt),
                workflowStatus: projectWorkflowStatus(project),
                reportType: projectReportType(project),
                reportData: sanitizeReportData(project.reportData),
                locations: sanitizeProjectLocations(project.locations, false),
                contacts: sanitizeProjectContacts(project.contacts, false),
                sheetCount,
                subProjectCount: merged.length,
                createdByUserId: creatorOid?.toString() ??
                    (typeof project.userId === "string" ? project.userId : null),
                createdByName: creator?.username ?? null,
                inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(project.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
                valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(project.valuationAccountingWorkspace),
                valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(project.valuationReadyExcelWorkspace),
            },
            subProjects: merged,
        };
    }
    inspectorDownloadApiPath(projectId, entryId) {
        return `/api/mv/projects/${projectId}/inspectorFiles/${encodeURIComponent(entryId)}/download`;
    }
    async findInspectorGridFsIdByEntryId(db, projectId, inspectorEntryId) {
        const doc = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .findOne({
            "metadata.projectId": projectId,
            "metadata.scope": "mv-inspector",
            "metadata.inspectorEntryId": inspectorEntryId,
        });
        return doc?._id ?? null;
    }
    async deleteInspectorBlobFromStores(db, entry) {
        if (entry.spacesKey) {
            try {
                await this.inspectorSpaces.deleteObject(entry.spacesKey);
            }
            catch (err) {
                this.logger.warn(`deleteInspectorBlob Spaces: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        if (entry.gridFsFileId != null) {
            const gid = (0, object_id_util_1.tryParseObjectId)(String(entry.gridFsFileId));
            if (gid) {
                try {
                    await this.getFilesBucket(db).delete(gid);
                }
                catch (err) {
                    this.logger.warn(`deleteInspectorBlob GridFS: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            return;
        }
    }
    async listInspectorFiles(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const files = (0, inspector_files_util_1.normalizeInspectorFilesArray)(project.inspectorFiles);
        return {
            files: files.map(inspector_files_util_1.serializeInspectorFileForClient),
        };
    }
    async uploadInspectorFile(projectId, file, ctx) {
        if (!file?.buffer?.length) {
            throw new common_1.BadRequestException("ملف فارغ أو مفقود.");
        }
        if (file.buffer.length > inspector_files_constants_1.MV_INSPECTOR_FILE_MAX_BYTES) {
            throw new common_1.BadRequestException(`حجم الملف يتجاوز الحد المسموح (${Math.round(inspector_files_constants_1.MV_INSPECTOR_FILE_MAX_BYTES / (1024 * 1024))} ميجابايت).`);
        }
        const decodedName = sanitizeUploadedFileName((0, sheet_rows_util_1.decodeUploadFilename)(file.originalname || "upload"));
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        await this.loadProjectForAccess(db, _id, ctx);
        const logicalType = (0, inspector_files_util_1.inspectorLogicalTypeFromMime)(file.mimetype || "", decodedName);
        const id = (0, node_crypto_1.randomUUID)();
        const now = new Date();
        const fileName = decodedName.slice(0, 500);
        if (!this.inspectorSpaces.isReady()) {
            throw new common_1.BadRequestException("DigitalOcean Spaces is not configured for inspector file uploads.");
        }
        let uploaded;
        try {
            uploaded = await this.inspectorSpaces.uploadInspectorFile({
                projectId,
                entryId: id,
                fileName,
                buffer: file.buffer,
                contentType: file.mimetype || "application/octet-stream",
            });
        }
        catch (err) {
            this.logger.error(`uploadInspectorFile Spaces: ${err instanceof Error ? err.message : String(err)}`);
            throw new common_1.BadRequestException("فشل رفع الملف إلى DigitalOcean Spaces.");
        }
        const row = {
            id,
            name: fileName,
            type: logicalType,
            url: uploaded.url || this.inspectorDownloadApiPath(projectId, id),
            uploadedBy: ctx.userId,
            createdAt: now,
            storage: "digitalocean",
            spacesKey: uploaded.key,
            mimeType: file.mimetype || "application/octet-stream",
            sizeBytes: file.buffer.length,
        };
        await db.collection(collections_2.MV_PROJECTS_COLLECTION).updateOne({ _id }, { $push: { inspectorFiles: row }, $set: { updatedAt: now } });
        const updated = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOne({ _id });
        const list = (0, inspector_files_util_1.normalizeInspectorFilesArray)(updated?.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient);
        return {
            ok: true,
            file: (0, inspector_files_util_1.serializeInspectorFileForClient)(row),
            inspectorFiles: list,
        };
    }
    async deleteInspectorFile(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const files = (0, inspector_files_util_1.normalizeInspectorFilesArray)(project.inspectorFiles);
        const target = files.find((f) => f.id === fileId.trim());
        if (!target) {
            throw new common_1.NotFoundException("الملف غير موجود.");
        }
        await this.deleteInspectorBlobFromStores(db, target);
        const now = new Date();
        await db.collection(collections_2.MV_PROJECTS_COLLECTION).updateOne({ _id }, { $pull: { inspectorFiles: { id: target.id } }, $set: { updatedAt: now } });
        const refreshed = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOne({ _id });
        return {
            ok: true,
            removedId: target.id,
            inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(refreshed?.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
        };
    }
    async renameInspectorFile(projectId, fileId, ctx, rawName) {
        const next = sanitizeUploadedFileName(rawName).slice(0, 500);
        if (!next) {
            throw new common_1.BadRequestException("اسم الملف مطلوب.");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        await this.loadProjectForAccess(db, _id, ctx);
        const now = new Date();
        const res = await db.collection(collections_2.MV_PROJECTS_COLLECTION).updateOne({ _id, "inspectorFiles.id": fileId.trim() }, { $set: { "inspectorFiles.$.name": next, updatedAt: now } });
        if (res.matchedCount === 0) {
            throw new common_1.NotFoundException("الملف غير موجود.");
        }
        const updated = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOne({ _id });
        return {
            ok: true,
            inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(updated?.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
        };
    }
    async getInspectorFileDownload(projectId, fileId, ctx, opts) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const project = await this.loadProjectForAccess(db, pid, ctx);
        const files = (0, inspector_files_util_1.normalizeInspectorFilesArray)(project.inspectorFiles);
        const entry = files.find((f) => f.id === fileId.trim());
        if (!entry) {
            throw new common_1.NotFoundException("الملف غير موجود.");
        }
        if (entry.spacesKey) {
            let object;
            try {
                object = await this.inspectorSpaces.getObjectStream(entry.spacesKey, {
                    rangeHeader: opts?.rangeHeader,
                });
            }
            catch {
                throw new common_1.NotFoundException("الملف غير موجود.");
            }
            return {
                kind: "digitalocean",
                stream: object.stream,
                fileName: entry.name,
                mimeType: entry.mimeType || object.contentType || "application/octet-stream",
                attachment: opts?.attachment === true,
                totalBytes: object.totalBytes,
                httpStatus: object.httpStatus,
                contentRange: object.contentRange,
                contentLength: object.contentLength,
            };
        }
        if (entry.gridFsFileId != null) {
            let gid = (0, object_id_util_1.tryParseObjectId)(String(entry.gridFsFileId ?? ""));
            if (!gid) {
                gid = await this.findInspectorGridFsIdByEntryId(db, pid, entry.id);
            }
            if (!gid) {
                throw new common_1.NotFoundException("الملف غير موجود.");
            }
            let metaDoc;
            try {
                metaDoc = await this.getStoredFileDoc(db, pid, gid);
            }
            catch {
                const alt = await this.findInspectorGridFsIdByEntryId(db, pid, entry.id);
                if (!alt) {
                    throw new common_1.NotFoundException("الملف غير موجود.");
                }
                metaDoc = await this.getStoredFileDoc(db, pid, alt);
                gid = alt;
            }
            const mime = entry.mimeType || "application/octet-stream";
            const totalBytes = Number(metaDoc.length) || 0;
            const bucket = this.getFilesBucket(db);
            const range = (0, inspector_download_range_util_1.parseInspectorBytesRange)(opts?.rangeHeader, totalBytes);
            let stream;
            let httpStatus = 200;
            let contentRange;
            let contentLength = totalBytes;
            if (range && totalBytes > 0) {
                stream = bucket.openDownloadStream(gid, { start: range.start, end: range.end });
                httpStatus = 206;
                contentRange = `bytes ${range.start}-${range.end}/${totalBytes}`;
                contentLength = range.end - range.start + 1;
            }
            else {
                stream = bucket.openDownloadStream(gid);
            }
            return {
                kind: "gridfs",
                stream,
                fileName: entry.name,
                mimeType: mime,
                attachment: opts?.attachment === true,
                totalBytes,
                httpStatus,
                contentRange,
                contentLength,
            };
        }
        if (!entry.url || !/^https?:\/\//i.test(entry.url)) {
            throw new common_1.NotFoundException("الملف غير موجود.");
        }
        if (opts?.attachment === true) {
            return {
                kind: "proxyFetch",
                sourceUrl: entry.url,
                fileName: entry.name,
                mimeType: entry.mimeType || "application/octet-stream",
            };
        }
        return {
            kind: "redirect",
            url: entry.url,
            fileName: entry.name,
            attachment: false,
        };
    }
    async deleteProject(id, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const projectSnapshot = await this.loadProjectForAccess(db, _id, ctx);
        const inspectorEntries = (0, inspector_files_util_1.normalizeInspectorFilesArray)(projectSnapshot.inspectorFiles);
        for (const entry of inspectorEntries) {
            await this.deleteInspectorBlobFromStores(db, entry);
        }
        await db.collection(collections_2.MV_SHEETS_COLLECTION).deleteMany({ projectId: _id });
        await this.deleteStoredFiles(db, {
            "metadata.projectId": _id,
            "metadata.scope": { $ne: "mv-inspector" },
        });
        await db
            .collection(collections_3.ASSETS_COLLECTION)
            .deleteMany({ projectId: _id, ...MV_PHOTO_FOLDER_FILTER });
        await db.collection(collections_2.MV_ITEMS_COLLECTION).deleteMany({ projectId: _id });
        await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: _id });
        const del = await db.collection(collections_2.MV_PROJECTS_COLLECTION).deleteOne({ _id });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException("Project not found");
        return { ok: true };
    }
    async createSubProject(projectId, name, ctx, parentSubProjectId) {
        const n = normalizeSubProjectName(name);
        if (!n)
            throw new common_1.BadRequestException("Sub-project name is required");
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const parentId = parentSubProjectId && parentSubProjectId.trim().length > 0
            ? toId(parentSubProjectId)
            : undefined;
        if (ctx.userRole === "inspector") {
            if (!parentId) {
                throw new common_1.ForbiddenException("لا يُسمح بإنشاء مجلد في جذر المشروع لدور المفتش. استخدم المجلد المخصص لمعاينة الصور.");
            }
            await this.assertInspectorAccessToFolderId(db, pid, parentId, ctx);
        }
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        let isPicUnderPhotos = false;
        if (parentId) {
            const inMv = await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
                _id: parentId,
                projectId: pid,
            });
            if (!inMv) {
                const inItem = await db
                    .collection(collections_2.MV_ITEMS_COLLECTION)
                    .findOne({ _id: parentId, projectId: pid });
                if (!inItem) {
                    const inPic = await db
                        .collection(collections_3.ASSETS_COLLECTION)
                        .findOne({ _id: parentId, projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
                    if (!inPic)
                        throw new common_1.NotFoundException("Parent sub-project not found");
                }
            }
            isPicUnderPhotos = await this.isInPhotosHoldingSubtree(db, pid, photosRoot._id, parentId);
        }
        if (isPicUnderPhotos && parentId) {
            const createdBy = (0, object_id_util_1.tryParseObjectId)(ctx.userId ?? undefined) ?? null;
            const { created, existing } = await this.upsertPicAssetFoldersOnly(db, pid, parentId, [n], createdBy);
            const target = created[0] ?? existing[0];
            if (!target)
                throw new common_1.BadRequestException("تعذّر إنشاء مجلد أصل الصور.");
            const tCreated = target.createdAt ?? target.importedAt ?? target.updatedAt;
            return {
                _id: target._id.toString(),
                projectId: target.projectId.toString(),
                parent: target.parent.toString(),
                name: target.name ?? "",
                createdAt: tCreated instanceof Date && !Number.isNaN(tCreated.getTime())
                    ? tCreated.toISOString()
                    : target.updatedAt.toISOString(),
                updatedAt: target.updatedAt.toISOString(),
                picAsset: serializePicAsset(target),
            };
        }
        const { created, existing } = await this.upsertSubProjects(db, pid, [n], parentId, undefined);
        const target = created[0] ?? existing[0];
        if (!target)
            throw new common_1.BadRequestException("Sub-project could not be created");
        const fresh = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .findOne({ _id: target._id, projectId: pid });
        if (!fresh)
            throw new common_1.NotFoundException("Sub-project not found");
        const pFolderA = getParentIdFromDoc(fresh);
        const picA = pFolderA != null
            ? await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                projectId: pid,
                parent: pFolderA,
                name: fresh.name,
                ...MV_PHOTO_FOLDER_FILTER,
            })
            : null;
        const idFb = { _id: fresh._id, projectId: pid };
        return {
            ...serializeMvSubProject(fresh, idFb),
            picAsset: picA
                ? serializePicAsset(picA, {
                    _id: picA._id ?? fresh._id,
                    projectId: picA.projectId ?? pid,
                })
                : null,
        };
    }
    async getSubProject(projectId, subId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const sid = toId(subId);
        if (ctx.userRole === "inspector") {
            await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
        }
        const sub = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .findOne({ _id: sid, projectId: pid });
        if (sub) {
            const pFolderG = getParentIdFromDoc(sub);
            const pic = pFolderG != null
                ? await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                    projectId: pid,
                    parent: pFolderG,
                    name: sub.name,
                    ...MV_PHOTO_FOLDER_FILTER,
                })
                : null;
            const idFb = { _id: sid, projectId: pid };
            return {
                ...serializeMvSubProject(sub, idFb),
                picAsset: pic ? serializePicAsset(pic, idFb) : null,
            };
        }
        const itemSub = await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .findOne({ _id: sid, projectId: pid });
        if (itemSub) {
            const pFolderG = getParentIdFromDoc(itemSub);
            const pic = pFolderG != null
                ? await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                    projectId: pid,
                    parent: pFolderG,
                    name: itemSub.name,
                    ...MV_PHOTO_FOLDER_FILTER,
                })
                : null;
            const idFb = { _id: sid, projectId: pid };
            return {
                ...serializeMvSubProject(itemSub, idFb),
                picAsset: pic ? serializePicAsset(pic, idFb) : null,
            };
        }
        const picOnlyRaw = (await db
            .collection(collections_3.ASSETS_COLLECTION)
            .findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }));
        if (!picOnlyRaw)
            throw new common_1.NotFoundException("Sub-project not found");
        const picOnly = {
            ...picOnlyRaw,
            _id: picOnlyRaw._id ?? sid,
            projectId: picOnlyRaw.projectId ?? pid,
        };
        const poCreated = picOnly.createdAt ?? picOnly.importedAt ?? picOnly.updatedAt;
        const parentId = picOnly.parent != null ? String(picOnly.parent) : "";
        return {
            _id: picOnly._id.toString(),
            projectId: picOnly.projectId.toString(),
            parent: parentId,
            name: picOnly.name ?? "",
            createdAt: poCreated instanceof Date && !Number.isNaN(poCreated.getTime())
                ? poCreated.toISOString()
                : mvProjectDateToIso(picOnly.updatedAt),
            updatedAt: mvProjectDateToIso(picOnly.updatedAt),
            picAsset: serializePicAsset(picOnly),
        };
    }
    async patchSubProject(projectId, subId, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const sid = toId(subId);
        if (ctx.userRole === "inspector") {
            await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
        }
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        let folderMeta = null;
        let pic = await pa.findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
        if (!pic) {
            const sub = (await sp.findOne({ _id: sid, projectId: pid })) ??
                (await db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({ _id: sid, projectId: pid }));
            if (!sub)
                throw new common_1.NotFoundException("Sub-project not found");
            folderMeta = sub;
            const pFolder = getParentIdFromDoc(sub);
            if (pFolder == null) {
                throw new common_1.BadRequestException("لا تتوفر بيانات أصل صور لمجلدات جذر المشروع.");
            }
            pic =
                (await pa.findOne({
                    projectId: pid,
                    parent: pFolder,
                    name: sub.name,
                    ...MV_PHOTO_FOLDER_FILTER,
                })) ?? null;
            if (!pic) {
                const now0 = new Date();
                const insr = await pa.insertOne(buildPicAssetDocument(pid, pFolder, sub.name, now0, (0, object_id_util_1.tryParseObjectId)(ctx.userId ?? undefined) ?? null));
                pic = await pa.findOne({ _id: insr.insertedId, ...MV_PHOTO_FOLDER_FILTER });
            }
        }
        if (!pic)
            throw new common_1.NotFoundException("photo folder asset not found");
        const b = body ?? {};
        const $set = {};
        const now = new Date();
        if (b.writtenDescription !== undefined) {
            if (b.writtenDescription !== null && typeof b.writtenDescription !== "string") {
                throw new common_1.BadRequestException("writtenDescription must be a string or null");
            }
            $set.writtenDescription = b.writtenDescription;
        }
        if (b.condition !== undefined) {
            if (b.condition !== null && typeof b.condition !== "string") {
                throw new common_1.BadRequestException("condition must be a string or null");
            }
            $set.condition = b.condition;
        }
        if (b.assetType !== undefined) {
            if (typeof b.assetType !== "string" || !ASSET_TYPE_SET.has(b.assetType)) {
                throw new common_1.BadRequestException("Invalid assetType");
            }
            $set.assetType = b.assetType;
        }
        for (const key of ["brand", "code", "model"]) {
            if (b[key] !== undefined) {
                const v = b[key];
                if (v !== null && typeof v !== "string") {
                    throw new common_1.BadRequestException(`${key} must be a string or null`);
                }
                $set[key] = v;
            }
        }
        if (b.manufactureYear !== undefined) {
            if (b.manufactureYear !== null && (typeof b.manufactureYear !== "number" || !Number.isFinite(b.manufactureYear))) {
                throw new common_1.BadRequestException("manufactureYear must be a finite number or null");
            }
            $set.manufactureYear = b.manufactureYear;
        }
        if (b.kilometersDriven !== undefined) {
            if (b.kilometersDriven !== null &&
                (typeof b.kilometersDriven !== "number" || !Number.isFinite(b.kilometersDriven))) {
                throw new common_1.BadRequestException("kilometersDriven must be a finite number or null");
            }
            $set.kilometersDriven = b.kilometersDriven;
        }
        if (b.isPresent !== undefined) {
            if (typeof b.isPresent !== "boolean") {
                throw new common_1.BadRequestException("isPresent must be a boolean");
            }
            $set.isPresent = b.isPresent;
        }
        if (b.isDone !== undefined) {
            if (typeof b.isDone !== "boolean") {
                throw new common_1.BadRequestException("isDone must be a boolean");
            }
            $set.isDone = b.isDone;
        }
        if (b.images !== undefined) {
            $set.images = normalizePicAssetMediaArrayForPatch(b.images, "images");
        }
        if (b.voiceNotes !== undefined) {
            $set.voiceNotes = normalizePicAssetMediaArrayForPatch(b.voiceNotes, "voiceNotes");
        }
        if (Object.keys($set).length === 0) {
            throw new common_1.BadRequestException("No valid fields to update");
        }
        $set.isAssetFolder = true;
        $set.updatedAt = now;
        const picId = pic._id;
        const nextPic = (await pa.findOneAndUpdate({ _id: picId, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, { $set }, { returnDocument: "after" }));
        if (!nextPic)
            throw new common_1.NotFoundException("photo folder asset not found");
        const subForResponse = folderMeta ??
            (await sp.findOne({ _id: sid, projectId: pid })) ??
            (await db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({ _id: sid, projectId: pid }));
        const patchIdFb = { _id: sid, projectId: pid };
        if (subForResponse) {
            return {
                ...serializeMvSubProject(subForResponse, patchIdFb),
                picAsset: serializePicAsset(nextPic, patchIdFb),
            };
        }
        const nextCreated = nextPic.createdAt ?? nextPic.importedAt;
        const npId = nextPic._id ?? sid;
        const npProj = nextPic.projectId ?? pid;
        const npUpdated = nextPic.updatedAt instanceof Date ? nextPic.updatedAt : new Date(0);
        return {
            _id: npId.toString(),
            projectId: npProj.toString(),
            parent: nextPic.parent != null ? nextPic.parent.toString() : "",
            name: nextPic.name ?? "",
            createdAt: nextCreated instanceof Date && !Number.isNaN(nextCreated.getTime())
                ? nextCreated.toISOString()
                : npUpdated.toISOString(),
            updatedAt: npUpdated.toISOString(),
            picAsset: serializePicAsset(nextPic, patchIdFb),
        };
    }
    async deleteSubProject(projectId, subId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const sid = toId(subId);
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const sub = await sp.findOne({ _id: sid, projectId: pid });
        const item = sub ? null : await it.findOne({ _id: sid, projectId: pid });
        if (sub || item) {
            if (ctx.userRole === "inspector") {
                await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
            }
            const ids = await this.collectDescendantSubProjectIds(db, pid, sid);
            const picTied = await this.collectAllPicForMvDeletion(db, pid, ids);
            await db.collection(collections_2.MV_SHEETS_COLLECTION).deleteMany({ subProjectId: { $in: ids } });
            await this.deleteStoredFiles(db, {
                "metadata.projectId": pid,
                $or: [
                    { "metadata.subProjectId": { $in: ids } },
                    { "metadata.subProjectId": { $in: picTied } },
                    { "metadata.picAssetId": { $in: picTied } },
                ],
            });
            await pa.deleteMany({ _id: { $in: picTied }, ...MV_PHOTO_FOLDER_FILTER });
            const delMv = await sp.deleteMany({ _id: { $in: ids }, projectId: pid });
            const delIt = await it.deleteMany({ _id: { $in: ids }, projectId: pid });
            if (delMv.deletedCount === 0 && delIt.deletedCount === 0) {
                throw new common_1.NotFoundException("Sub-project not found");
            }
            return { ok: true };
        }
        const picNode = (await pa.findOne({
            _id: sid,
            projectId: pid,
            ...MV_PHOTO_FOLDER_FILTER,
        }));
        if (!picNode)
            throw new common_1.NotFoundException("Sub-project not found");
        if (ctx.userRole === "inspector") {
            await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
        }
        const picIds = await this.collectDescendantPicAssetIds(db, pid, sid);
        await this.deleteStoredFiles(db, {
            "metadata.projectId": pid,
            $or: [
                { "metadata.subProjectId": { $in: picIds } },
                { "metadata.picAssetId": { $in: picIds } },
            ],
        });
        const delP = await pa.deleteMany({
            _id: { $in: picIds },
            projectId: pid,
            ...MV_PHOTO_FOLDER_FILTER,
        });
        if (delP.deletedCount === 0)
            throw new common_1.NotFoundException("Sub-project not found");
        return { ok: true };
    }
    async deleteAllSubProjects(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const subs = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find({ projectId: pid })
            .project({ _id: 1 })
            .toArray();
        if (subs.length > 0) {
            const ids = subs.map((s) => s._id);
            await db.collection(collections_2.MV_SHEETS_COLLECTION).deleteMany({ subProjectId: { $in: ids } });
        }
        await this.deleteStoredFiles(db, { "metadata.projectId": pid });
        await db
            .collection(collections_3.ASSETS_COLLECTION)
            .deleteMany({ projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
        await db.collection(collections_2.MV_ITEMS_COLLECTION).deleteMany({ projectId: pid });
        const del = await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: pid });
        return { ok: true, deletedCount: del.deletedCount };
    }
    async generateInspectionFoldersFromSheet(projectId, sheetId, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const sid = toId(sheetId);
        const sheet = await db.collection(collections_2.MV_SHEETS_COLLECTION).findOne({
            _id: sid,
            projectId: pid,
        });
        if (!sheet)
            throw new common_1.NotFoundException("Sheet not found");
        const headers = sheet.headers ?? [];
        if (headers.length === 0) {
            throw new common_1.BadRequestException("Sheet has no columns");
        }
        let columnIndex = null;
        if (typeof body?.columnName === "string" && body.columnName.trim().length > 0) {
            columnIndex = headers.findIndex((header) => header === body.columnName);
        }
        if (columnIndex === null &&
            body?.columnIndex !== undefined &&
            body.columnIndex !== null &&
            body.columnIndex !== "") {
            const parsed = Number(body.columnIndex);
            if (Number.isFinite(parsed)) {
                const rounded = Math.round(parsed);
                if (rounded >= 0 && rounded < headers.length) {
                    columnIndex = rounded;
                }
            }
        }
        if (columnIndex === null || columnIndex < 0 || columnIndex >= headers.length) {
            throw new common_1.BadRequestException("A valid column is required");
        }
        const rows = sheet.rowValues && sheet.rowValues.length > 0
            ? (0, sheet_rows_util_1.rowValuesToRecords)(headers, sheet.rowValues)
            : (sheet.rows ?? []);
        const columnName = headers[columnIndex] ?? `Column ${columnIndex + 1}`;
        const folderNames = Array.from(new Set(rows
            .map((row) => sanitizeGeneratedFolderName(row[columnName]))
            .filter((value) => Boolean(value))));
        if (folderNames.length === 0) {
            throw new common_1.BadRequestException("This column has no usable values to create folders");
        }
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        const createdBy = (0, object_id_util_1.tryParseObjectId)(ctx.userId ?? undefined) ?? null;
        const { created, existing } = await this.upsertPicAssetFoldersOnly(db, pid, photosRoot._id, folderNames, createdBy);
        const queryNames = Array.from(new Set(folderNames.map((n) => normalizeSubProjectName(n)).filter(Boolean)));
        const refreshed = await db
            .collection(collections_3.ASSETS_COLLECTION)
            .find({
            projectId: pid,
            parent: photosRoot._id,
            name: { $in: queryNames },
            ...MV_PHOTO_FOLDER_FILTER,
        })
            .toArray();
        return {
            photosFolderId: photosRoot._id.toString(),
            parentFolderName: photosRoot.name,
            columnName,
            totalValues: folderNames.length,
            createdCount: created.length,
            existingCount: existing.length,
            folders: refreshed
                .filter((p) => p.parent != null)
                .map((p) => ({
                _id: p._id.toString(),
                projectId: p.projectId.toString(),
                parent: p.parent.toString(),
                name: p.name ?? "",
                createdAt: (p.createdAt ?? p.importedAt ?? p.updatedAt).toISOString(),
                updatedAt: p.updatedAt.toISOString(),
                picAsset: serializePicAsset(p),
            }))
                .sort((a, b) => String(a.name).localeCompare(String(b.name), "ar")),
        };
    }
    async generateInspectionFoldersFromAssetImport(projectId, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const columnKey = (0, asset_import_utils_1.sanitizeTextInput)(body.columnKey ?? "");
        if (!columnKey || columnKey.includes(".") || columnKey.includes("$")) {
            throw new common_1.BadRequestException("مفتاح العمود غير صالح.");
        }
        const importIdRaw = (0, asset_import_utils_1.sanitizeTextInput)(body.importId ?? "");
        const sheetName = (0, asset_import_utils_1.sanitizeTextInput)(body.sheetName ?? "");
        if (!mongodb_1.ObjectId.isValid(importIdRaw)) {
            throw new common_1.BadRequestException("معرف الاستيراد غير صالح.");
        }
        if (!sheetName) {
            throw new common_1.BadRequestException("اسم الورقة مطلوب.");
        }
        await (0, collections_3.ensureAssetsCollectionsInitialized)(db);
        const importOid = new mongodb_1.ObjectId(importIdRaw);
        const rowFilter = {
            projectId: pid,
            importId: importOid,
            sheetName,
        };
        const coll = db.collection(collections_3.ASSETS_COLLECTION);
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        const createdBy = (0, object_id_util_1.tryParseObjectId)(ctx.userId ?? undefined) ?? null;
        const now = new Date();
        const folderNames = new Set();
        const bulkOps = [];
        const BATCH = 500;
        let modifiedRows = 0;
        let unchangedRows = 0;
        const flushBulk = async () => {
            if (bulkOps.length === 0)
                return;
            const res = await coll.bulkWrite(bulkOps.splice(0, bulkOps.length), { ordered: false });
            modifiedRows += res.modifiedCount;
        };
        for await (const doc of coll.find(rowFilter)) {
            const rawVal = doc.rawData?.[columnKey];
            const normVal = doc.normalizedData?.[columnKey];
            const cell = rawVal !== undefined && rawVal !== null && rawVal !== "" ? rawVal : normVal;
            const folder = sanitizeGeneratedFolderName(cell);
            if (!folder)
                continue;
            folderNames.add(folder);
            const normDocName = normalizeSubProjectName(doc.name ?? "");
            const normFolder = normalizeSubProjectName(folder);
            if (doc.isAssetFolder === true && normDocName === normFolder && doc.parent?.equals(photosRoot._id)) {
                if (doc.isDone === true) {
                    unchangedRows += 1;
                    continue;
                }
                bulkOps.push({
                    updateOne: {
                        filter: { _id: doc._id, projectId: pid },
                        update: { $set: { isDone: true, updatedAt: now } },
                    },
                });
                if (bulkOps.length >= BATCH)
                    await flushBulk();
                continue;
            }
            bulkOps.push({
                updateOne: {
                    filter: { _id: doc._id, projectId: pid },
                    update: {
                        $set: {
                            name: folder,
                            isAssetFolder: true,
                            parent: photosRoot._id,
                            updatedAt: now,
                            isPresent: true,
                            isDone: true,
                            createdBy: doc.createdBy ?? createdBy,
                            createdAt: doc.createdAt ?? now,
                            images: doc.images ?? [],
                            voiceNotes: doc.voiceNotes ?? [],
                        },
                        $unset: { assetName: "", "normalizedData.assetName": "" },
                    },
                },
            });
            if (bulkOps.length >= BATCH)
                await flushBulk();
        }
        await flushBulk();
        if (folderNames.size === 0) {
            throw new common_1.BadRequestException("لا توجد قيم صالحة في هذا العمود لإنشاء مجلدات. تأكد أن الصفوف تحتوي بيانات في العمود المختار.");
        }
        const queryNames = Array.from(new Set([...folderNames].map((n) => normalizeSubProjectName(n)).filter(Boolean)));
        if (queryNames.length > 0) {
            await coll.deleteMany({
                projectId: pid,
                parent: photosRoot._id,
                ...MV_PHOTO_FOLDER_FILTER,
                importId: { $exists: false },
                name: { $in: queryNames },
                $expr: { $eq: [{ $size: { $objectToArray: { $ifNull: ["$rawData", {}] } } }, 0] },
            });
        }
        const refreshed = await coll
            .find({
            projectId: pid,
            importId: importOid,
            sheetName,
            parent: photosRoot._id,
            name: { $in: queryNames },
            ...MV_PHOTO_FOLDER_FILTER,
        })
            .toArray();
        return {
            photosFolderId: photosRoot._id.toString(),
            parentFolderName: photosRoot.name,
            columnKey,
            totalValues: folderNames.size,
            createdCount: modifiedRows,
            existingCount: unchangedRows,
            folders: refreshed
                .filter((p) => p.parent != null)
                .map((p) => ({
                _id: p._id.toString(),
                projectId: p.projectId.toString(),
                parent: p.parent.toString(),
                name: p.name ?? "",
                createdAt: (p.createdAt ?? p.importedAt ?? p.updatedAt).toISOString(),
                updatedAt: p.updatedAt.toISOString(),
                picAsset: serializePicAsset(p),
            }))
                .sort((a, b) => String(a.name).localeCompare(String(b.name), "ar")),
        };
    }
    async listProjectFiles(projectId, ctx, subProjectId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const sid = subProjectId && subProjectId.trim().length > 0
            ? toId(subProjectId)
            : undefined;
        await this.assertSubProjectContext(db, pid, sid, ctx);
        const filter = {
            "metadata.projectId": pid,
            "metadata.scope": { $ne: "asset-images" },
        };
        if (sid) {
            filter.$or = [
                { "metadata.subProjectId": sid },
                { "metadata.picAssetId": sid },
            ];
        }
        else {
            filter.$and = [
                { "metadata.subProjectId": { $exists: false } },
                { "metadata.picAssetId": { $exists: false } },
            ];
        }
        const files = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .find(filter)
            .sort({ uploadDate: -1 })
            .toArray();
        return files.map((file) => mapStoredFileDoc(file));
    }
    async listValuationExcelFiles(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const files = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .find({
            "metadata.projectId": pid,
            "metadata.scope": MV_VALUATION_EXCEL_SCOPE,
        })
            .sort({ uploadDate: -1 })
            .toArray();
        return files.map((file) => mapStoredFileDoc(file));
    }
    async uploadValuationExcelFiles(projectId, files, ctx) {
        const safeFiles = Array.isArray(files) ? files : [];
        if (safeFiles.length === 0) {
            throw new common_1.BadRequestException("At least one file is required");
        }
        return this.uploadProjectFiles(projectId, safeFiles, ctx, undefined, {
            scope: MV_VALUATION_EXCEL_SCOPE,
            preferDigitalOcean: true,
        });
    }
    async getValuationExcelFileDownload(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        const file = await this.getStoredFileDoc(db, pid, fid);
        if (file.metadata?.scope !== MV_VALUATION_EXCEL_SCOPE) {
            throw new common_1.NotFoundException("File not found");
        }
        if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
            try {
                const object = await this.inspectorSpaces.getObjectStream(file.metadata.spacesKey.trim());
                return {
                    file: mapStoredFileDoc(file),
                    stream: object.stream,
                };
            }
            catch {
                throw new common_1.NotFoundException("File not found");
            }
        }
        return {
            file: mapStoredFileDoc(file),
            stream: this.getFilesBucket(db).openDownloadStream(fid),
        };
    }
    async deleteValuationExcelFile(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        const file = await this.getStoredFileDoc(db, pid, fid);
        if (file.metadata?.scope !== MV_VALUATION_EXCEL_SCOPE) {
            throw new common_1.NotFoundException("File not found");
        }
        if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
            try {
                await this.inspectorSpaces.deleteObject(file.metadata.spacesKey.trim());
            }
            catch (err) {
                this.logger.warn(`deleteValuationExcelFile Spaces: ${err instanceof Error ? err.message : String(err)}`);
            }
            await db.collection(collections_2.MV_FILES_FILES_COLLECTION).deleteOne({ _id: fid, "metadata.projectId": pid });
        }
        else {
            await this.getFilesBucket(db).delete(fid);
        }
        return { ok: true };
    }
    async listProjectAssetImageFiles(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        await backfillPicAssetGridFsImagesAsAssetFiles(db, pid);
        const files = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .find({
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
        })
            .toArray();
        files.sort(compareAssetImageGridDocs);
        return files.map((file) => mapStoredFileDoc(file));
    }
    async reorderProjectAssetImageFiles(projectId, ctx, folderPathInput, orderedFileIds, picAssetFolderIdInput) {
        if (!Array.isArray(orderedFileIds) || orderedFileIds.length === 0) {
            throw new common_1.BadRequestException("orderedFileIds مطلوب.");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const picAssetFolderId = typeof picAssetFolderIdInput === "string" && picAssetFolderIdInput.trim()
            ? toId(picAssetFolderIdInput.trim())
            : null;
        if (picAssetFolderId) {
            const picFolder = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                _id: picAssetFolderId,
                projectId: pid,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (!picFolder)
                throw new common_1.BadRequestException("Target asset folder not found.");
        }
        const normalizedFolder = normalizeMvAssetFolderPath(folderPathInput ?? "");
        const folderClause = assetImageFolderMongoFilter(normalizedFolder);
        const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const baseFilter = {
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
            ...(picAssetFolderId
                ? { "metadata.picAssetId": picAssetFolderId }
                : { "metadata.picAssetId": { $exists: false } }),
            ...folderClause,
        };
        const existing = await col.find(baseFilter).toArray();
        if (existing.length !== orderedFileIds.length) {
            throw new common_1.BadRequestException("عدد الصور في الطلب لا يطابق هذا المجلد أو تكرار أو نقص.");
        }
        const idSet = new Set(existing.map((d) => d._id.toString()));
        const orderedObjectIds = [];
        const requestedIds = new Set();
        for (const id of orderedFileIds) {
            const oid = (0, object_id_util_1.tryParseObjectId)(id);
            const normalizedId = oid?.toString();
            if (!oid || !normalizedId || !idSet.has(normalizedId) || requestedIds.has(normalizedId)) {
                throw new common_1.BadRequestException("معرف ملف غير صالح أو لا ينتمي لهذا المجلد.");
            }
            requestedIds.add(normalizedId);
            orderedObjectIds.push(oid);
        }
        const now = new Date();
        await Promise.all(orderedObjectIds.map((fid, i) => col.updateOne({ _id: fid, ...baseFilter }, {
            $set: {
                "metadata.displayOrder": i,
                "metadata.folderPath": normalizedFolder,
                "metadata.updatedAt": now,
            },
        })));
        return this.listProjectAssetImageFiles(projectId, ctx);
    }
    async placeProjectAssetImageFile(projectId, ctx, fileIdInput, targetFolderPathRaw, insertBeforeFileIdRaw, targetPicAssetFolderIdRaw) {
        const fileIdTrim = typeof fileIdInput === "string" ? fileIdInput.trim() : "";
        const oidMoving = (0, object_id_util_1.tryParseObjectId)(fileIdTrim);
        if (!oidMoving)
            throw new common_1.BadRequestException("معرف الملف مطلوب وصالح.");
        const insertBeforeTrim = typeof insertBeforeFileIdRaw === "string" ? insertBeforeFileIdRaw.trim() : "";
        const targetFolderNormalized = normalizeMvAssetFolderPath(typeof targetFolderPathRaw === "string" ? targetFolderPathRaw : "");
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const moveDoc = await col.findOne({
            _id: oidMoving,
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
        });
        if (!moveDoc?.metadata) {
            throw new common_1.NotFoundException("ملف صورة الأصول غير موجود.");
        }
        const oldRelativePath = String(moveDoc.metadata.relativePath || moveDoc.metadata.originalFileName || "file").replace(/\\/g, "/");
        const oldBasename = sanitizeUploadedFileName(oldRelativePath.split("/").pop() || "file");
        const sourceFolderNormalized = normalizeMvAssetFolderPath(String(moveDoc.metadata.folderPath ??
            folderPathFromRelativePath(moveDoc.metadata.relativePath || moveDoc.metadata.originalFileName || "")));
        const sourcePicOid = moveDoc.metadata.picAssetId ?? null;
        const crossFolderMove = sourceFolderNormalized !== targetFolderNormalized;
        const targetPicTrim = typeof targetPicAssetFolderIdRaw === "string" ? targetPicAssetFolderIdRaw.trim() : "";
        const targetPicOid = targetPicTrim ? (0, object_id_util_1.tryParseObjectId)(targetPicTrim) : null;
        if (targetPicTrim && !targetPicOid) {
            throw new common_1.BadRequestException("معرف مجلد الأصل المستهدف غير صالح.");
        }
        const picAssetScopeFilter = (picOid) => picOid
            ? { "metadata.picAssetId": picOid }
            : { "metadata.picAssetId": { $exists: false } };
        if (targetPicOid && !crossFolderMove) {
            const picFolder = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                _id: targetPicOid,
                projectId: pid,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (!picFolder) {
                throw new common_1.BadRequestException("Target asset folder not found.");
            }
            const photosRoot = await this.ensurePhotosRootFolder(db, pid);
            if (!picFolder.parent?.equals(photosRoot._id)) {
                throw new common_1.BadRequestException("Target asset folder must be under the photos root.");
            }
        }
        let insertBeforeOid = null;
        if (insertBeforeTrim) {
            insertBeforeOid = (0, object_id_util_1.tryParseObjectId)(insertBeforeTrim);
            if (!insertBeforeOid) {
                throw new common_1.BadRequestException("معرف موضع الإدراج غير صالح.");
            }
            if (insertBeforeOid.equals(oidMoving)) {
                return this.listProjectAssetImageFiles(projectId, ctx);
            }
            const anchor = await col.findOne({
                _id: insertBeforeOid,
                "metadata.projectId": pid,
                "metadata.scope": "asset-images",
            });
            if (!anchor?.metadata) {
                throw new common_1.BadRequestException("الصورة المرجعية لهذا الموضع غير موجودة.");
            }
            const anchorFp = normalizeMvAssetFolderPath(String(anchor.metadata.folderPath ??
                folderPathFromRelativePath(anchor.metadata.relativePath || anchor.metadata.originalFileName || "")));
            if (anchorFp !== targetFolderNormalized) {
                throw new common_1.BadRequestException("موضع الإدراج يجب أن يكون ضمن المجلد المستهدف.");
            }
            const anchorPicOid = anchor.metadata.picAssetId ?? null;
            if ((targetPicOid && !anchorPicOid?.equals(targetPicOid)) ||
                (!targetPicOid && anchorPicOid)) {
                throw new common_1.BadRequestException("موضع الإدراج لا ينتمي لنفس مجلد صور الأصول.");
            }
        }
        const siblingDocsForFolder = async (folderNorm, picOid) => col
            .find({
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
            ...picAssetScopeFilter(picOid),
            ...assetImageFolderMongoFilter(folderNorm),
            _id: { $ne: oidMoving },
        })
            .toArray();
        const siblingsSorted = (await siblingDocsForFolder(targetFolderNormalized, targetPicOid)).sort(compareAssetImageGridDocs);
        let idsOrdered;
        if (insertBeforeOid) {
            const idxBefore = siblingsSorted.findIndex((d) => d._id.equals(insertBeforeOid));
            if (idxBefore < 0) {
                throw new common_1.BadRequestException("الصورة المرجعية ليست في المجلد المستهدف.");
            }
            idsOrdered = [
                ...siblingsSorted.slice(0, idxBefore).map((d) => d._id),
                oidMoving,
                ...siblingsSorted.slice(idxBefore).map((d) => d._id),
            ];
        }
        else {
            idsOrdered = [...siblingsSorted.map((d) => d._id), oidMoving];
        }
        const now = new Date();
        if (crossFolderMove) {
            const uniq = await this.uniqueRelativePathForAssetImageFolder(db, pid, oidMoving, {
                folderPathNorm: targetFolderNormalized,
                preferredBasename: oldBasename,
            });
            if (targetPicOid) {
                const picFolder = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                    _id: targetPicOid,
                    projectId: pid,
                    ...MV_PHOTO_FOLDER_FILTER,
                });
                if (!picFolder) {
                    throw new common_1.BadRequestException("مجلد الأصل المستهدف غير موجود أو غير صالح.");
                }
                const photosRoot = await this.ensurePhotosRootFolder(db, pid);
                if (!picFolder.parent?.equals(photosRoot._id)) {
                    throw new common_1.BadRequestException("يجب أن يكون المجلد المستهدف تحت صور المعاينة.");
                }
            }
            const setMeta = {
                "metadata.relativePath": uniq.relativePath,
                "metadata.folderPath": uniq.folderPath,
                "metadata.updatedAt": now,
            };
            const unsetMeta = {};
            if (targetPicOid) {
                setMeta["metadata.picAssetId"] = targetPicOid;
            }
            else if (sourcePicOid) {
                unsetMeta["metadata.picAssetId"] = "";
            }
            const updatePayload = { $set: setMeta };
            if (Object.keys(unsetMeta).length > 0)
                updatePayload.$unset = unsetMeta;
            await col.updateOne({ _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" }, updatePayload);
        }
        if (!crossFolderMove && sourcePicOid?.toString() !== targetPicOid?.toString()) {
            const setMeta = { "metadata.updatedAt": now };
            const unsetMeta = {};
            if (targetPicOid) {
                setMeta["metadata.picAssetId"] = targetPicOid;
            }
            else {
                unsetMeta["metadata.picAssetId"] = "";
            }
            const updatePayload = { $set: setMeta };
            if (Object.keys(unsetMeta).length > 0)
                updatePayload.$unset = unsetMeta;
            await col.updateOne({ _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" }, updatePayload);
        }
        await Promise.all(idsOrdered.map((fid, i) => col.updateOne({ _id: fid, "metadata.projectId": pid, "metadata.scope": "asset-images" }, {
            $set: {
                "metadata.displayOrder": i,
                "metadata.folderPath": targetFolderNormalized,
                "metadata.updatedAt": now,
            },
        })));
        if (crossFolderMove) {
            const restSource = (await siblingDocsForFolder(sourceFolderNormalized, sourcePicOid)).sort(compareAssetImageGridDocs);
            await Promise.all(restSource.map((d, i) => col.updateOne({ _id: d._id }, {
                $set: {
                    "metadata.displayOrder": i,
                    "metadata.folderPath": sourceFolderNormalized,
                    "metadata.updatedAt": now,
                },
            })));
        }
        return this.listProjectAssetImageFiles(projectId, ctx);
    }
    async updateProjectAssetImageReportSelection(projectId, ctx, fileIdsInput, includeInReport) {
        const fileIds = Array.from(new Set((Array.isArray(fileIdsInput) ? fileIdsInput : []).map((id) => String(id ?? "").trim()).filter(Boolean)));
        if (fileIds.length === 0) {
            throw new common_1.BadRequestException("fileIds مطلوب.");
        }
        const ids = [];
        for (const id of fileIds) {
            const oid = (0, object_id_util_1.tryParseObjectId)(id);
            if (!oid)
                throw new common_1.BadRequestException("معرف ملف غير صالح.");
            ids.push(oid);
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const now = new Date();
        const result = await col.updateMany({
            _id: { $in: ids },
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
        }, {
            $set: {
                "metadata.includeInReport": includeInReport,
                "metadata.updatedAt": now,
            },
        });
        if (result.matchedCount !== ids.length) {
            throw new common_1.BadRequestException("بعض الصور غير موجودة أو لا تنتمي لهذا المشروع.");
        }
        return this.listProjectAssetImageFiles(projectId, ctx);
    }
    async uniqueRelativePathForAssetImageFolder(db, pid, excludeFileId, params) {
        const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const folderPathNorm = params.folderPathNorm;
        let base = sanitizeUploadedFileName(params.preferredBasename);
        for (let n = 0; n < 5000; n++) {
            const relativePathCandidate = sanitizeUploadedRelativePath(folderPathNorm ? `${folderPathNorm}/${base}` : base, base) || base;
            const clash = await col.findOne({
                _id: { $ne: excludeFileId },
                "metadata.projectId": pid,
                "metadata.scope": "asset-images",
                "metadata.relativePath": relativePathCandidate,
            });
            if (!clash) {
                return {
                    relativePath: relativePathCandidate,
                    folderPath: folderPathNorm,
                };
            }
            const stemDot = base.lastIndexOf(".");
            const stem = stemDot > 0 ? base.slice(0, stemDot) : base;
            const ext = stemDot > 0 ? base.slice(stemDot) : "";
            base = sanitizeUploadedFileName(`${stem} (${n + 1})${ext}`);
        }
        throw new common_1.BadRequestException("تعذّر إيجاد مسار ملف متاح.");
    }
    async buildDisplayOrdersForIncomingAssetImages(db, pid, files, options) {
        const assignments = new Map();
        const sequence = [];
        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            if (!file)
                continue;
            const fileName = sanitizeUploadedFileName(file.originalname);
            if (options.imageOnly && !isLikelyImageUpload(fileName, file.mimetype)) {
                continue;
            }
            const relativePath = sanitizeUploadedRelativePath(options.relativePaths?.[index] || file.originalname, fileName);
            const folderPath = folderPathFromRelativePath(relativePath);
            sequence.push({ idx: index, fp: folderPath });
        }
        if (sequence.length === 0)
            return assignments;
        const allExisting = await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .find({ "metadata.projectId": pid, "metadata.scope": "asset-images" })
            .project({ metadata: 1 })
            .toArray();
        const maxByFolder = new Map();
        for (const doc of allExisting) {
            const fp = doc.metadata?.folderPath ?? "";
            const ord = doc.metadata?.displayOrder;
            if (typeof ord === "number") {
                maxByFolder.set(fp, Math.max(maxByFolder.get(fp) ?? Number.NEGATIVE_INFINITY, ord));
            }
        }
        const nextVal = new Map();
        for (const { idx, fp } of sequence) {
            if (!nextVal.has(fp)) {
                nextVal.set(fp, (maxByFolder.get(fp) ?? -1) + 1);
            }
            const v = nextVal.get(fp);
            nextVal.set(fp, v + 1);
            assignments.set(idx, v);
        }
        return assignments;
    }
    async uploadProjectFiles(projectId, files, ctx, subProjectId, options = {}) {
        if (!Array.isArray(files) || files.length === 0) {
            throw new common_1.BadRequestException("At least one file is required");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const sid = subProjectId && subProjectId.trim().length > 0
            ? toId(subProjectId)
            : undefined;
        await this.assertSubProjectContext(db, pid, sid, ctx);
        const folderIsPicAsset = !!sid &&
            (await db
                .collection(collections_3.ASSETS_COLLECTION)
                .findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER })) != null;
        const bucket = this.getFilesBucket(db);
        const displayOrderByFileIndex = options.scope === "asset-images"
            ? await this.buildDisplayOrdersForIncomingAssetImages(db, pid, files, options)
            : new Map();
        const tasks = files.map((file, index) => async () => {
            if (!file)
                return null;
            let data = file.buffer;
            if (!data || data.length === 0) {
                const diskPath = file.path;
                if (diskPath) {
                    try {
                        data = await (0, promises_1.readFile)(diskPath);
                    }
                    catch {
                        data = undefined;
                    }
                }
            }
            if (!data || data.length === 0)
                return null;
            const fileName = sanitizeUploadedFileName(file.originalname);
            if (options.imageOnly && !isLikelyImageUpload(fileName, file.mimetype)) {
                return null;
            }
            const relativePath = sanitizeUploadedRelativePath(options.relativePaths?.[index] || file.originalname, fileName);
            const folderPath = folderPathFromRelativePath(relativePath);
            const assignedOrder = displayOrderByFileIndex.get(index);
            const now = new Date();
            const metadata = {
                projectId: pid,
                ...(sid
                    ? folderIsPicAsset
                        ? { picAssetId: sid }
                        : { subProjectId: sid }
                    : {}),
                ...(options.scope ? { scope: options.scope } : {}),
                relativePath,
                folderPath,
                mimeType: file.mimetype || "application/octet-stream",
                extension: extractFileExtension(fileName),
                originalFileName: fileName,
                updatedAt: now,
                includeInReport: true,
                ...(typeof assignedOrder === "number" ? { displayOrder: assignedOrder } : {}),
            };
            const useSpaces = options.preferDigitalOcean === true &&
                !sid &&
                !folderIsPicAsset &&
                this.inspectorSpaces.isReady();
            if (useSpaces) {
                const fileId = new mongodb_1.ObjectId();
                let uploaded;
                try {
                    uploaded = await this.inspectorSpaces.uploadInspectorFile({
                        projectId,
                        entryId: fileId.toString(),
                        fileName,
                        buffer: data,
                        contentType: file.mimetype || "application/octet-stream",
                    });
                }
                catch (err) {
                    this.logger.error(`uploadProjectFiles Spaces (valuation): ${err instanceof Error ? err.message : String(err)}`);
                    throw new common_1.BadRequestException("فشل رفع الملف إلى DigitalOcean Spaces.");
                }
                const metadataDo = {
                    ...metadata,
                    storage: "digitalocean",
                    spacesKey: uploaded.key,
                };
                await db.collection(collections_2.MV_FILES_FILES_COLLECTION).insertOne({
                    _id: fileId,
                    filename: fileName,
                    length: data.length,
                    uploadDate: now,
                    metadata: metadataDo,
                });
                return mapStoredFileDoc({
                    _id: fileId,
                    filename: fileName,
                    length: data.length,
                    uploadDate: now,
                    metadata: metadataDo,
                });
            }
            const fileId = await new Promise((resolve, reject) => {
                const uploadStream = bucket.openUploadStream(fileName, { metadata });
                uploadStream.on("error", reject);
                uploadStream.on("finish", () => resolve(uploadStream.id));
                uploadStream.end(data);
            });
            return mapStoredFileDoc({
                _id: fileId,
                filename: fileName,
                length: data.length,
                uploadDate: now,
                metadata,
            });
        });
        const batch = await runWithConcurrency(tasks, MV_GRIDFS_PARALLEL_UPLOAD_LIMIT);
        const uploaded = batch.filter((row) => row != null);
        if (uploaded.length === 0) {
            throw new common_1.BadRequestException("At least one non-empty file is required");
        }
        return uploaded;
    }
    async getProjectFileDownload(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        const file = await this.getStoredFileDoc(db, pid, fid);
        if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
            try {
                const object = await this.inspectorSpaces.getObjectStream(file.metadata.spacesKey.trim());
                return {
                    file: mapStoredFileDoc(file),
                    stream: object.stream,
                };
            }
            catch {
                throw new common_1.NotFoundException("File not found");
            }
        }
        return {
            file: mapStoredFileDoc(file),
            stream: this.getFilesBucket(db).openDownloadStream(fid),
        };
    }
    async deleteProjectFile(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        const file = await this.getStoredFileDoc(db, pid, fid);
        if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
            try {
                await this.inspectorSpaces.deleteObject(file.metadata.spacesKey.trim());
            }
            catch (err) {
                this.logger.warn(`deleteProjectFile Spaces: ${err instanceof Error ? err.message : String(err)}`);
            }
            await db.collection(collections_2.MV_FILES_FILES_COLLECTION).deleteOne({ _id: fid, "metadata.projectId": pid });
        }
        else {
            await this.getFilesBucket(db).delete(fid);
        }
        await db.collection(collections_3.ASSETS_COLLECTION).updateMany({ projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, {
            $pull: { images: { $in: [fid, fid.toString()] } },
            $set: { updatedAt: new Date() },
        });
        return { ok: true };
    }
    async listSheets(projectId, ctx, subProjectId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const filter = { projectId: pid };
        if (subProjectId)
            filter.subProjectId = toId(subProjectId);
        else
            filter.subProjectId = { $exists: false };
        const sheets = await db
            .collection(collections_2.MV_SHEETS_COLLECTION)
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
                    spreadsheetMeta: 1,
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
            spreadsheetMeta: s.spreadsheetMeta,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
        }));
    }
    async getSheet(id, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const s = await db.collection(collections_2.MV_SHEETS_COLLECTION).findOne({ _id });
        if (!s)
            throw new common_1.NotFoundException("Sheet not found");
        await this.loadProjectForAccess(db, s.projectId, ctx);
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
            spreadsheetMeta: s.spreadsheetMeta,
            createdAt: s.createdAt.toISOString(),
            updatedAt: s.updatedAt.toISOString(),
        };
    }
    async createSheet(body, ctx) {
        if (!body.name?.trim())
            throw new common_1.BadRequestException("Sheet name required");
        const db = await (0, mongodb_2.getMongoDb)();
        const projectOid = toId(body.projectId);
        await this.loadProjectForAccess(db, projectOid, ctx);
        const now = new Date();
        const headers = body.headers || [];
        const rowValues = (0, sheet_rows_util_1.recordsToRowValues)(headers, body.rows || []);
        const spreadsheetMeta = sanitizeSpreadsheetMeta(body.spreadsheetMeta, rowValues.length, headers.length);
        const doc = {
            projectId: projectOid,
            ...(body.subProjectId ? { subProjectId: toId(body.subProjectId) } : {}),
            name: body.name.trim(),
            headers,
            rowValues,
            sourceType: body.sourceType || "manual",
            sourceFileName: body.sourceFileName,
            ...(spreadsheetMeta ? { spreadsheetMeta } : {}),
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db.collection(collections_2.MV_SHEETS_COLLECTION).insertOne(doc);
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
            spreadsheetMeta: doc.spreadsheetMeta,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };
    }
    async updateSheet(id, body, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const existingSheet = await db.collection(collections_2.MV_SHEETS_COLLECTION).findOne({ _id });
        if (!existingSheet)
            throw new common_1.NotFoundException("Sheet not found");
        await this.loadProjectForAccess(db, existingSheet.projectId, ctx);
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
            const h = existingSheet.headers;
            $set.rowValues = (0, sheet_rows_util_1.recordsToRowValues)(h, body.rows);
            $unset.rows = "";
        }
        if (body.spreadsheetMeta !== undefined) {
            const metaHeaders = body.headers;
            const metaRows = body.rows;
            let headerCount = metaHeaders?.length;
            let rowCount = metaRows?.length;
            if (headerCount === undefined || rowCount === undefined) {
                headerCount ??= existingSheet.headers.length;
                rowCount ??= existingSheet.rowValues?.length ?? existingSheet.rows?.length ?? 0;
            }
            const spreadsheetMeta = sanitizeSpreadsheetMeta(body.spreadsheetMeta, rowCount, headerCount);
            if (spreadsheetMeta)
                $set.spreadsheetMeta = spreadsheetMeta;
            else
                $unset.spreadsheetMeta = "";
        }
        const updatePayload = { $set };
        if (Object.keys($unset).length) {
            updatePayload.$unset = $unset;
        }
        const updated = await db
            .collection(collections_2.MV_SHEETS_COLLECTION)
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
            spreadsheetMeta: updated.spreadsheetMeta,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    }
    async deleteSheet(id, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const sheet = await db.collection(collections_2.MV_SHEETS_COLLECTION).findOne({ _id });
        if (!sheet)
            throw new common_1.NotFoundException("Sheet not found");
        await this.loadProjectForAccess(db, sheet.projectId, ctx);
        const del = await db.collection(collections_2.MV_SHEETS_COLLECTION).deleteOne({ _id });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException("Sheet not found");
        return { ok: true };
    }
    async deleteAllSheets(projectId, ctx, subProjectId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const filter = { projectId: pid };
        if (subProjectId)
            filter.subProjectId = toId(subProjectId);
        else
            filter.subProjectId = { $exists: false };
        const result = await db.collection(collections_2.MV_SHEETS_COLLECTION).deleteMany(filter);
        return { ok: true, deletedCount: result.deletedCount };
    }
    async listHeaderOptions() {
        const db = await (0, mongodb_2.getMongoDb)();
        const options = await db
            .collection(collections_2.MV_HEADER_OPTIONS_COLLECTION)
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
            .collection(collections_2.MV_HEADER_OPTIONS_COLLECTION)
            .findOne({ name: n });
        if (existing)
            return { _id: existing._id.toString(), name: existing.name };
        const { insertedId } = await db
            .collection(collections_2.MV_HEADER_OPTIONS_COLLECTION)
            .insertOne({ name: n });
        return { _id: insertedId.toString(), name: n };
    }
};
exports.MachineValuationService = MachineValuationService;
exports.MachineValuationService = MachineValuationService = MachineValuationService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [digitalocean_spaces_service_1.DigitalOceanSpacesService])
], MachineValuationService);
