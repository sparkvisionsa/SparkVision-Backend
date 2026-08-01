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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var MachineValuationService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MachineValuationService = void 0;
const common_1 = require("@nestjs/common");
const promises_1 = require("node:fs/promises");
const node_crypto_1 = require("node:crypto");
const node_stream_1 = require("node:stream");
const zip_stream_1 = __importDefault(require("zip-stream"));
const object_id_util_1 = require("../common/object-id.util");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const collections_1 = require("../server/auth-tracking/collections");
const collections_2 = require("./collections");
const types_1 = require("./types");
const report_data_defaults_1 = require("./report-data-defaults");
const digitalocean_spaces_service_1 = require("./digitalocean-spaces.service");
const inspector_files_constants_1 = require("./inspector-files.constants");
const inspector_files_util_1 = require("./inspector-files.util");
const inspector_download_range_util_1 = require("./inspector-download-range.util");
const sheet_rows_util_1 = require("./sheet-rows.util");
const mv_project_scope_util_1 = require("./mv-project-scope.util");
const collections_3 = require("../assets/collections");
const asset_import_utils_1 = require("../assets/asset-import.utils");
const asset_import_constants_1 = require("../assets/asset-import.constants");
const mv_project_progress_util_1 = require("./mv-project-progress.util");
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
function normalizeRoleName(value) {
    return String(value ?? "").trim().toLowerCase();
}
function sanitizeStringList(value, maxItems = 80, maxLength = 120) {
    const rawItems = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,،]/) : [];
    const seen = new Set();
    const out = [];
    for (const item of rawItems) {
        const text = sanitizeOptionalText(item, maxLength);
        if (!text)
            continue;
        const key = text.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(text);
        if (out.length >= maxItems)
            break;
    }
    return out;
}
function isFreelanceInspectorRole(value) {
    const normalized = normalizeRoleName(value).replace(/[\s_-]+/g, " ");
    return normalized === "inspector" || normalized === "freelance inspector";
}
function optionalProfileText(profile, keys, maxLength = 120) {
    const info = profile?.additionalInfo;
    if (!info || typeof info !== "object")
        return null;
    for (const key of keys) {
        const value = info[key];
        const text = sanitizeOptionalText(value, maxLength);
        if (text)
            return text;
    }
    return null;
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
        .map((item, index) => {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const id = sanitizeOptionalText(data.id ?? data.siteId ?? data.locationId ?? data._id, 80) ||
            `site-${index + 1}`;
        const region = sanitizeOptionalText(data.region, 120);
        const city = sanitizeOptionalText(data.city, 120);
        const latitude = sanitizeCoordinate(data.latitude ?? data.lat, "lat");
        const longitude = sanitizeCoordinate(data.longitude ?? data.lng, "lng");
        const mapUrl = sanitizeOptionalText(data.mapUrl ?? data.url, 600);
        const name = sanitizeOptionalText(data.name ?? data.label ?? data.title, 120);
        const primaryPhone = sanitizeOptionalText(data.primaryPhone ?? data.primaryContactPhone ?? data.contactPhone ?? data.phone, 60);
        const secondaryPhone = sanitizeOptionalText(data.secondaryPhone ?? data.secondaryContactPhone ?? data.backupPhone ?? data.alternatePhone, 60);
        const notes = sanitizeOptionalText(data.notes ?? data.note, 2000);
        if (!name &&
            !region &&
            !city &&
            latitude === null &&
            longitude === null &&
            !mapUrl &&
            !primaryPhone &&
            !secondaryPhone &&
            !notes) {
            return null;
        }
        return {
            id,
            ...(name ? { name } : {}),
            region,
            city,
            latitude,
            longitude,
            ...(mapUrl ? { mapUrl } : {}),
            ...(primaryPhone ? { primaryPhone } : {}),
            ...(secondaryPhone ? { secondaryPhone } : {}),
            ...(notes ? { notes } : {}),
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
        .slice(0, 20)
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
        const primaryPhone = sanitizeOptionalText(data.primaryPhone ?? data.primaryContactPhone ?? data.contactPhone, 60);
        const secondaryPhone = sanitizeOptionalText(data.secondaryPhone ?? data.secondaryContactPhone ?? data.backupPhone ?? data.alternatePhone, 60);
        const type = data.type === "secondary" || (!data.type && !data.phone && !data.value && !data.number && secondaryPhone)
            ? "secondary"
            : "primary";
        const phone = sanitizeOptionalText(data.phone ?? data.value ?? data.number ?? (type === "secondary" ? secondaryPhone : primaryPhone), 60);
        const locationId = sanitizeOptionalText(data.locationId ?? data.siteId, 80);
        const rawLocationIndex = Number(data.locationIndex ?? data.siteIndex);
        const locationIndex = Number.isInteger(rawLocationIndex) && rawLocationIndex >= 0 && rawLocationIndex < 10
            ? rawLocationIndex
            : undefined;
        const locationName = sanitizeOptionalText(data.locationName ?? data.siteName, 120);
        return phone
            ? [
                {
                    type,
                    phone,
                    ...(locationId ? { locationId } : {}),
                    ...(locationIndex !== undefined ? { locationIndex } : {}),
                    ...(locationName ? { locationName } : {}),
                },
            ]
            : [];
    });
}
function mergeProjectContactsWithLocationPhones(contactsRaw, locations, strict = true) {
    const rawContacts = sanitizeProjectContacts(contactsRaw, strict);
    const hasExplicitContactLinks = rawContacts.some((contact) => contact.locationId || typeof contact.locationIndex === "number" || contact.locationName);
    const typeOccurrence = new Map();
    const contacts = rawContacts.map((contact) => {
        if (!hasExplicitContactLinks && locations.length > 0) {
            const occurrence = typeOccurrence.get(contact.type) ?? 0;
            typeOccurrence.set(contact.type, occurrence + 1);
            const locationIndex = Math.min(occurrence, locations.length - 1);
            const location = locations[locationIndex];
            return {
                ...contact,
                locationIndex,
                ...(location?.id ? { locationId: location.id } : {}),
                ...(location?.name ? { locationName: location.name } : {}),
            };
        }
        const location = contact.locationId
            ? locations.find((item) => item.id === contact.locationId)
            : typeof contact.locationIndex === "number"
                ? locations[contact.locationIndex]
                : undefined;
        return {
            ...contact,
            ...(location?.id && !contact.locationId ? { locationId: location.id } : {}),
            ...(location?.name && !contact.locationName ? { locationName: location.name } : {}),
        };
    });
    const contactKey = (contact) => contact.locationId
        ? `${contact.type}:id:${contact.locationId}`
        : `${contact.type}:index:${contact.locationIndex ?? 0}`;
    const existing = new Set(contacts.map(contactKey));
    for (const [index, location] of locations.slice(0, 10).entries()) {
        const locationId = sanitizeOptionalText(location.id, 80) || `site-${index + 1}`;
        const locationName = sanitizeOptionalText(location.name, 120);
        const primaryPhone = sanitizeOptionalText(location.primaryPhone, 60);
        if (primaryPhone && !existing.has(`primary:id:${locationId}`) && !existing.has(`primary:index:${index}`)) {
            contacts.push({
                type: "primary",
                phone: primaryPhone,
                locationId,
                locationIndex: index,
                ...(locationName ? { locationName } : {}),
            });
            existing.add(`primary:id:${locationId}`);
        }
        const secondaryPhone = sanitizeOptionalText(location.secondaryPhone, 60);
        if (secondaryPhone && !existing.has(`secondary:id:${locationId}`) && !existing.has(`secondary:index:${index}`)) {
            contacts.push({
                type: "secondary",
                phone: secondaryPhone,
                locationId,
                locationIndex: index,
                ...(locationName ? { locationName } : {}),
            });
            existing.add(`secondary:id:${locationId}`);
        }
    }
    return contacts.slice(0, 20);
}
function mergeProjectLocationsWithContacts(locations, contacts) {
    const hasExplicitContactLinks = contacts.some((contact) => contact.locationId || typeof contact.locationIndex === "number" || contact.locationName);
    const unlinkedPrimaryContacts = hasExplicitContactLinks
        ? []
        : contacts.filter((contact) => contact.type === "primary");
    const unlinkedSecondaryContacts = hasExplicitContactLinks
        ? []
        : contacts.filter((contact) => contact.type === "secondary");
    return locations.map((location, index) => {
        const locationId = sanitizeOptionalText(location.id, 80) || `site-${index + 1}`;
        const locationName = sanitizeOptionalText(location.name, 120);
        const linkedContacts = hasExplicitContactLinks
            ? contacts.filter((contact) => {
                if (contact.locationId && contact.locationId === locationId)
                    return true;
                if (typeof contact.locationIndex === "number" && contact.locationIndex === index)
                    return true;
                return !!contact.locationName && !!locationName && contact.locationName === locationName;
            })
            : [unlinkedPrimaryContacts[index], unlinkedSecondaryContacts[index]].filter((contact) => contact != null);
        const primaryPhone = sanitizeOptionalText(location.primaryPhone, 60) ||
            linkedContacts.find((contact) => contact.type === "primary")?.phone ||
            "";
        const secondaryPhone = sanitizeOptionalText(location.secondaryPhone, 60) ||
            linkedContacts.find((contact) => contact.type === "secondary")?.phone ||
            "";
        return {
            ...location,
            id: locationId,
            ...(primaryPhone ? { primaryPhone } : {}),
            ...(secondaryPhone ? { secondaryPhone } : {}),
        };
    });
}
function parseStringArrayField(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value !== "string")
        return [];
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed))
            return parsed;
    }
    catch {
    }
    return trimmed.split(",");
}
function sanitizeLocationIdSelection(value, locations) {
    const allowed = new Set(locations
        .map((location, index) => sanitizeOptionalText(location.id, 80) || `site-${index + 1}`)
        .filter(Boolean));
    const raw = parseStringArrayField(value);
    const out = [];
    const seen = new Set();
    for (const item of raw) {
        const id = sanitizeOptionalText(item, 80);
        if (!id || id === "__all__" || id === "all")
            return [];
        if (allowed.size > 0 && !allowed.has(id))
            continue;
        if (seen.has(id))
            continue;
        seen.add(id);
        out.push(id);
        if (out.length >= 20)
            break;
    }
    return out;
}
function coerceDate(value, fallback) {
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value;
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()))
            return parsed;
    }
    return fallback;
}
function sanitizeInspectionAssignments(value, locations, assignedBy) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new common_1.BadRequestException("inspectionAssignments must be an array");
    const now = new Date();
    const out = [];
    const seen = new Set();
    for (const item of value.slice(0, 50)) {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const inspectorUserId = sanitizeOptionalText(data.inspectorUserId ?? data.userId ?? data.id, 80);
        const inspectorName = sanitizeOptionalText(data.inspectorName ?? data.name ?? data.username, 180);
        if (!inspectorUserId || !inspectorName)
            continue;
        const locationIds = sanitizeLocationIdSelection(data.locationIds, locations);
        const key = `${inspectorUserId}:${locationIds.length > 0 ? locationIds.join("|") : "all"}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push({
            id: sanitizeOptionalText(data.id, 80) || (0, node_crypto_1.randomUUID)(),
            inspectorUserId,
            inspectorName,
            ...(locationIds.length > 0 ? { locationIds } : {}),
            assignedBy: typeof data.assignedBy === "string"
                ? sanitizeOptionalText(data.assignedBy, 80) || null
                : assignedBy ?? null,
            createdAt: coerceDate(data.createdAt, now),
            updatedAt: coerceDate(data.updatedAt, now),
        });
    }
    return out;
}
function serializeInspectionAssignment(row) {
    const r = row;
    const now = new Date();
    const locationIds = parseStringArrayField(r.locationIds)
        .map((item) => sanitizeOptionalText(item, 80))
        .filter(Boolean)
        .slice(0, 20);
    return {
        id: sanitizeOptionalText(r.id, 80) || (0, node_crypto_1.randomUUID)(),
        inspectorUserId: sanitizeOptionalText(r.inspectorUserId ?? r.userId, 80),
        inspectorName: sanitizeOptionalText(r.inspectorName ?? r.name ?? r.username, 180),
        locationIds,
        assignedBy: r.assignedBy != null ? sanitizeOptionalText(r.assignedBy, 80) || null : null,
        createdAt: coerceDate(r.createdAt, now).toISOString(),
        updatedAt: coerceDate(r.updatedAt, now).toISOString(),
    };
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
function sanitizeReportTeamMembers(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .slice(0, 12)
        .map((item, index) => {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const name = sanitizeOptionalText(data.name, 180);
        const title = sanitizeOptionalText(data.title, 180);
        const membershipNo = sanitizeOptionalText(data.membershipNo, 80);
        const role = sanitizeOptionalText(data.role, 500);
        if (!name && !title && !membershipNo && !role)
            return null;
        return {
            id: sanitizeOptionalText(data.id, 80) || `member-${index + 1}`,
            name,
            ...(title ? { title } : {}),
            ...(membershipNo ? { membershipNo } : {}),
            ...(role ? { role } : {}),
        };
    })
        .filter((item) => item != null);
}
function sanitizeReportTextOverrides(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(value).slice(0, 260)) {
        const key = sanitizeOptionalText(rawKey, 180);
        if (!key)
            continue;
        out[key] = sanitizeOptionalText(rawValue, 4000);
    }
    return out;
}
function sanitizeReportEditableSections(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .slice(0, 40)
        .map((item, index) => {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const title = sanitizeOptionalText(data.title, 220);
        const body = sanitizeOptionalText(data.body, 50_000);
        const sectionNumber = sanitizeOptionalText(data.sectionNumber, 40);
        const companyDefaultSectionId = sanitizeOptionalText(data.companyDefaultSectionId, 120);
        if (!title && !body)
            return null;
        return {
            id: sanitizeOptionalText(data.id, 120) || `section-${index + 1}`,
            ...(sectionNumber ? { sectionNumber } : {}),
            title: title || "قسم جديد",
            body,
            ...(sanitizeOptionalText(data.insertAfterAnchorId, 180)
                ? { insertAfterAnchorId: sanitizeOptionalText(data.insertAfterAnchorId, 180) }
                : {}),
            ...(companyDefaultSectionId ? { companyDefaultSectionId } : {}),
        };
    })
        .filter((item) => item != null);
}
function sanitizeReportInsertedBlockKind(value) {
    return value === "paragraph" || value === "image" ? value : "heading";
}
function sanitizeReportInsertedBlocks(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .slice(0, 120)
        .map((item, index) => {
        const data = item && typeof item === "object" && !Array.isArray(item)
            ? item
            : {};
        const kind = sanitizeReportInsertedBlockKind(data.kind);
        const content = sanitizeOptionalText(data.content, 50_000);
        const imageDataUrl = sanitizeOptionalText(data.imageDataUrl, 10_000_000);
        const caption = sanitizeOptionalText(data.caption, 2000);
        const position = data.position === "before" ? "before" : data.position === "after" ? "after" : undefined;
        const align = data.align === "start" || data.align === "center" || data.align === "end"
            ? data.align
            : undefined;
        const widthPercent = typeof data.widthPercent === "number" && Number.isFinite(data.widthPercent)
            ? Math.min(100, Math.max(20, Math.round(data.widthPercent)))
            : undefined;
        if (kind === "image" && !imageDataUrl)
            return null;
        return {
            id: sanitizeOptionalText(data.id, 120) || `block-${index + 1}`,
            anchorId: sanitizeOptionalText(data.anchorId, 180) || "report-cover",
            kind,
            ...(content ? { content } : {}),
            ...(imageDataUrl ? { imageDataUrl } : {}),
            ...(caption ? { caption } : {}),
            ...(position ? { position } : {}),
            ...(align ? { align } : {}),
            ...(widthPercent != null ? { widthPercent } : {}),
        };
    })
        .filter((item) => item != null);
}
function sanitizeReportAnchorIds(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const raw of value.slice(0, 180)) {
        const id = sanitizeOptionalText(raw, 180);
        if (id && !out.includes(id))
            out.push(id);
    }
    return out;
}
function sanitizeReportPageOrientations(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const out = {};
    for (const [rawKey, rawValue] of Object.entries(value).slice(0, 220)) {
        const key = sanitizeOptionalText(rawKey, 180);
        if (!key)
            continue;
        if (rawValue === "portrait" || rawValue === "landscape")
            out[key] = rawValue;
    }
    return out;
}
const MV_LEGACY_ARABIC_VALUATION_PURPOSES = {
    بيع: "البيع",
    شراء: "الشراء",
    محاسبة: "المحاسبة",
    رهن: "الرهن",
    إفلاس: "الإفلاس",
    تمويل: "التمويل",
    تأمين: "التأمين",
    "نزاعات و تقاضي": "النزاعات والتقاضي",
    أخرى: "الأخرى",
};
function sanitizeValuationPurpose(value) {
    const purpose = sanitizeOptionalText(value, 120);
    return MV_LEGACY_ARABIC_VALUATION_PURPOSES[purpose] ?? purpose;
}
function buildWindowsStyleCopyName(baseName, existingNames, locale) {
    const base = String(baseName ?? "").trim() || (locale === "ar" ? "مشروع" : "Project");
    const suffix = locale === "ar" ? "نسخة" : "Copy";
    const existing = new Set([...existingNames]
        .map((name) => String(name ?? "").trim().toLocaleLowerCase())
        .filter(Boolean));
    const first = `${base} - ${suffix}`;
    if (!existing.has(first.toLocaleLowerCase()))
        return first;
    for (let n = 2; n < 10_000; n += 1) {
        const candidate = `${base} - ${suffix} (${n})`;
        if (!existing.has(candidate.toLocaleLowerCase()))
            return candidate;
    }
    return `${base} - ${suffix} (${Date.now()})`;
}
function hasMeaningfulSanitizedReportData(data) {
    if (data.finalValue != null && Number.isFinite(Number(data.finalValue)))
        return true;
    if (Array.isArray(data.valuationTeam) && data.valuationTeam.length > 0)
        return true;
    const textKeys = [
        "valuationMethod",
        "reportReference",
        "reportTitle",
        "valuationPurpose",
        "valuePremise",
        "valuationBasis",
        "reportIssueDate",
        "agreementDate",
        "inspectionDate",
        "valuationDate",
        "clientName",
        "clientEmail",
        "clientPhone",
        "clientLegalType",
        "clientActivity",
        "clientRepresentativeName",
        "clientRepresentativeRole",
        "intendedUsers",
        "intendedUse",
        "inspectionLocation",
        "inspectionMapUrl",
        "finalValueWords",
        "reportNarrativeB1",
        "reportNarrativeB2",
        "reportNarrativeB3",
        "reportNarrativeB4",
        "reportIntroExtraHtml",
        "receivedClientDocumentsHtml",
        "sceRegistrationCertificateHtml",
    ];
    for (const key of textKeys) {
        const value = data[key];
        if (typeof value === "string" && value.trim().length > 0)
            return true;
    }
    if (data.reportTextOverrides && Object.keys(data.reportTextOverrides).length > 0)
        return true;
    if (Array.isArray(data.reportEditableSections) && data.reportEditableSections.length > 0)
        return true;
    if (Array.isArray(data.reportInsertedBlocks) && data.reportInsertedBlocks.length > 0)
        return true;
    if (Array.isArray(data.reportHiddenAnchorIds) && data.reportHiddenAnchorIds.length > 0)
        return true;
    return false;
}
function sanitizeReportData(raw) {
    const data = raw && typeof raw === "object" ? raw : {};
    return {
        reportReference: sanitizeOptionalText(data.reportReference, 120),
        reportTitle: sanitizeOptionalText(data.reportTitle, 220),
        valuationMethod: sanitizeOptionalText(data.valuationMethod, 120),
        valuationPurpose: sanitizeValuationPurpose(data.valuationPurpose),
        assetSingularPlural: sanitizeOptionalText(data.assetSingularPlural, 120) ||
            report_data_defaults_1.MV_REPORT_DEFAULT_ASSET_SINGULAR_PLURAL,
        valuePremise: sanitizeOptionalText(data.valuePremise, 120),
        valuePremiseDefinition: sanitizeOptionalText(data.valuePremiseDefinition, 4000) ||
            report_data_defaults_1.MV_REPORT_DEFAULT_VALUE_PREMISE_DEFINITION,
        valuationBasis: sanitizeOptionalText(data.valuationBasis, 220),
        valuationBasisDefinition: sanitizeOptionalText(data.valuationBasisDefinition, 4000) ||
            report_data_defaults_1.MV_REPORT_DEFAULT_VALUATION_BASIS_DEFINITION,
        includeAssetImages: data.includeAssetImages !== false,
        includeValuationAccountImages: data.includeValuationAccountImages !== false,
        reportIssueDate: sanitizeIsoDateOnly(data.reportIssueDate),
        agreementDate: sanitizeIsoDateOnly(data.agreementDate),
        inspectionDate: sanitizeIsoDateOnly(data.inspectionDate),
        valuationDate: sanitizeIsoDateOnly(data.valuationDate),
        clientId: sanitizeOptionalText(data.clientId, 80),
        clientName: sanitizeOptionalText(data.clientName, 180),
        clientEmail: sanitizeOptionalText(data.clientEmail, 180),
        clientPhone: sanitizeOptionalText(data.clientPhone, 60),
        clientLegalType: sanitizeOptionalText(data.clientLegalType, 180),
        clientActivity: sanitizeOptionalText(data.clientActivity, 240),
        clientRepresentativeName: sanitizeOptionalText(data.clientRepresentativeName, 180),
        clientRepresentativeRole: sanitizeOptionalText(data.clientRepresentativeRole, 180),
        intendedUsers: sanitizeOptionalText(data.intendedUsers, 500),
        intendedUse: sanitizeOptionalText(data.intendedUse, 1000),
        valuationFirmName: sanitizeOptionalText(data.valuationFirmName, 220),
        valuationFirmLicense: sanitizeOptionalText(data.valuationFirmLicense, 120),
        valuationFirmAddress: sanitizeOptionalText(data.valuationFirmAddress, 600),
        leadValuerName: sanitizeOptionalText(data.leadValuerName, 180),
        leadValuerTitle: sanitizeOptionalText(data.leadValuerTitle, 180),
        leadValuerMembershipNo: sanitizeOptionalText(data.leadValuerMembershipNo, 80),
        reportTypeLabel: sanitizeOptionalText(data.reportTypeLabel, 120),
        standardsVersion: sanitizeOptionalText(data.standardsVersion, 220),
        scopeOfWorkDetails: sanitizeOptionalText(data.scopeOfWorkDetails, 6000),
        useRestriction: sanitizeOptionalText(data.useRestriction, 3000),
        externalSpecialistUse: sanitizeOptionalText(data.externalSpecialistUse, 2000),
        esgConsiderations: sanitizeOptionalText(data.esgConsiderations, 2000),
        informationSources: sanitizeOptionalText(data.informationSources, 6000),
        assetSubjectDescription: sanitizeOptionalText(data.assetSubjectDescription, 4000) ||
            report_data_defaults_1.MV_REPORT_DEFAULT_ASSET_SUBJECT_DESCRIPTION,
        assetDetailedDescription: sanitizeOptionalText(data.assetDetailedDescription, 6000),
        inspectionLocation: sanitizeOptionalText(data.inspectionLocation, 500),
        inspectionMapUrl: sanitizeOptionalText(data.inspectionMapUrl, 800),
        currencyLabel: sanitizeOptionalText(data.currencyLabel, 120),
        methodologyRationale: sanitizeOptionalText(data.methodologyRationale, 6000),
        costApproachDetails: sanitizeOptionalText(data.costApproachDetails, 6000),
        valuationTeam: sanitizeReportTeamMembers(data.valuationTeam),
        importantAssumptions: sanitizeOptionalText(data.importantAssumptions, 4000),
        generalAssumptions: sanitizeOptionalText(data.generalAssumptions, 6000),
        specialAssumptions: sanitizeOptionalText(data.specialAssumptions, 4000),
        finalValue: sanitizeFinalValue(data.finalValue),
        finalValueWords: sanitizeOptionalText(data.finalValueWords, 500),
        reportTemplateId: sanitizeOptionalText(data.reportTemplateId, 120),
        reportPresentationDraft: data.reportPresentationDraft !== false,
        receivedClientDocumentsHtml: sanitizeOptionalText(data.receivedClientDocumentsHtml, 50_000),
        clientDocumentsImagesPerRow: (() => {
            const n = Math.trunc(Number(data.clientDocumentsImagesPerRow));
            return n === 1 || n === 2 || n === 3 ? n : 2;
        })(),
        wordAssetImagesPerRow: (() => {
            const n = Math.trunc(Number(data.wordAssetImagesPerRow));
            return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 4;
        })(),
        wordImageQuality: (() => {
            const n = Math.trunc(Number(data.wordImageQuality));
            return Number.isFinite(n) ? Math.max(60, Math.min(100, n)) : 90;
        })(),
        sceRegistrationCertificateHtml: sanitizeOptionalText(data.sceRegistrationCertificateHtml, 50_000),
        reportTextOverrides: sanitizeReportTextOverrides(data.reportTextOverrides),
        reportIntroExtraHtml: sanitizeOptionalText(data.reportIntroExtraHtml, 50_000),
        reportNarrativeB1: sanitizeOptionalText(data.reportNarrativeB1, 50_000),
        reportNarrativeB2: sanitizeOptionalText(data.reportNarrativeB2, 50_000),
        reportNarrativeB3: sanitizeOptionalText(data.reportNarrativeB3, 50_000),
        reportNarrativeB4: sanitizeOptionalText(data.reportNarrativeB4, 50_000),
        reportEditableSections: sanitizeReportEditableSections(data.reportEditableSections),
        reportInsertedBlocks: sanitizeReportInsertedBlocks(data.reportInsertedBlocks),
        reportHiddenAnchorIds: sanitizeReportAnchorIds(data.reportHiddenAnchorIds),
        reportPageOrientations: sanitizeReportPageOrientations(data.reportPageOrientations),
    };
}
function pickReportDataProgressSummary(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const data = raw;
    const pickText = (key, maxLength = 500) => {
        const value = sanitizeOptionalText(data[key], maxLength);
        return value || undefined;
    };
    const summary = {
        valuationMethod: pickText("valuationMethod", 120),
        reportReference: pickText("reportReference", 120),
        reportTitle: pickText("reportTitle", 220),
        valuationPurpose: pickText("valuationPurpose", 120),
        valuePremise: pickText("valuePremise", 120),
        valuationBasis: pickText("valuationBasis", 220),
        reportIssueDate: sanitizeIsoDateOnly(data.reportIssueDate) || undefined,
        agreementDate: sanitizeIsoDateOnly(data.agreementDate) || undefined,
        inspectionDate: sanitizeIsoDateOnly(data.inspectionDate) || undefined,
        valuationDate: sanitizeIsoDateOnly(data.valuationDate) || undefined,
        clientName: pickText("clientName", 180),
        clientEmail: pickText("clientEmail", 180),
        clientPhone: pickText("clientPhone", 60),
        clientLegalType: pickText("clientLegalType", 180),
        clientActivity: pickText("clientActivity", 240),
        clientRepresentativeName: pickText("clientRepresentativeName", 180),
        intendedUsers: pickText("intendedUsers", 500),
        intendedUse: pickText("intendedUse", 1000),
        inspectionLocation: pickText("inspectionLocation", 500),
        inspectionMapUrl: pickText("inspectionMapUrl", 800),
    };
    const finalValue = sanitizeFinalValue(data.finalValue);
    if (finalValue != null)
        summary.finalValue = finalValue;
    const reportTemplateId = pickText("reportTemplateId", 120);
    if (reportTemplateId)
        summary.reportTemplateId = reportTemplateId;
    const cleaned = Object.fromEntries(Object.entries(summary).filter(([, value]) => value != null && value !== ""));
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
const MV_VALUATION_WORKSPACE_MAX_JSON_CHARS = 9_500_000;
function jsonDeepClone(value) {
    return JSON.parse(JSON.stringify(value));
}
function cloneValuationAccountingWorkspaceObject(raw) {
    if (typeof globalThis.structuredClone === "function") {
        try {
            return structuredClone(raw);
        }
        catch {
        }
    }
    return jsonDeepClone(raw);
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
        obj = cloneValuationAccountingWorkspaceObject(raw);
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
                delete s.dataUrl;
            }
        }
    }
    const images = obj.images;
    if (images != null && !Array.isArray(images)) {
        throw new common_1.BadRequestException("valuationAccountingWorkspace.images invalid");
    }
    if (Array.isArray(images)) {
        obj.images = images
            .filter((im) => {
            if (!im || typeof im !== "object")
                return false;
            const fid = typeof im.fileId === "string"
                ? String(im.fileId).trim()
                : "";
            return Boolean(fid);
        })
            .map((im) => {
            const row = im;
            delete row.dataUrl;
            return row;
        });
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
        if (typeof raw === "object" && raw !== null) {
            return cloneValuationAccountingWorkspaceObject(raw);
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function sanitizeClientDocumentsWorkspaceForPersist(raw) {
    if (raw == null) {
        throw new common_1.BadRequestException("clientDocumentsWorkspace is required when provided");
    }
    let obj;
    if (typeof raw === "string") {
        try {
            obj = JSON.parse(raw);
        }
        catch {
            throw new common_1.BadRequestException("clientDocumentsWorkspace must be valid JSON");
        }
    }
    else if (typeof raw === "object") {
        obj = cloneValuationAccountingWorkspaceObject(raw);
    }
    else {
        throw new common_1.BadRequestException("clientDocumentsWorkspace must be an object");
    }
    if (!obj || typeof obj !== "object") {
        throw new common_1.BadRequestException("clientDocumentsWorkspace invalid");
    }
    if (obj.version !== 1) {
        throw new common_1.BadRequestException("clientDocumentsWorkspace version must be 1");
    }
    const sources = obj.sources;
    if (sources != null && !Array.isArray(sources)) {
        throw new common_1.BadRequestException("clientDocumentsWorkspace.sources invalid");
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
        throw new common_1.BadRequestException("clientDocumentsWorkspace.images invalid");
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
    const serialized = JSON.stringify(obj);
    if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
        throw new common_1.BadRequestException("clientDocumentsWorkspace exceeds maximum allowed size");
    }
    return obj;
}
function sanitizeClientDocumentsWorkspaceForClient(raw) {
    return sanitizeValuationAccountingWorkspaceForClient(raw);
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
function mongoSafeArraySize(fieldPath) {
    return {
        $cond: [{ $isArray: fieldPath }, { $size: fieldPath }, 0],
    };
}
function mongoPicAssetImagesCount(fieldPath = "$images") {
    return {
        $cond: [
            { $isArray: fieldPath },
            { $size: fieldPath },
            {
                $cond: [
                    { $eq: [{ $type: fieldPath }, "object"] },
                    {
                        $reduce: {
                            input: { $objectToArray: fieldPath },
                            initialValue: 0,
                            in: {
                                $add: [
                                    "$$value",
                                    {
                                        $switch: {
                                            branches: [
                                                {
                                                    case: { $isArray: "$$this.v" },
                                                    then: { $size: "$$this.v" },
                                                },
                                                {
                                                    case: {
                                                        $and: [
                                                            { $ne: ["$$this.v", null] },
                                                            { $eq: [{ $type: "$$this.v" }, "object"] },
                                                        ],
                                                    },
                                                    then: 1,
                                                },
                                            ],
                                            default: 0,
                                        },
                                    },
                                ],
                            },
                        },
                    },
                    0,
                ],
            },
        ],
    };
}
function emptyPicAssetImagesObject() {
    return {
        plate: null,
        odometer: null,
        brand: null,
        details: null,
        other: [],
    };
}
function flattenPicAssetImagesRaw(raw) {
    if (Array.isArray(raw))
        return raw;
    if (!raw || typeof raw !== "object")
        return [];
    const out = [];
    for (const value of Object.values(raw)) {
        if (value == null)
            continue;
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item != null)
                    out.push(item);
            }
            continue;
        }
        if (typeof value === "object")
            out.push(value);
    }
    return out;
}
function isPicAssetCategorizedImagesObject(raw) {
    return !!raw && typeof raw === "object" && !Array.isArray(raw);
}
function mapPicAssetImagesStructure(raw, mapper) {
    if (Array.isArray(raw))
        return raw.map(mapper);
    if (!isPicAssetCategorizedImagesObject(raw))
        return raw;
    const next = { ...raw };
    for (const [key, value] of Object.entries(raw)) {
        if (value == null) {
            next[key] = value;
            continue;
        }
        if (Array.isArray(value)) {
            next[key] = value.map(mapper);
            continue;
        }
        if (typeof value === "object") {
            next[key] = mapper(value);
        }
    }
    return next;
}
function picAssetImagesExistFilter() {
    return {
        images: { $exists: true, $nin: [null, []] },
    };
}
function picAssetImageMatchesFileId(image, fileId) {
    if (image instanceof mongodb_1.ObjectId)
        return image.equals(fileId);
    if (typeof image === "string")
        return image === fileId.toString();
    const oid = picAssetImageFileObjectId(image);
    return !!oid && oid.equals(fileId);
}
function removePicAssetImageByFileId(raw, fileId) {
    let changed = false;
    if (Array.isArray(raw)) {
        const next = raw.filter((image) => {
            const keep = !picAssetImageMatchesFileId(image, fileId);
            if (!keep)
                changed = true;
            return keep;
        });
        return { next, changed };
    }
    if (!isPicAssetCategorizedImagesObject(raw)) {
        return { next: raw, changed: false };
    }
    const next = { ...raw };
    for (const [key, value] of Object.entries(raw)) {
        if (value == null)
            continue;
        if (Array.isArray(value)) {
            const filtered = value.filter((image) => {
                const keep = !picAssetImageMatchesFileId(image, fileId);
                if (!keep)
                    changed = true;
                return keep;
            });
            next[key] = filtered;
            continue;
        }
        if (typeof value === "object" && picAssetImageMatchesFileId(value, fileId)) {
            next[key] = key === "other" ? [] : null;
            changed = true;
        }
    }
    return { next, changed };
}
function buildAppendPicAssetImageUpdate(_existingImages, imageDoc, now) {
    const emptyCats = {
        plate: null,
        odometer: null,
        brand: null,
        details: null,
        other: [],
    };
    return [
        {
            $set: {
                updatedAt: now,
                images: {
                    $cond: [
                        { $isArray: "$images" },
                        { $concatArrays: ["$images", [imageDoc]] },
                        {
                            $let: {
                                vars: {
                                    base: {
                                        $mergeObjects: [
                                            emptyCats,
                                            {
                                                $cond: [
                                                    { $eq: [{ $type: "$images" }, "object"] },
                                                    "$images",
                                                    {},
                                                ],
                                            },
                                        ],
                                    },
                                },
                                in: {
                                    $mergeObjects: [
                                        "$$base",
                                        {
                                            other: {
                                                $concatArrays: [
                                                    {
                                                        $cond: [
                                                            { $isArray: "$$base.other" },
                                                            "$$base.other",
                                                            [],
                                                        ],
                                                    },
                                                    [imageDoc],
                                                ],
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            },
        },
    ];
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
        subAssetType: null,
        quantity: null,
        brand: null,
        code: null,
        model: null,
        manufactureYear: null,
        kilometersDriven: null,
        isPresent: true,
        createdBy,
        images: emptyPicAssetImagesObject(),
        voiceNotes: [],
        isDone: false,
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
function assetImageOriginalFilename(rawUrl) {
    try {
        const path = new URL(rawUrl).pathname;
        const name = path.split("/").filter(Boolean).at(-1)?.trim().toLowerCase() ?? "";
        return name || null;
    }
    catch {
        const name = rawUrl.split(/[?#]/, 1)[0]?.split("/").at(-1)?.trim().toLowerCase() ?? "";
        return name || null;
    }
}
function isDigitalOceanAssetImage(raw) {
    const url = raw && typeof raw === "object" ? raw.url : null;
    return typeof url === "string" && /(^|[/.])digitaloceanspaces\.com(?:[/:]|$)/i.test(url);
}
function dedupePicAssetImageMirrors(raw) {
    const list = flattenPicAssetImagesRaw(raw);
    if (list.length === 0)
        return [];
    const byFilename = new Map();
    list.forEach((item, index) => {
        const url = item && typeof item === "object" ? item.url : null;
        if (typeof url !== "string")
            return;
        const filename = assetImageOriginalFilename(url);
        if (!filename)
            return;
        const indexes = byFilename.get(filename);
        if (indexes)
            indexes.push(index);
        else
            byFilename.set(filename, [index]);
    });
    const keep = new Set(list.map((_, index) => index));
    for (const indexes of byFilename.values()) {
        if (indexes.length < 2)
            continue;
        const preferred = indexes.find((index) => isDigitalOceanAssetImage(list[index])) ??
            indexes[0];
        if (!isDigitalOceanAssetImage(list[preferred]))
            continue;
        for (const index of indexes) {
            if (index !== preferred)
                keep.delete(index);
        }
    }
    return list.filter((_, index) => keep.has(index));
}
function serializePicAssetImages(raw) {
    if (!Array.isArray(raw) && !isPicAssetCategorizedImagesObject(raw))
        return [];
    const out = [];
    for (const item of dedupePicAssetImageMirrors(raw)) {
        if (item instanceof mongodb_1.ObjectId) {
            out.push({ fileId: item.toString() });
            continue;
        }
        if (typeof item === "string" && mongodb_1.ObjectId.isValid(item)) {
            out.push({ fileId: item });
            continue;
        }
        if (item && typeof item === "object" && "fileId" in item && !("url" in item)) {
            const fid = item.fileId;
            const fileId = fid instanceof mongodb_1.ObjectId
                ? fid.toString()
                : typeof fid === "string" && mongodb_1.ObjectId.isValid(fid)
                    ? fid
                    : "";
            if (!fileId)
                continue;
            const row = { fileId };
            if (typeof item.includeInReport === "boolean") {
                row.includeInReport = item.includeInReport;
            }
            out.push(row);
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
    if (field === "images" && isPicAssetCategorizedImagesObject(raw)) {
        const out = { ...emptyPicAssetImagesObject() };
        for (const [key, value] of Object.entries(raw)) {
            if (value == null) {
                out[key] = null;
                continue;
            }
            if (Array.isArray(value)) {
                out[key] = normalizePicAssetMediaArrayForPatch(value, field);
                continue;
            }
            if (typeof value === "object") {
                const one = normalizePicAssetMediaArrayForPatch([value], field);
                out[key] = Array.isArray(one) && one.length > 0 ? one[0] : null;
                continue;
            }
            out[key] = null;
        }
        for (const key of Object.keys(raw)) {
            if (!(key in out)) {
                const value = raw[key];
                if (value == null)
                    out[key] = null;
                else if (Array.isArray(value))
                    out[key] = normalizePicAssetMediaArrayForPatch(value, field);
                else if (typeof value === "object") {
                    const one = normalizePicAssetMediaArrayForPatch([value], field);
                    out[key] = Array.isArray(one) && one.length > 0 ? one[0] : null;
                }
            }
        }
        return out;
    }
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
            const includeInReport = item.includeInReport;
            if (typeof fid === "string" && mongodb_1.ObjectId.isValid(fid)) {
                if (field === "images" && typeof includeInReport === "boolean") {
                    out.push({ fileId: new mongodb_1.ObjectId(fid), includeInReport });
                }
                else {
                    out.push(new mongodb_1.ObjectId(fid));
                }
                continue;
            }
            if (fid instanceof mongodb_1.ObjectId) {
                if (field === "images" && typeof includeInReport === "boolean") {
                    out.push({ fileId: fid, includeInReport });
                }
                else {
                    out.push(fid);
                }
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
function resolvePicAssetNotes(doc) {
    if (!doc)
        return null;
    const pick = (value) => {
        if (value === null || value === undefined)
            return null;
        if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            const asText = String(value).trim();
            return asText.length > 0 ? asText : null;
        }
        return null;
    };
    const direct = pick(doc.notes);
    if (direct != null)
        return direct;
    const normalized = pick(doc.normalizedData?.notes);
    if (normalized != null)
        return normalized;
    const raw = pick(doc.rawData?.notes);
    if (raw != null)
        return raw;
    return null;
}
function resolvePicAssetSubAssetType(doc) {
    if (!doc)
        return null;
    const pick = (v) => {
        if (typeof v === "string") {
            const t = v.trim();
            return t ? t : null;
        }
        if (typeof v === "number" && Number.isFinite(v))
            return String(v);
        return null;
    };
    const top = pick(doc.subAssetType);
    if (top)
        return top;
    const norm = pick(doc.normalizedData?.subAssetType);
    if (norm)
        return norm;
    return pick(doc.rawData?.subAssetType);
}
function resolvePicAssetQuantity(doc) {
    if (!doc)
        return null;
    const pick = (v) => {
        if (typeof v === "number" && Number.isFinite(v))
            return v;
        if (typeof v === "string") {
            const t = v.trim();
            if (!t)
                return null;
            const n = Number(t);
            return Number.isFinite(n) ? n : t;
        }
        return null;
    };
    const top = pick(doc.quantity);
    if (top != null)
        return top;
    const norm = pick(doc.normalizedData?.quantity);
    if (norm != null)
        return norm;
    return pick(doc.rawData?.quantity);
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
        notes: resolvePicAssetNotes(pic),
        assetType: normalizeAssetTypeForApi(pic.assetType),
        subAssetType: resolvePicAssetSubAssetType(pic),
        quantity: coerceNumberishField(resolvePicAssetQuantity(pic)),
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
function sanitizeZipPathPart(raw, fallback = "مجلد") {
    const cleaned = String(raw ?? "")
        .trim()
        .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
        .replace(/\//g, "-")
        .replace(/\s+/g, " ")
        .replace(/^\.+$/, "")
        .trim();
    return (cleaned || fallback).slice(0, 160);
}
function sanitizeZipFileName(raw, fallback = "file") {
    const cleaned = sanitizeUploadedFileName(raw).replace(/^\.+$/, "").trim();
    return (cleaned || fallback).slice(0, 180);
}
function uniqueZipChildName(baseName, usedNames) {
    const base = baseName.trim() || "مجلد";
    if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
    }
    for (let index = 1; index < 10_000; index += 1) {
        const candidate = `${base} (${index})`;
        if (!usedNames.has(candidate)) {
            usedNames.add(candidate);
            return candidate;
        }
    }
    const fallback = `${base}-${(0, node_crypto_1.randomUUID)()}`;
    usedNames.add(fallback);
    return fallback;
}
function joinZipPath(parts) {
    return parts
        .map((part) => String(part ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .join("/");
}
function uniqueZipPath(path, used) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!used.has(normalized)) {
        used.add(normalized);
        return normalized;
    }
    const slash = normalized.lastIndexOf("/");
    const folder = slash >= 0 ? normalized.slice(0, slash + 1) : "";
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let index = 2; index < 10_000; index += 1) {
        const candidate = `${folder}${stem} (${index})${ext}`;
        if (!used.has(candidate)) {
            used.add(candidate);
            return candidate;
        }
    }
    const fallback = `${folder}${stem}-${(0, node_crypto_1.randomUUID)()}${ext}`;
    used.add(fallback);
    return fallback;
}
function addZipStreamEntry(archive, source, options) {
    return new Promise((resolve, reject) => {
        archive.entry(source, { ...options, store: true }, (error) => {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
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
async function syncPicImagesIncludeInReportFromGridFsIds(db, projectId, fileIds, includeInReport) {
    if (fileIds.length === 0)
        return;
    const idSet = new Set(fileIds.map((id) => id.toString()));
    const pa = db.collection(collections_3.ASSETS_COLLECTION);
    const folders = await pa
        .find({
        projectId,
        ...MV_PHOTO_FOLDER_FILTER,
        ...picAssetImagesExistFilter(),
    })
        .project({ images: 1 })
        .toArray();
    if (folders.length === 0)
        return;
    const now = new Date();
    const ops = [];
    for (const folder of folders) {
        const imagesRaw = folder.images;
        const flat = flattenPicAssetImagesRaw(imagesRaw);
        if (flat.length === 0)
            continue;
        let changed = false;
        const nextImages = mapPicAssetImagesStructure(imagesRaw, (image) => {
            const fileId = picAssetImageFileObjectId(image);
            if (!fileId || !idSet.has(fileId.toString()))
                return image;
            const current = image && typeof image === "object"
                ? image.includeInReport === true
                : false;
            if (image &&
                typeof image === "object" &&
                typeof image.includeInReport === "boolean" &&
                current === includeInReport) {
                return image;
            }
            changed = true;
            if (typeof image === "string" && image.trim()) {
                return { fileId: image.trim(), includeInReport };
            }
            if (image && typeof image === "object") {
                return { ...image, includeInReport };
            }
            return image;
        });
        if (!changed)
            continue;
        ops.push({
            updateOne: {
                filter: { _id: folder._id, projectId },
                update: { $set: { images: nextImages, updatedAt: now } },
            },
        });
    }
    if (ops.length > 0) {
        await pa.bulkWrite(ops, { ordered: false });
    }
}
async function syncGridFsIncludeInReportFromPicImages(db, projectId, picAssetId, images) {
    const list = flattenPicAssetImagesRaw(images);
    if (list.length === 0)
        return;
    const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
    const now = new Date();
    const ops = [];
    for (const image of list) {
        const includeInReport = picAssetImageIncludeInReport(image);
        const fileId = picAssetImageFileObjectId(image);
        if (fileId) {
            ops.push({
                updateOne: {
                    filter: {
                        _id: fileId,
                        "metadata.projectId": projectId,
                        "metadata.scope": "asset-images",
                    },
                    update: {
                        $set: {
                            "metadata.includeInReport": includeInReport,
                            "metadata.updatedAt": now,
                        },
                    },
                },
            });
            continue;
        }
        const external = picAssetExternalImageUrl(image);
        if (!external)
            continue;
        ops.push({
            updateMany: {
                filter: {
                    "metadata.projectId": projectId,
                    "metadata.scope": "asset-images",
                    "metadata.picAssetId": picAssetId,
                    "metadata.sourceUrl": external.url,
                },
                update: {
                    $set: {
                        "metadata.includeInReport": includeInReport,
                        "metadata.updatedAt": now,
                    },
                },
            },
        });
    }
    if (ops.length === 0)
        return;
    try {
        await col.bulkWrite(ops, { ordered: false });
    }
    catch {
    }
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
const MV_ASSET_DOWNLOAD_JOB_TTL_MS = 60 * 60 * 1000;
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
function stableAssetImageSourceUrl(sourceUrl) {
    const raw = sourceUrl.trim();
    if (!raw)
        return "";
    try {
        const parsed = new URL(raw);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            return `${parsed.origin.toLowerCase()}${parsed.pathname}`.toLowerCase();
        }
    }
    catch {
    }
    return raw.toLowerCase();
}
function assetImageFileDedupeKey(doc) {
    const picAssetId = doc.metadata?.picAssetId?.toString?.() ?? "";
    const sourceUrl = typeof doc.metadata?.sourceUrl === "string" ? stableAssetImageSourceUrl(doc.metadata.sourceUrl) : "";
    if (sourceUrl)
        return `${picAssetId}::url::${sourceUrl.toLowerCase()}`;
    const relativePath = String(doc.metadata?.relativePath || doc.metadata?.originalFileName || "")
        .replace(/\\/g, "/")
        .trim()
        .toLowerCase();
    return `${picAssetId}::path::${relativePath}`;
}
function assetImageDedupeKeyMongoExpr() {
    return {
        $let: {
            vars: {
                picAssetId: { $toString: { $ifNull: ["$metadata.picAssetId", ""] } },
                sourceUrl: {
                    $toLower: {
                        $arrayElemAt: [
                            { $split: [{ $arrayElemAt: [{ $split: [{ $ifNull: ["$metadata.sourceUrl", ""] }, "#"] }, 0] }, "?"] },
                            0,
                        ],
                    },
                },
                path: {
                    $toLower: { $ifNull: ["$metadata.relativePath", { $ifNull: ["$filename", ""] }] },
                },
            },
            in: {
                $cond: [
                    { $gt: [{ $strLenCP: "$$sourceUrl" }, 0] },
                    { $concat: ["$$picAssetId", "::url::", "$$sourceUrl"] },
                    { $concat: ["$$picAssetId", "::path::", "$$path"] },
                ],
            },
        },
    };
}
function dedupeAssetImageFileDocs(docs) {
    const byKey = new Map();
    for (const doc of docs) {
        const key = assetImageFileDedupeKey(doc);
        const current = byKey.get(key);
        if (!current) {
            byKey.set(key, doc);
            continue;
        }
        const currentTime = current.uploadDate instanceof Date ? current.uploadDate.getTime() : 0;
        const nextTime = doc.uploadDate instanceof Date ? doc.uploadDate.getTime() : 0;
        const keepNext = nextTime < currentTime || (nextTime === currentTime && doc._id.toString() < current._id.toString());
        if (keepNext)
            byKey.set(key, doc);
    }
    return Array.from(byKey.values());
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
const MV_ASSET_IMAGE_EXTERNAL_FETCH_CONCURRENCY = 12;
async function reconcileExternalAssetImageGridFsDocs(db, projectId, externalRefs) {
    const validSourceUrlsByPicAsset = new Map();
    for (const ref of externalRefs) {
        const key = ref.picAssetId.toString();
        let set = validSourceUrlsByPicAsset.get(key);
        if (!set) {
            set = new Set();
            validSourceUrlsByPicAsset.set(key, set);
        }
        set.add(ref.url);
    }
    const picAssetIds = Array.from(validSourceUrlsByPicAsset.keys()).map((id) => new mongodb_1.ObjectId(id));
    if (picAssetIds.length === 0)
        return;
    const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
    const docs = await col
        .find({
        "metadata.projectId": projectId,
        "metadata.scope": "asset-images",
        "metadata.picAssetId": { $in: picAssetIds },
        "metadata.sourceUrl": { $exists: true },
    })
        .project({
        _id: 1,
        uploadDate: 1,
        "metadata.picAssetId": 1,
        "metadata.sourceUrl": 1,
    })
        .toArray();
    if (docs.length === 0)
        return;
    const groups = new Map();
    for (const doc of docs) {
        const picAssetId = doc.metadata?.picAssetId?.toString?.() ?? "";
        const sourceUrl = String(doc.metadata?.sourceUrl ?? "");
        const key = `${picAssetId}::${sourceUrl}`;
        const group = groups.get(key);
        if (group)
            group.push(doc);
        else
            groups.set(key, [doc]);
    }
    const idsToDelete = [];
    for (const [key, group] of groups) {
        const [picAssetId, sourceUrl] = key.split("::");
        const isStale = !validSourceUrlsByPicAsset.get(picAssetId)?.has(sourceUrl);
        if (isStale) {
            idsToDelete.push(...group.map((d) => d._id));
            continue;
        }
        if (group.length > 1) {
            const sorted = [...group].sort((a, b) => {
                const ta = a.uploadDate instanceof Date ? a.uploadDate.getTime() : 0;
                const tb = b.uploadDate instanceof Date ? b.uploadDate.getTime() : 0;
                if (ta !== tb)
                    return ta - tb;
                return a._id.toString().localeCompare(b._id.toString());
            });
            idsToDelete.push(...sorted.slice(1).map((d) => d._id));
        }
    }
    if (idsToDelete.length === 0)
        return;
    const bucket = new mongodb_1.GridFSBucket(db, { bucketName: collections_2.MV_FILES_BUCKET });
    await runWithConcurrency(idsToDelete.map((id) => async () => {
        try {
            await bucket.delete(id);
        }
        catch {
        }
    }), MV_GRIDFS_PARALLEL_UPLOAD_LIMIT);
}
async function backfillPicAssetGridFsImagesAsAssetFiles(db, projectId) {
    const picFolders = await db
        .collection(collections_3.ASSETS_COLLECTION)
        .find({
        projectId,
        ...MV_PHOTO_FOLDER_FILTER,
        ...picAssetImagesExistFilter(),
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
        const images = flattenPicAssetImagesRaw(folder.images);
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
                    includeInReport: picAssetImageIncludeInReport(image),
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
    await runWithConcurrency(externalRefs.map((ref) => async () => {
        try {
            await uploadExternalPicAssetImageToGridFs(db, projectId, ref);
        }
        catch {
        }
    }), MV_ASSET_IMAGE_EXTERNAL_FETCH_CONCURRENCY);
    if (externalRefs.length > 0) {
        await reconcileExternalAssetImageGridFsDocs(db, projectId, externalRefs);
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
            doc.metadata?.includeInReport !== ref.includeInReport ||
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
            "metadata.includeInReport": ref.includeInReport === true,
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
const assetImageBackfillJobs = new Map();
const assetImageBackfillCompletedAt = new Map();
const ASSET_IMAGE_BACKFILL_COOLDOWN_MS = 5 * 60_000;
function runAssetImageBackfill(db, projectId, options = {}) {
    const key = projectId.toString();
    const current = assetImageBackfillJobs.get(key);
    if (current)
        return current;
    const lastCompletedAt = assetImageBackfillCompletedAt.get(key) ?? 0;
    if (!options.force && Date.now() - lastCompletedAt < ASSET_IMAGE_BACKFILL_COOLDOWN_MS) {
        return Promise.resolve();
    }
    let job;
    job = backfillPicAssetGridFsImagesAsAssetFiles(db, projectId)
        .then(() => {
        assetImageBackfillCompletedAt.set(key, Date.now());
    })
        .catch((error) => {
        console.warn(`[machine-valuation] asset image backfill failed for ${key}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    })
        .finally(() => {
        if (assetImageBackfillJobs.get(key) === job)
            assetImageBackfillJobs.delete(key);
    });
    assetImageBackfillJobs.set(key, job);
    return job;
}
let MachineValuationService = MachineValuationService_1 = class MachineValuationService {
    constructor(inspectorSpaces) {
        this.inspectorSpaces = inspectorSpaces;
        this.logger = new common_1.Logger(MachineValuationService_1.name);
        this.assetImagesDownloadJobs = new Map();
    }
    updateAssetImagesDownloadJob(id, patch) {
        if (!id)
            return;
        const current = this.assetImagesDownloadJobs.get(id);
        if (!current)
            return;
        const next = { ...current, ...patch, updatedAt: Date.now() };
        this.assetImagesDownloadJobs.set(id, next);
    }
    trimAssetImagesDownloadJobs() {
        const cutoff = Date.now() - MV_ASSET_DOWNLOAD_JOB_TTL_MS;
        for (const [id, job] of this.assetImagesDownloadJobs) {
            if (job.updatedAt < cutoff)
                this.assetImagesDownloadJobs.delete(id);
        }
    }
    async getAssetImagesDownloadProgress(projectId, downloadId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        this.trimAssetImagesDownloadJobs();
        const job = this.assetImagesDownloadJobs.get(downloadId);
        if (!job || job.projectId !== pid.toString()) {
            throw new common_1.NotFoundException("Download progress not found");
        }
        return { ...job };
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
    photosTreeParentKey(projectId, parentId) {
        return `${projectId.toString()}\u001f${parentId.toString()}`;
    }
    photosTreeLocationKey(projectId, parentId, name) {
        return `${projectId.toString()}\u001f${parentId?.toString() ?? "__root__"}\u001f${normalizeSubProjectName(name)}`;
    }
    async redirectPhotosFolderReferences(db, projectId, fromId, toId) {
        if (fromId.equals(toId))
            return;
        const now = new Date();
        await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
        await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .updateMany({ projectId, parentSubProjectId: fromId }, { $set: { parent: toId, updatedAt: now }, $unset: { parentSubProjectId: "" } });
        await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
        await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .updateMany({ projectId, parentSubProjectId: fromId }, { $set: { parent: toId, updatedAt: now }, $unset: { parentSubProjectId: "" } });
        await db
            .collection(collections_3.ASSETS_COLLECTION)
            .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
        await db.collection(collections_2.MV_FILES_FILES_COLLECTION).updateMany({ "metadata.projectId": projectId, "metadata.subProjectId": fromId }, { $set: { "metadata.subProjectId": toId, "metadata.updatedAt": now } });
        await db.collection(collections_2.MV_FILES_FILES_COLLECTION).updateMany({ "metadata.projectId": projectId, "metadata.picAssetId": fromId }, { $set: { "metadata.picAssetId": toId, "metadata.updatedAt": now } });
    }
    async retargetLegacyAssetMirrorFiles(db, projectId, legacySubProjectId, picAssetId) {
        if (legacySubProjectId.equals(picAssetId))
            return;
        const now = new Date();
        await db.collection(collections_2.MV_FILES_FILES_COLLECTION).updateMany({
            "metadata.projectId": projectId,
            "metadata.scope": "asset-images",
            "metadata.subProjectId": legacySubProjectId,
        }, {
            $set: { "metadata.picAssetId": picAssetId, "metadata.updatedAt": now },
            $unset: { "metadata.subProjectId": "" },
        });
        await db.collection(collections_2.MV_FILES_FILES_COLLECTION).updateMany({
            "metadata.projectId": projectId,
            "metadata.scope": "asset-images",
            "metadata.picAssetId": legacySubProjectId,
        }, { $set: { "metadata.picAssetId": picAssetId, "metadata.updatedAt": now } });
    }
    async migratePhotosTreeSubProjectsToItems(db) {
        const subProjects = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const items = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const photoAssets = db.collection(collections_3.ASSETS_COLLECTION);
        const roots = (await items
            .find({
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
        })
            .toArray());
        if (roots.length === 0)
            return;
        const projectIds = Array.from(new Map(roots.map((root) => [root.projectId.toString(), root.projectId])).values());
        const legacyRows = (await subProjects
            .find({ projectId: { $in: projectIds } })
            .toArray());
        if (legacyRows.length === 0)
            return;
        const legacyChildrenByParent = new Map();
        for (const row of legacyRows) {
            const parent = getParentIdFromDoc(row);
            if (parent == null)
                continue;
            const key = this.photosTreeParentKey(row.projectId, parent);
            const bucket = legacyChildrenByParent.get(key);
            if (bucket)
                bucket.push(row);
            else
                legacyChildrenByParent.set(key, [row]);
        }
        const orderedLegacyPhotosRows = [];
        const visited = new Set();
        const queue = roots.map((root) => ({
            projectId: root.projectId,
            folderId: root._id,
        }));
        while (queue.length > 0) {
            const current = queue.shift();
            const children = legacyChildrenByParent.get(this.photosTreeParentKey(current.projectId, current.folderId)) ??
                [];
            for (const child of children) {
                const idKey = child._id.toString();
                if (visited.has(idKey))
                    continue;
                visited.add(idKey);
                orderedLegacyPhotosRows.push(child);
                queue.push({ projectId: child.projectId, folderId: child._id });
            }
        }
        if (orderedLegacyPhotosRows.length === 0)
            return;
        const existingItems = (await items
            .find({ projectId: { $in: projectIds } })
            .toArray());
        const itemIdByLocation = new Map();
        for (const item of existingItems) {
            itemIdByLocation.set(this.photosTreeLocationKey(item.projectId, getParentIdFromDoc(item) ?? null, item.name), item._id);
        }
        const parentRedirects = new Map();
        let movedFolders = 0;
        let mergedFolders = 0;
        let removedAssetMirrors = 0;
        for (const legacy of orderedLegacyPhotosRows) {
            const originalParent = getParentIdFromDoc(legacy) ?? null;
            const redirectedParent = originalParent != null
                ? parentRedirects.get(originalParent.toString()) ?? originalParent
                : null;
            const locationKey = this.photosTreeLocationKey(legacy.projectId, redirectedParent, legacy.name);
            const existingItemId = itemIdByLocation.get(locationKey);
            if (existingItemId && !existingItemId.equals(legacy._id)) {
                await this.redirectPhotosFolderReferences(db, legacy.projectId, legacy._id, existingItemId);
                await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
                parentRedirects.set(legacy._id.toString(), existingItemId);
                mergedFolders += 1;
                continue;
            }
            const legacyHasChildren = legacyChildrenByParent.get(this.photosTreeParentKey(legacy.projectId, legacy._id))?.length ??
                0;
            const matchingPicAsset = redirectedParent != null
                ? await photoAssets.findOne({
                    projectId: legacy.projectId,
                    parent: redirectedParent,
                    name: legacy.name,
                    ...MV_PHOTO_FOLDER_FILTER,
                })
                : null;
            if (matchingPicAsset && legacyHasChildren === 0) {
                await this.retargetLegacyAssetMirrorFiles(db, legacy.projectId, legacy._id, matchingPicAsset._id);
                await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
                removedAssetMirrors += 1;
                continue;
            }
            const now = new Date();
            await items.updateOne({ _id: legacy._id, projectId: legacy.projectId }, {
                $setOnInsert: {
                    _id: legacy._id,
                    projectId: legacy.projectId,
                    createdAt: legacy.createdAt ?? now,
                },
                $set: {
                    parent: redirectedParent,
                    name: legacy.name,
                    updatedAt: legacy.updatedAt ?? now,
                },
            }, { upsert: true });
            await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
            itemIdByLocation.set(locationKey, legacy._id);
            movedFolders += 1;
        }
        if (movedFolders > 0 || mergedFolders > 0 || removedAssetMirrors > 0) {
            this.logger.log(`Migrated asset-images tree from mv_subprojects: moved=${movedFolders}, merged=${mergedFolders}, removedAssetMirrors=${removedAssetMirrors}`);
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
        await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .createIndex({
            "metadata.projectId": 1,
            "metadata.scope": 1,
            "metadata.displayOrder": 1,
            "metadata.relativePath": 1,
            uploadDate: 1,
        })
            .catch(() => undefined);
        await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .createIndex({ "metadata.projectId": 1, "metadata.scope": 1, _id: 1 })
            .catch(() => undefined);
        await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .createIndex({
            "metadata.projectId": 1,
            "metadata.scope": 1,
            "metadata.picAssetId": 1,
            "metadata.displayOrder": 1,
        })
            .catch(() => undefined);
        await db
            .collection(collections_2.MV_FILES_FILES_COLLECTION)
            .createIndex({
            "metadata.projectId": 1,
            "metadata.scope": 1,
            "metadata.folderPath": 1,
            "metadata.displayOrder": 1,
        })
            .catch(() => undefined);
        await this.migratePhotoFolderAssetsRemoveSubProjectIdField(db);
        await photoAssets.createIndex({ projectId: 1, parent: 1 }).catch(() => undefined);
        await photoAssets.createIndex({ projectId: 1, isAssetFolder: 1 }).catch(() => undefined);
        await sp.createIndex({ projectId: 1 }).catch(() => undefined);
        await db.collection(collections_2.MV_SHEETS_COLLECTION).createIndex({ projectId: 1 }).catch(() => undefined);
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
                subAssetType: d.subAssetType ?? null,
                quantity: d.quantity ?? null,
                brand: d.brand ?? null,
                code: d.code ?? null,
                model: d.model ?? null,
                manufactureYear: d.manufactureYear ?? null,
                kilometersDriven: d.kilometersDriven ?? null,
                isPresent: d.isPresent !== false,
                createdBy: (0, object_id_util_1.tryCoerceToObjectId)(d.createdBy) ?? null,
                images: d.images ?? [],
                voiceNotes: d.voiceNotes ?? [],
                isDone: d.isDone === true,
            };
            const shell = buildPicAssetDocument(pad.projectId, pad.parent, pad.name, nowM, pad.createdBy);
            await photoAssets.insertOne({
                ...shell,
                writtenDescription: pad.writtenDescription,
                condition: pad.condition,
                assetType: pad.assetType,
                subAssetType: pad.subAssetType,
                quantity: pad.quantity,
                brand: pad.brand,
                code: pad.code,
                model: pad.model,
                manufactureYear: pad.manufactureYear,
                kilometersDriven: pad.kilometersDriven,
                isPresent: pad.isPresent,
                images: pad.images,
                voiceNotes: pad.voiceNotes,
                isDone: pad.isDone,
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
        await this.migratePhotosTreeSubProjectsToItems(db);
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
    inspectorAllowedFolderIds(mvList, itemList, picList) {
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
        return new Set(filterFolderEntriesForInspector(combined, DEFAULT_PHOTOS_SUBFOLDER_NAME).map((e) => e._id));
    }
    async assertInspectorAccessToFolderId(db, projectId, folderId, ctx) {
        if (ctx.userRole !== "inspector")
            return;
        const [mvList, itemList, picList] = await Promise.all([
            db
                .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                .find({ projectId })
                .toArray(),
            db
                .collection(collections_2.MV_ITEMS_COLLECTION)
                .find({ projectId })
                .toArray(),
            db
                .collection(collections_3.ASSETS_COLLECTION)
                .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
                .toArray(),
        ]);
        const allowed = this.inspectorAllowedFolderIds(mvList, itemList, picList);
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
    async upsertItemsFolders(db, projectId, names, parentId, newDocExtras) {
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
        const items = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const subProjects = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const existingItems = (await items.find(filter).toArray());
        const existingNames = new Set(existingItems.map((doc) => normalizeSubProjectName(doc.name)));
        const legacySubProjects = (await subProjects.find(filter).toArray());
        const movedLegacy = [];
        for (const legacy of legacySubProjects) {
            const normalized = normalizeSubProjectName(legacy.name);
            if (!normalized || existingNames.has(normalized))
                continue;
            const parent = getParentIdFromDoc(legacy);
            const docForItems = {
                _id: legacy._id,
                projectId: legacy.projectId,
                parent: parent ?? null,
                name: legacy.name,
                createdAt: legacy.createdAt,
                updatedAt: legacy.updatedAt,
                ...(newDocExtras ?? {}),
            };
            await items.updateOne({ _id: legacy._id, projectId }, { $setOnInsert: docForItems }, { upsert: true });
            await subProjects.deleteOne({ _id: legacy._id, projectId });
            movedLegacy.push(docForItems);
            existingNames.add(normalized);
        }
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
            const result = await items.insertMany(docs);
            toCreate.forEach((_, index) => {
                const doc = docs[index];
                const _id = result.insertedIds[index];
                created.push({ _id, ...doc });
            });
        }
        return { created, existing: [...existingItems, ...movedLegacy] };
    }
    async collectDescendantSubProjectIds(db, projectId, rootId) {
        const subs = await db
            .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
            .find({ projectId })
            .project({ _id: 1, parent: 1, parentSubProjectId: 1 })
            .toArray();
        const items = await db
            .collection(collections_2.MV_ITEMS_COLLECTION)
            .find({ projectId })
            .project({ _id: 1, parent: 1, parentSubProjectId: 1 })
            .toArray();
        const childrenByParent = new Map();
        for (const sub of [...subs, ...items]) {
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
    async assertPicAssetFolderCanReceiveImages(db, projectId, photosRootId, picFolder) {
        const parent = picFolder.parent;
        if (!parent) {
            throw new common_1.BadRequestException("مجلد الأصل يجب أن يكون داخل صور المعاينة.");
        }
        if (parent.equals(photosRootId))
            return;
        const parentIsNormalFolder = (await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
            _id: parent,
            projectId,
        })) ??
            (await db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({
                _id: parent,
                projectId,
            }));
        if (!parentIsNormalFolder) {
            throw new common_1.BadRequestException("مجلد الأصل يجب أن يكون تحت الجذر أو تحت مجلد عادي.");
        }
        const parentUnderPhotos = await this.isInPhotosHoldingSubtree(db, projectId, photosRootId, parent);
        if (!parentUnderPhotos) {
            throw new common_1.BadRequestException("مجلد الأصل يجب أن يكون داخل صور المعاينة.");
        }
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
    async ensureDisplayNumberForProject(db, project) {
        if (typeof project.displayNumber === "number" && Number.isFinite(project.displayNumber)) {
            return project.displayNumber;
        }
        const companyIdRaw = project.companyId;
        let companyOid = null;
        if (companyIdRaw instanceof mongodb_1.ObjectId) {
            companyOid = companyIdRaw;
        }
        else if (typeof companyIdRaw === "string" && companyIdRaw.trim()) {
            companyOid = (0, object_id_util_1.tryParseObjectId)(companyIdRaw.trim());
        }
        if (!companyOid)
            return null;
        try {
            const projectDoc = await db
                .collection(collections_2.MV_PROJECTS_COLLECTION)
                .findOne({ _id: project._id }, { projection: { createdAt: 1 } });
            const createdAt = projectDoc?.createdAt instanceof Date ? projectDoc.createdAt : new Date(0);
            const olderCount = await db
                .collection(collections_2.MV_PROJECTS_COLLECTION)
                .countDocuments({ companyId: companyOid, createdAt: { $lt: createdAt } });
            const next = olderCount + 1;
            await db
                .collection(collections_2.MV_PROJECTS_COLLECTION)
                .updateOne({ _id: project._id }, { $set: { displayNumber: next } });
            try {
                await (0, collections_1.getAuthCollections)(db).companies.updateOne({ _id: companyOid, $or: [{ projectSequenceCounter: { $exists: false } }, { projectSequenceCounter: { $lt: next } }] }, { $set: { projectSequenceCounter: next } });
            }
            catch {
            }
            return next;
        }
        catch (err) {
            this.logger.warn(`ensureDisplayNumberForProject failed: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    static fillMissingProjectDisplayNumbers(rows) {
        const byCompany = new Map();
        for (const row of rows) {
            const key = row.companyId ?? "__no_company__";
            const bucket = byCompany.get(key) ?? [];
            bucket.push(row);
            byCompany.set(key, bucket);
        }
        for (const bucket of byCompany.values()) {
            const taken = new Set(bucket
                .map((r) => r.displayNumber)
                .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0));
            const needsFill = bucket
                .filter((r) => r.displayNumber == null)
                .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            let next = 1;
            for (const r of needsFill) {
                while (taken.has(next))
                    next += 1;
                r.displayNumber = next;
                taken.add(next);
                next += 1;
            }
        }
        return rows;
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
            displayNumber: 1,
            createdAt: 1,
            updatedAt: 1,
            userId: 1,
            workflowStatus: 1,
            reportType: 1,
            reportData: {
                valuationMethod: 1,
                valuationPurpose: 1,
                valuePremise: 1,
                valuationBasis: 1,
                reportTitle: 1,
                reportIssueDate: 1,
                inspectionDate: 1,
                valuationDate: 1,
                inspectionLocation: 1,
                clientName: 1,
                finalValue: 1,
                reportTemplateId: 1,
            },
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
        const [counts, itemCounts, sheetAgg, picAssetAgg, valuationImageAgg, clientDocumentImageAgg] = await Promise.all([
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
            db
                .collection(collections_3.ASSETS_COLLECTION)
                .aggregate([
                { $match: { projectId: { $in: projectIds }, ...MV_PHOTO_FOLDER_FILTER } },
                {
                    $group: {
                        _id: "$projectId",
                        picAssetCount: { $sum: 1 },
                        imageCount: {
                            $sum: {
                                $cond: [
                                    { $gte: [{ $ifNull: ["$imageCount", -1] }, 0] },
                                    { $max: [0, { $floor: "$imageCount" }] },
                                    mongoPicAssetImagesCount("$images"),
                                ],
                            },
                        },
                    },
                },
            ])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: pic asset aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }),
            col
                .aggregate([
                { $match: { _id: { $in: projectIds } } },
                {
                    $project: {
                        _id: 1,
                        valuationAccountImageCount: mongoSafeArraySize("$valuationAccountingWorkspace.images"),
                    },
                },
            ])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: valuation image aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }),
            col
                .aggregate([
                { $match: { _id: { $in: projectIds } } },
                {
                    $project: {
                        _id: 1,
                        clientDocumentImageCount: mongoSafeArraySize("$clientDocumentsWorkspace.images"),
                    },
                },
            ])
                .toArray()
                .catch((err) => {
                this.logger.warn(`listProjects: client document image aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
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
        const picAssetMap = new Map(picAssetAgg
            .filter((c) => c._id != null)
            .map((c) => [
            c._id.toString(),
            {
                picAssetCount: toSafeNonNegativeInt(c.picAssetCount),
                imageCount: toSafeNonNegativeInt(c.imageCount),
            },
        ]));
        const valuationImageMap = new Map(valuationImageAgg
            .filter((row) => row._id != null)
            .map((row) => [row._id.toString(), toSafeNonNegativeInt(row.valuationAccountImageCount)]));
        const clientDocumentImageMap = new Map(clientDocumentImageAgg
            .filter((row) => row._id != null)
            .map((row) => [row._id.toString(), toSafeNonNegativeInt(row.clientDocumentImageCount)]));
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
        const rows = projects
            .map((p) => {
            const idStr = mvProjectIdString(p);
            if (!idStr) {
                this.logger.warn("listProjects: skipped project with missing/invalid _id");
                return null;
            }
            const reportDataSummary = pickReportDataProgressSummary(p.reportData);
            const assetImageCount = toSafeNonNegativeInt(picAssetMap.get(idStr)?.imageCount);
            const picAssetCount = toSafeNonNegativeInt(picAssetMap.get(idStr)?.picAssetCount);
            const valuationAccountImageCount = toSafeNonNegativeInt(valuationImageMap.get(idStr));
            const clientDocumentImageCount = toSafeNonNegativeInt(clientDocumentImageMap.get(idStr));
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
                displayNumber: typeof p.displayNumber === "number" && Number.isFinite(p.displayNumber)
                    ? p.displayNumber
                    : null,
                createdAt: mvProjectDateToIso(p.createdAt),
                updatedAt: mvProjectDateToIso(p.updatedAt),
                subProjectCount: toSafeNonNegativeInt(countMap.get(idStr)) + toSafeNonNegativeInt(itemMap.get(idStr)),
                sheetCount: toSafeNonNegativeInt(sheetMap.get(idStr)),
                assetImageCount,
                picAssetCount,
                valuationAccountImageCount,
                clientDocumentImageCount,
                progressPct: (0, mv_project_progress_util_1.computeMvProjectProgressPct)({
                    reportData: reportDataSummary,
                    assetImageCount,
                    valuationAccountImageCount,
                    clientDocumentImageCount,
                }),
                workflowStatus: projectWorkflowStatus(p),
                reportType: projectReportType(p),
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
        return MachineValuationService_1.fillMissingProjectDisplayNumbers(rows);
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
        let locations = sanitizeProjectLocations(locationsRaw);
        const contacts = mergeProjectContactsWithLocationPhones(contactsRaw, locations);
        locations = mergeProjectLocationsWithContacts(locations, contacts);
        const companiesCollection = (0, collections_1.getAuthCollections)(db).companies;
        let displayNumber;
        try {
            const seqDoc = await companiesCollection.findOneAndUpdate({ _id: resolvedCompanyId }, { $inc: { projectSequenceCounter: 1 }, $set: { updatedAt: now } }, { returnDocument: "after", projection: { projectSequenceCounter: 1 } });
            if (seqDoc) {
                const counter = typeof seqDoc.projectSequenceCounter === "number" && Number.isFinite(seqDoc.projectSequenceCounter)
                    ? seqDoc.projectSequenceCounter
                    : null;
                if (typeof counter === "number") {
                    if (counter === 1) {
                        const existing = await db
                            .collection(collections_2.MV_PROJECTS_COLLECTION)
                            .countDocuments({ companyId: resolvedCompanyId });
                        if (existing > 0) {
                            displayNumber = existing + 1;
                            await companiesCollection.updateOne({ _id: resolvedCompanyId }, { $set: { projectSequenceCounter: displayNumber } });
                        }
                        else {
                            displayNumber = 1;
                        }
                    }
                    else {
                        displayNumber = counter;
                    }
                }
            }
        }
        catch (err) {
            this.logger.warn(`createProject: project sequence reservation failed: ${err instanceof Error ? err.message : String(err)}`);
        }
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
            inspectionAssignments: [],
            inspectorFiles: [],
            ...(typeof displayNumber === "number" ? { displayNumber } : {}),
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
            displayNumber: displayNumber ?? null,
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
            inspectionAssignments: [],
            inspectorFiles: [],
        };
    }
    async duplicateProject(id, ctx, localeRaw) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const source = await this.loadProjectForAccess(db, _id, ctx);
        const locale = localeRaw === "en" ? "en" : "ar";
        const companyOid = source.companyId instanceof mongodb_1.ObjectId
            ? source.companyId
            : (0, object_id_util_1.tryParseObjectId)(source.companyId != null ? String(source.companyId) : "");
        const nameFilter = companyOid ? { companyId: companyOid } : {};
        const nameDocs = await db
            .collection(collections_2.MV_PROJECTS_COLLECTION)
            .find(nameFilter)
            .project({ name: 1 })
            .toArray();
        const existingNames = nameDocs.map((doc) => String(doc.name ?? ""));
        const newName = buildWindowsStyleCopyName(String(source.name ?? ""), existingNames, locale);
        const companyIdStr = companyOid?.toString() ?? null;
        const created = await this.createProject(newName, ctx, ctx.isSuperAdmin ? companyIdStr : undefined, projectReportType(source), [], []);
        const reportData = sanitizeReportData(source.reportData);
        const updated = await this.updateProject(created._id, ctx, { reportData });
        return {
            ok: true,
            project: updated.project,
        };
    }
    async cloneReportDataFromProject(targetId, sourceId, ctx) {
        const targetTrim = String(targetId ?? "").trim();
        const sourceTrim = String(sourceId ?? "").trim();
        if (!targetTrim || !sourceTrim) {
            throw new common_1.BadRequestException("sourceProjectId and target project id are required");
        }
        if (targetTrim === sourceTrim) {
            throw new common_1.BadRequestException("Cannot clone report data from the same project");
        }
        const db = await (0, mongodb_2.getMongoDb)();
        const sourceOid = toId(sourceTrim);
        const targetOid = toId(targetTrim);
        const projects = db.collection(collections_2.MV_PROJECTS_COLLECTION);
        const source = await projects.findOne({ _id: sourceOid }, { projection: { reportData: 1, companyId: 1, userId: 1 } });
        if (!source)
            throw new common_1.NotFoundException("Project not found");
        this.assertProjectInScope(source, ctx);
        const target = await projects.findOne({ _id: targetOid }, {
            projection: {
                name: 1,
                companyId: 1,
                userId: 1,
                displayNumber: 1,
                createdAt: 1,
                updatedAt: 1,
                workflowStatus: 1,
                reportType: 1,
                locations: 1,
                contacts: 1,
                inspectionAssignments: 1,
            },
        });
        if (!target)
            throw new common_1.NotFoundException("Project not found");
        this.assertProjectInScope(target, ctx);
        const reportData = sanitizeReportData(source.reportData);
        if (!hasMeaningfulSanitizedReportData(reportData)) {
            return { ok: false, empty: true, project: null };
        }
        const now = new Date();
        const updated = await projects.findOneAndUpdate({ _id: targetOid }, { $set: { reportData, updatedAt: now } }, {
            returnDocument: "after",
            projection: {
                name: 1,
                companyId: 1,
                userId: 1,
                displayNumber: 1,
                createdAt: 1,
                updatedAt: 1,
                workflowStatus: 1,
                reportType: 1,
                reportData: 1,
                locations: 1,
                contacts: 1,
                inspectionAssignments: 1,
            },
        });
        if (!updated)
            throw new common_1.NotFoundException("Project not found");
        const updatedDisplayNumber = await this.ensureDisplayNumberForProject(db, updated);
        return {
            ok: true,
            empty: false,
            project: {
                _id: updated._id.toString(),
                name: updated.name,
                companyId: updated.companyId instanceof mongodb_1.ObjectId
                    ? updated.companyId.toString()
                    : updated.companyId != null && String(updated.companyId).trim() !== ""
                        ? String(updated.companyId).trim()
                        : null,
                displayNumber: updatedDisplayNumber,
                createdAt: mvProjectDateToIso(updated.createdAt),
                updatedAt: mvProjectDateToIso(updated.updatedAt),
                workflowStatus: projectWorkflowStatus(updated),
                reportType: projectReportType(updated),
                reportData: sanitizeReportData(updated.reportData),
                locations: sanitizeProjectLocations(updated.locations, false),
                contacts: sanitizeProjectContacts(updated.contacts, false),
                inspectionAssignments: sanitizeInspectionAssignments(updated.inspectionAssignments, sanitizeProjectLocations(updated.locations, false)).map(serializeInspectionAssignment),
                createdByUserId: (0, object_id_util_1.tryCoerceToObjectId)(updated.userId)?.toString() ??
                    (typeof updated.userId === "string" ? updated.userId : null),
                createdByName: null,
                inspectorFiles: [],
                valuationAccountingWorkspace: null,
                valuationReadyExcelWorkspace: null,
                clientDocumentsWorkspace: null,
            },
        };
    }
    async updateProject(id, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const currentProject = await this.loadProjectForAccess(db, _id, ctx);
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
        let nextLocationsForContactMerge = null;
        if (b.locations !== undefined) {
            nextLocationsForContactMerge = sanitizeProjectLocations(b.locations);
        }
        let nextContactsForLocationMerge = null;
        if (b.contacts !== undefined) {
            nextContactsForLocationMerge = mergeProjectContactsWithLocationPhones(b.contacts, nextLocationsForContactMerge ?? []);
        }
        else if (nextLocationsForContactMerge?.some((location) => location.primaryPhone || location.secondaryPhone)) {
            nextContactsForLocationMerge = mergeProjectContactsWithLocationPhones([], nextLocationsForContactMerge);
        }
        if (nextLocationsForContactMerge) {
            $set.locations = nextContactsForLocationMerge
                ? mergeProjectLocationsWithContacts(nextLocationsForContactMerge, nextContactsForLocationMerge)
                : nextLocationsForContactMerge;
        }
        if (nextContactsForLocationMerge) {
            $set.contacts = nextContactsForLocationMerge;
        }
        if (b.inspectionAssignments !== undefined) {
            const assignmentLocations = nextLocationsForContactMerge ??
                sanitizeProjectLocations(currentProject.locations, false);
            $set.inspectionAssignments = sanitizeInspectionAssignments(b.inspectionAssignments, assignmentLocations, ctx.userId);
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
        if (b.clientDocumentsWorkspace !== undefined) {
            if (b.clientDocumentsWorkspace === null) {
                $set.clientDocumentsWorkspace = null;
            }
            else {
                $set.clientDocumentsWorkspace = sanitizeClientDocumentsWorkspaceForPersist(b.clientDocumentsWorkspace);
            }
        }
        if (Object.keys($set).length === 1) {
            throw new common_1.BadRequestException("No project fields to update");
        }
        const updated = await db.collection(collections_2.MV_PROJECTS_COLLECTION).findOneAndUpdate({ _id }, { $set }, { returnDocument: "after" });
        if (!updated)
            throw new common_1.NotFoundException("Project not found");
        const updatedDisplayNumber = await this.ensureDisplayNumberForProject(db, updated);
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
                displayNumber: updatedDisplayNumber,
                createdAt: mvProjectDateToIso(updated.createdAt),
                updatedAt: mvProjectDateToIso(updated.updatedAt),
                workflowStatus: projectWorkflowStatus(updated),
                reportType: projectReportType(updated),
                reportData: sanitizeReportData(updated.reportData),
                locations: sanitizeProjectLocations(updated.locations, false),
                contacts: sanitizeProjectContacts(updated.contacts, false),
                inspectionAssignments: sanitizeInspectionAssignments(updated.inspectionAssignments, sanitizeProjectLocations(updated.locations, false)).map(serializeInspectionAssignment),
                createdByUserId: (0, object_id_util_1.tryCoerceToObjectId)(updated.userId)?.toString() ??
                    (typeof updated.userId === "string" ? updated.userId : null),
                createdByName: null,
                inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(updated.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
                valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(updated.valuationAccountingWorkspace),
                valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(updated.valuationReadyExcelWorkspace),
                clientDocumentsWorkspace: sanitizeClientDocumentsWorkspaceForClient(updated.clientDocumentsWorkspace),
            },
            updatedAt: now.toISOString(),
        };
    }
    async getProject(id, ctx, opts) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(id);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const picAssetMode = opts?.picAssetMode === "summary"
            ? "summary"
            : opts?.picAssetMode === "report"
                ? "report"
                : "full";
        if (picAssetMode === "report") {
            const [creatorOid, assetImageAgg] = await Promise.all([
                Promise.resolve((0, object_id_util_1.tryCoerceToObjectId)(project.userId)),
                db
                    .collection(collections_3.ASSETS_COLLECTION)
                    .aggregate([
                    { $match: { projectId: _id, ...MV_PHOTO_FOLDER_FILTER } },
                    {
                        $group: {
                            _id: null,
                            imageCount: { $sum: mongoPicAssetImagesCount("$images") },
                        },
                    },
                ])
                    .toArray()
                    .catch(() => []),
            ]);
            const creator = creatorOid
                ? await (0, collections_1.getAuthCollections)(db).users.findOne({ _id: creatorOid }, { projection: { _id: 1, username: 1 } })
                : null;
            const ensuredDisplayNumber = await this.ensureDisplayNumberForProject(db, project);
            const valuationAccountImageCount = Array.isArray(project.valuationAccountingWorkspace?.images)
                ? project.valuationAccountingWorkspace.images.length
                : 0;
            const clientDocumentImageCount = Array.isArray(project.clientDocumentsWorkspace?.images)
                ? project.clientDocumentsWorkspace.images.length
                : 0;
            const assetImageCount = toSafeNonNegativeInt(assetImageAgg[0]?.imageCount);
            return {
                project: {
                    _id: project._id.toString(),
                    name: project.name,
                    companyId: project.companyId instanceof mongodb_1.ObjectId
                        ? project.companyId.toString()
                        : project.companyId != null && String(project.companyId).trim() !== ""
                            ? String(project.companyId).trim()
                            : null,
                    displayNumber: ensuredDisplayNumber,
                    createdAt: mvProjectDateToIso(project.createdAt),
                    updatedAt: mvProjectDateToIso(project.updatedAt),
                    workflowStatus: projectWorkflowStatus(project),
                    reportType: projectReportType(project),
                    reportData: sanitizeReportData(project.reportData),
                    locations: sanitizeProjectLocations(project.locations, false),
                    contacts: sanitizeProjectContacts(project.contacts, false),
                    inspectionAssignments: sanitizeInspectionAssignments(project.inspectionAssignments, sanitizeProjectLocations(project.locations, false)).map(serializeInspectionAssignment),
                    sheetCount: 0,
                    subProjectCount: 0,
                    assetImageCount,
                    valuationAccountImageCount,
                    clientDocumentImageCount,
                    createdByUserId: creatorOid?.toString() ??
                        (typeof project.userId === "string" ? project.userId : null),
                    createdByName: creator?.username ?? null,
                    inspectorFiles: [],
                    valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(project.valuationAccountingWorkspace),
                    valuationReadyExcelWorkspace: null,
                    clientDocumentsWorkspace: sanitizeClientDocumentsWorkspaceForClient(project.clientDocumentsWorkspace),
                },
                subProjects: [],
            };
        }
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
        const picRows = picAssetMode === "summary"
            ? (await db
                .collection(collections_3.ASSETS_COLLECTION)
                .aggregate([
                { $match: { projectId: _id, ...MV_PHOTO_FOLDER_FILTER } },
                {
                    $addFields: {
                        imageCount: mongoPicAssetImagesCount("$images"),
                        voiceNoteCount: mongoSafeArraySize("$voiceNotes"),
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
        const ensuredDisplayNumber = await this.ensureDisplayNumberForProject(db, project);
        return {
            project: {
                _id: project._id.toString(),
                name: project.name,
                companyId: project.companyId instanceof mongodb_1.ObjectId
                    ? project.companyId.toString()
                    : project.companyId != null && String(project.companyId).trim() !== ""
                        ? String(project.companyId).trim()
                        : null,
                displayNumber: ensuredDisplayNumber,
                createdAt: mvProjectDateToIso(project.createdAt),
                updatedAt: mvProjectDateToIso(project.updatedAt),
                workflowStatus: projectWorkflowStatus(project),
                reportType: projectReportType(project),
                reportData: sanitizeReportData(project.reportData),
                locations: sanitizeProjectLocations(project.locations, false),
                contacts: sanitizeProjectContacts(project.contacts, false),
                inspectionAssignments: sanitizeInspectionAssignments(project.inspectionAssignments, sanitizeProjectLocations(project.locations, false)).map(serializeInspectionAssignment),
                sheetCount,
                subProjectCount: merged.length,
                createdByUserId: creatorOid?.toString() ??
                    (typeof project.userId === "string" ? project.userId : null),
                createdByName: creator?.username ?? null,
                inspectorFiles: (0, inspector_files_util_1.normalizeInspectorFilesArray)(project.inspectorFiles).map(inspector_files_util_1.serializeInspectorFileForClient),
                valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(project.valuationAccountingWorkspace),
                valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(project.valuationReadyExcelWorkspace),
                clientDocumentsWorkspace: sanitizeClientDocumentsWorkspaceForClient(project.clientDocumentsWorkspace),
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
    async listProjectInspectors(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const companyObjectId = (0, object_id_util_1.tryCoerceToObjectId)(project.companyId) ??
            (ctx.companyId ? (0, object_id_util_1.tryParseObjectId)(ctx.companyId) : null);
        if (!companyObjectId) {
            return { inspectors: [] };
        }
        const { users, userCompanyMemberships } = (0, collections_1.getAuthCollections)(db);
        const memberLinks = await userCompanyMemberships.find({ companyId: companyObjectId }).toArray();
        const roleByUserId = new Map(memberLinks.map((m) => [m.userId.toString(), m.role]));
        const memberIds = memberLinks.map((m) => m.userId);
        if (memberIds.length === 0) {
            return { inspectors: [] };
        }
        const rows = await users
            .find({ _id: { $in: memberIds } })
            .sort({ username: 1 })
            .limit(500)
            .toArray();
        return {
            inspectors: rows
                .filter((u) => normalizeRoleName(roleByUserId.get(u._id.toString())) === "inspector" ||
                normalizeRoleName(u.role) === "inspector")
                .map((u) => ({
                id: u._id.toString(),
                username: String(u.username ?? ""),
                email: u.email ?? null,
                phone: u.phone ?? null,
            })),
        };
    }
    async listSystemInspectors(projectId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        await this.loadProjectForAccess(db, _id, ctx);
        const { users, userProfiles } = (0, collections_1.getAuthCollections)(db);
        const inspectorFilter = {
            $and: [
                {
                    $or: [
                        { role: { $in: ["inspector", "Inspector", "Freelance Inspector", "freelance inspector", "freelance_inspector", "freelance-inspector"] } },
                        { role: { $regex: "^freelance[\\s_-]*inspector$", $options: "i" } },
                    ],
                },
                {
                    $or: [
                        { company: null },
                        { company: "" },
                        { company: { $exists: false } },
                    ],
                },
                { isBlocked: { $ne: true } },
            ],
        };
        const rows = await users
            .find(inspectorFilter)
            .project({
            _id: 1,
            username: 1,
            name: 1,
            email: 1,
            phone: 1,
            role: 1,
            company: 1,
            serviceCities: 1,
            isBlocked: 1,
            isPhoneVerified: 1,
            lastLoginAt: 1,
            createdAt: 1,
        })
            .sort({ lastLoginAt: -1, createdAt: -1, username: 1 })
            .limit(500)
            .toArray();
        const userIds = rows.map((u) => u._id);
        const profiles = userIds.length > 0
            ? await userProfiles
                .find({ userId: { $in: userIds } })
                .project({ userId: 1, email: 1, phone: 1, additionalInfo: 1 })
                .toArray()
            : [];
        const profileByUserId = new Map(profiles.map((profile) => [profile.userId.toString(), profile]));
        return {
            inspectors: rows.filter((u) => isFreelanceInspectorRole(u.role)).map((u) => {
                const profile = profileByUserId.get(u._id.toString()) ?? null;
                const rawUser = u;
                const serviceCities = sanitizeStringList(rawUser.serviceCities, 80, 120);
                const profileCity = optionalProfileText(profile, ["city", "cityName"], 120);
                const displayName = sanitizeOptionalText(rawUser.name, 160) ||
                    optionalProfileText(profile, ["displayName", "fullName", "name", "inspectorName"], 160);
                return {
                    id: u._id.toString(),
                    username: String(u.username ?? ""),
                    displayName: displayName || null,
                    email: u.email ?? profile?.email ?? null,
                    phone: u.phone ?? profile?.phone ?? null,
                    city: profileCity ?? serviceCities[0] ?? null,
                    region: optionalProfileText(profile, ["region", "regionName"], 120),
                    serviceCities,
                    lastLoginAt: rawUser.lastLoginAt instanceof Date && !Number.isNaN(rawUser.lastLoginAt.getTime())
                        ? rawUser.lastLoginAt.toISOString()
                        : null,
                    isPhoneVerified: rawUser.isPhoneVerified === true,
                };
            }),
        };
    }
    async uploadInspectorFile(projectId, file, ctx, locationIdsRaw) {
        if (!file?.buffer?.length) {
            throw new common_1.BadRequestException("ملف فارغ أو مفقود.");
        }
        if (file.buffer.length > inspector_files_constants_1.MV_INSPECTOR_FILE_MAX_BYTES) {
            throw new common_1.BadRequestException(`حجم الملف يتجاوز الحد المسموح (${Math.round(inspector_files_constants_1.MV_INSPECTOR_FILE_MAX_BYTES / (1024 * 1024))} ميجابايت).`);
        }
        const decodedName = sanitizeUploadedFileName((0, sheet_rows_util_1.decodeUploadFilename)(file.originalname || "upload"));
        const db = await (0, mongodb_2.getMongoDb)();
        const _id = toId(projectId);
        const project = await this.loadProjectForAccess(db, _id, ctx);
        const locationIds = sanitizeLocationIdSelection(locationIdsRaw, sanitizeProjectLocations(project.locations, false));
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
            ...(locationIds.length > 0 ? { locationIds } : {}),
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
    async createSubProject(projectId, name, ctx, parentSubProjectId, options) {
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
        let parentIsPicAsset = false;
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
                    parentIsPicAsset = true;
                }
            }
            isPicUnderPhotos = await this.isInPhotosHoldingSubtree(db, pid, photosRoot._id, parentId);
        }
        if (parentIsPicAsset) {
            throw new common_1.BadRequestException("لا يمكن إنشاء مجلدات أو أصول داخل أصل. الأصل يحتوي صوراً فقط.");
        }
        if (isPicUnderPhotos && parentId && options?.kind === "folder") {
            const duplicateAsset = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                projectId: pid,
                parent: parentId,
                name: n,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (duplicateAsset) {
                throw new common_1.BadRequestException("يوجد أصل بنفس الاسم داخل هذا المكان.");
            }
            const { created, existing } = await this.upsertItemsFolders(db, pid, [n], parentId, undefined);
            const target = created[0] ?? existing[0];
            if (!target)
                throw new common_1.BadRequestException("تعذر إنشاء المجلد.");
            return {
                ...serializeMvSubProject(target, {
                    _id: target._id,
                    projectId: pid,
                }),
                picAsset: null,
            };
        }
        if (isPicUnderPhotos && parentId && options?.kind !== "folder") {
            const existingAsset = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                projectId: pid,
                parent: parentId,
                name: n,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (existingAsset) {
                const tCreated = existingAsset.createdAt ?? existingAsset.importedAt ?? existingAsset.updatedAt;
                return {
                    _id: existingAsset._id.toString(),
                    projectId: existingAsset.projectId.toString(),
                    parent: existingAsset.parent.toString(),
                    name: existingAsset.name ?? "",
                    createdAt: tCreated instanceof Date && !Number.isNaN(tCreated.getTime())
                        ? tCreated.toISOString()
                        : existingAsset.updatedAt.toISOString(),
                    updatedAt: existingAsset.updatedAt.toISOString(),
                    picAsset: serializePicAsset(existingAsset),
                };
            }
            const duplicateFolder = (await db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
                projectId: pid,
                name: n,
                $or: [{ parent: parentId }, { parentSubProjectId: parentId }],
            })) ??
                (await db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({
                    projectId: pid,
                    name: n,
                    $or: [{ parent: parentId }, { parentSubProjectId: parentId }],
                }));
            if (duplicateFolder) {
                throw new common_1.BadRequestException("يوجد مجلد بنفس الاسم داخل هذا المكان.");
            }
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
    async listSubProjectDetails(projectId, rawIds, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const ids = Array.from(new Set(rawIds))
            .filter((id) => mongodb_1.ObjectId.isValid(id))
            .slice(0, 50)
            .map((id) => new mongodb_1.ObjectId(id));
        if (ids.length === 0)
            return { items: [] };
        let subRows;
        let itemRows;
        let picOnlyRows;
        let inspectorPicSnapshot = null;
        if (ctx.userRole === "inspector") {
            const [allSubRows, allItemRows, allPicRows] = await Promise.all([
                db
                    .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                    .find({ projectId: pid })
                    .toArray(),
                db
                    .collection(collections_2.MV_ITEMS_COLLECTION)
                    .find({ projectId: pid })
                    .toArray(),
                db
                    .collection(collections_3.ASSETS_COLLECTION)
                    .find({ projectId: pid, ...MV_PHOTO_FOLDER_FILTER })
                    .toArray(),
            ]);
            const allowed = this.inspectorAllowedFolderIds(allSubRows, allItemRows, allPicRows);
            if (ids.some((sid) => !allowed.has(sid.toString()))) {
                throw new common_1.NotFoundException("Sub-project not found");
            }
            const requested = new Set(ids.map((sid) => sid.toString()));
            subRows = allSubRows.filter((row) => requested.has(row._id.toString()));
            itemRows = allItemRows.filter((row) => requested.has(row._id.toString()));
            picOnlyRows = allPicRows.filter((row) => requested.has(row._id.toString()));
            inspectorPicSnapshot = allPicRows;
        }
        else {
            [subRows, itemRows, picOnlyRows] = await Promise.all([
                db
                    .collection(collections_2.MV_SUBPROJECTS_COLLECTION)
                    .find({ projectId: pid, _id: { $in: ids } })
                    .toArray(),
                db
                    .collection(collections_2.MV_ITEMS_COLLECTION)
                    .find({ projectId: pid, _id: { $in: ids } })
                    .toArray(),
                db
                    .collection(collections_3.ASSETS_COLLECTION)
                    .find({ projectId: pid, _id: { $in: ids }, ...MV_PHOTO_FOLDER_FILTER })
                    .toArray(),
            ]);
        }
        const baseById = new Map();
        for (const row of itemRows)
            baseById.set(row._id.toString(), row);
        for (const row of subRows)
            baseById.set(row._id.toString(), row);
        const pairClauses = [];
        for (const row of baseById.values()) {
            const parent = getParentIdFromDoc(row);
            if (parent && row.name)
                pairClauses.push({ parent, name: row.name });
        }
        const pairKey = (parent, name) => `${String(parent ?? "")}\u0000${String(name ?? "")}`;
        const requestedPairKeys = new Set(Array.from(baseById.values()).map((row) => pairKey(getParentIdFromDoc(row), row.name)));
        const pairedPics = pairClauses.length > 0
            ? inspectorPicSnapshot
                ? inspectorPicSnapshot.filter((pic) => requestedPairKeys.has(pairKey(pic.parent, pic.name)))
                : await db
                    .collection(collections_3.ASSETS_COLLECTION)
                    .find({
                    projectId: pid,
                    ...MV_PHOTO_FOLDER_FILTER,
                    $or: pairClauses,
                })
                    .toArray()
            : [];
        const picByPair = new Map(pairedPics.map((pic) => [pairKey(pic.parent, pic.name), pic]));
        const picOnlyById = new Map(picOnlyRows.map((pic) => [pic._id.toString(), pic]));
        const items = [];
        for (const sid of ids) {
            const key = sid.toString();
            const base = baseById.get(key);
            if (base) {
                const parent = getParentIdFromDoc(base);
                const pic = parent ? picByPair.get(pairKey(parent, base.name)) ?? null : null;
                const fallback = { _id: sid, projectId: pid };
                items.push({
                    ...serializeMvSubProject(base, fallback),
                    picAsset: pic ? serializePicAsset(pic, fallback) : null,
                });
                continue;
            }
            const picOnly = picOnlyById.get(key);
            if (!picOnly)
                continue;
            const created = picOnly.createdAt ?? picOnly.importedAt ?? picOnly.updatedAt;
            items.push({
                _id: picOnly._id.toString(),
                projectId: picOnly.projectId?.toString?.() ?? pid.toString(),
                parent: picOnly.parent != null ? String(picOnly.parent) : "",
                name: picOnly.name ?? "",
                createdAt: created instanceof Date && !Number.isNaN(created.getTime())
                    ? created.toISOString()
                    : mvProjectDateToIso(picOnly.updatedAt),
                updatedAt: mvProjectDateToIso(picOnly.updatedAt),
                picAsset: serializePicAsset(picOnly, { _id: sid, projectId: pid }),
            });
        }
        return { items };
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
    async assertNoPhotoNodeNameConflict(db, projectId, parentId, name, excludeIds) {
        const exclude = excludeIds.length > 0 ? { $nin: excludeIds } : undefined;
        const idClause = exclude ? { _id: exclude } : {};
        const parentClause = {
            $or: [
                { parent: parentId },
                { parentSubProjectId: parentId },
            ],
        };
        const [item, sub, pic] = await Promise.all([
            db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({
                projectId,
                name,
                ...idClause,
                ...parentClause,
            }),
            db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({
                projectId,
                name,
                ...idClause,
                ...parentClause,
            }),
            db.collection(collections_3.ASSETS_COLLECTION).findOne({
                projectId,
                parent: parentId,
                name,
                ...idClause,
                ...MV_PHOTO_FOLDER_FILTER,
            }),
        ]);
        if (item || sub || pic) {
            throw new common_1.BadRequestException("يوجد مجلد أو أصل بنفس الاسم داخل هذا المكان.");
        }
    }
    async resolvePhotoNodeTargetParent(db, projectId, photosRootId, rawTarget) {
        if (rawTarget === undefined ||
            rawTarget === null ||
            String(rawTarget).trim() === "" ||
            String(rawTarget).trim() === "__pv_root__") {
            return photosRootId;
        }
        const target = toId(String(rawTarget).trim());
        if (target.equals(photosRootId))
            return target;
        const [targetItem, targetSub, targetPic] = await Promise.all([
            db.collection(collections_2.MV_ITEMS_COLLECTION).findOne({ _id: target, projectId }),
            db.collection(collections_2.MV_SUBPROJECTS_COLLECTION).findOne({ _id: target, projectId }),
            db.collection(collections_3.ASSETS_COLLECTION).findOne({
                _id: target,
                projectId,
                ...MV_PHOTO_FOLDER_FILTER,
            }),
        ]);
        if (targetPic) {
            throw new common_1.BadRequestException("لا يمكن نقل مجلد أو أصل داخل أصل آخر. اختر الجذر أو مجلداً عادياً.");
        }
        if (!targetItem && !targetSub) {
            throw new common_1.NotFoundException("Target folder not found");
        }
        const underPhotos = await this.isInPhotosHoldingSubtree(db, projectId, photosRootId, target);
        if (!underPhotos) {
            throw new common_1.BadRequestException("المكان المستهدف يجب أن يكون داخل صور الأصول.");
        }
        return target;
    }
    async refreshPicAssetFileFolderMetadata(db, projectId, picAssetId, folderName) {
        const col = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const files = await col
            .find({
            "metadata.projectId": projectId,
            "metadata.scope": "asset-images",
            "metadata.picAssetId": picAssetId,
        })
            .sort({ "metadata.displayOrder": 1, uploadDate: 1, _id: 1 })
            .toArray();
        if (files.length === 0)
            return;
        const now = new Date();
        const folderPathNorm = normalizeMvAssetFolderPath(folderName || "asset");
        for (const file of files) {
            const rawPath = String(file.metadata?.relativePath ||
                file.metadata?.originalFileName ||
                file.filename ||
                "image").replace(/\\/g, "/");
            const preferredBasename = sanitizeUploadedFileName(rawPath.split("/").pop() || "image");
            const unique = await this.uniqueRelativePathForAssetImageFolder(db, projectId, file._id, {
                folderPathNorm,
                preferredBasename,
            });
            await col.updateOne({ _id: file._id, "metadata.projectId": projectId, "metadata.scope": "asset-images" }, {
                $set: {
                    "metadata.relativePath": unique.relativePath,
                    "metadata.folderPath": unique.folderPath,
                    "metadata.updatedAt": now,
                },
            });
        }
    }
    async patchPhotoNodeMeta(projectId, subId, ctx, body) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const sid = toId(subId);
        await this.loadProjectForAccess(db, pid, ctx);
        if (ctx.userRole === "inspector") {
            await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
        }
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        if (sid.equals(photosRoot._id)) {
            throw new common_1.BadRequestException("لا يمكن تعديل مجلد صور الأصول الرئيسي.");
        }
        const sp = db.collection(collections_2.MV_SUBPROJECTS_COLLECTION);
        const it = db.collection(collections_2.MV_ITEMS_COLLECTION);
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const pic = (await pa.findOne({
            _id: sid,
            projectId: pid,
            ...MV_PHOTO_FOLDER_FILTER,
        }));
        const item = pic ? null : await it.findOne({ _id: sid, projectId: pid });
        const sub = pic || item ? null : await sp.findOne({ _id: sid, projectId: pid });
        const node = pic ?? item ?? sub;
        if (!node)
            throw new common_1.NotFoundException("Sub-project not found");
        const hasName = Object.prototype.hasOwnProperty.call(body, "name");
        const hasParent = Object.prototype.hasOwnProperty.call(body, "targetParentId") ||
            Object.prototype.hasOwnProperty.call(body, "parent") ||
            Object.prototype.hasOwnProperty.call(body, "parentSubProjectId");
        if (!hasName && !hasParent) {
            return this.getSubProject(projectId, subId, ctx);
        }
        const currentParent = pic
            ? (pic.parent ?? null)
            : getParentIdFromDoc(node) ?? null;
        if (!currentParent) {
            throw new common_1.BadRequestException("لا يمكن نقل هذا العنصر من جذر المشروع. استخدم عناصر صور الأصول فقط.");
        }
        const sourceUnderPhotos = currentParent.equals(photosRoot._id)
            ? true
            : await this.isInPhotosHoldingSubtree(db, pid, photosRoot._id, sid);
        if (!sourceUnderPhotos) {
            throw new common_1.BadRequestException("هذا العنصر ليس داخل صور الأصول.");
        }
        const nextName = hasName ? normalizeSubProjectName(String(body.name ?? "")) : normalizeSubProjectName(node.name);
        if (!nextName)
            throw new common_1.BadRequestException("اسم المجلد أو الأصل مطلوب.");
        const rawParent = Object.prototype.hasOwnProperty.call(body, "targetParentId")
            ? body.targetParentId
            : Object.prototype.hasOwnProperty.call(body, "parent")
                ? body.parent
                : body.parentSubProjectId;
        const nextParent = hasParent
            ? await this.resolvePhotoNodeTargetParent(db, pid, photosRoot._id, rawParent)
            : currentParent;
        if (nextParent.equals(sid)) {
            throw new common_1.BadRequestException("لا يمكن نقل العنصر داخل نفسه.");
        }
        if (!pic) {
            const descendants = await this.collectDescendantSubProjectIds(db, pid, sid);
            if (descendants.some((id) => id.equals(nextParent))) {
                throw new common_1.BadRequestException("لا يمكن نقل مجلد داخل أحد مجلداته الفرعية.");
            }
        }
        if (ctx.userRole === "inspector") {
            await this.assertInspectorAccessToFolderId(db, pid, nextParent, ctx);
        }
        const tiedPic = !pic && currentParent
            ? (await pa.findOne({
                projectId: pid,
                parent: currentParent,
                name: node.name,
                ...MV_PHOTO_FOLDER_FILTER,
            }))
            : null;
        const excludeIds = [sid];
        if (tiedPic?._id)
            excludeIds.push(tiedPic._id);
        await this.assertNoPhotoNodeNameConflict(db, pid, nextParent, nextName, excludeIds);
        const now = new Date();
        if (pic) {
            const updated = (await pa.findOneAndUpdate({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, { $set: { name: nextName, parent: nextParent, updatedAt: now } }, { returnDocument: "after" }));
            if (!updated)
                throw new common_1.NotFoundException("Sub-project not found");
            if (hasName) {
                await this.refreshPicAssetFileFolderMetadata(db, pid, sid, nextName);
            }
        }
        else if (item) {
            await it.updateOne({ _id: sid, projectId: pid }, {
                $set: { name: nextName, parent: nextParent, updatedAt: now },
                $unset: { parentSubProjectId: "" },
            });
        }
        else {
            await sp.updateOne({ _id: sid, projectId: pid }, {
                $set: { name: nextName, parent: nextParent, updatedAt: now },
                $unset: { parentSubProjectId: "" },
            });
        }
        if (tiedPic?._id) {
            await pa.updateOne({ _id: tiedPic._id, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, { $set: { name: nextName, parent: nextParent, updatedAt: now } });
            if (hasName) {
                await this.refreshPicAssetFileFolderMetadata(db, pid, tiedPic._id, nextName);
            }
        }
        return this.getSubProject(projectId, subId, ctx);
    }
    async patchSubProject(projectId, subId, ctx, body) {
        const hasNodePatch = !!body &&
            (Object.prototype.hasOwnProperty.call(body, "name") ||
                Object.prototype.hasOwnProperty.call(body, "parent") ||
                Object.prototype.hasOwnProperty.call(body, "parentSubProjectId") ||
                Object.prototype.hasOwnProperty.call(body, "targetParentId"));
        const hasPicPatch = !!body &&
            [
                "writtenDescription",
                "condition",
                "notes",
                "assetType",
                "subAssetType",
                "quantity",
                "brand",
                "code",
                "model",
                "manufactureYear",
                "kilometersDriven",
                "isPresent",
                "isDone",
                "images",
                "voiceNotes",
            ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
        if (hasNodePatch && !hasPicPatch) {
            return this.patchPhotoNodeMeta(projectId, subId, ctx, body);
        }
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
        if (b.notes !== undefined) {
            if (b.notes !== null && typeof b.notes !== "string") {
                throw new common_1.BadRequestException("notes must be a string or null");
            }
            const notesText = b.notes === null ? "" : b.notes.trim();
            $set.notes = notesText;
            $set["rawData.notes"] = notesText;
            $set["normalizedData.notes"] = notesText;
            $set.hasNotes = notesText.length > 0;
        }
        if (b.assetType !== undefined) {
            if (typeof b.assetType !== "string" || !ASSET_TYPE_SET.has(b.assetType)) {
                throw new common_1.BadRequestException("Invalid assetType");
            }
            $set.assetType = b.assetType;
        }
        if (b.subAssetType !== undefined) {
            if (b.subAssetType !== null && typeof b.subAssetType !== "string") {
                throw new common_1.BadRequestException("subAssetType must be a string or null");
            }
            const subText = b.subAssetType === null ? "" : b.subAssetType.trim();
            $set.subAssetType = subText || null;
            $set["rawData.subAssetType"] = subText;
            $set["normalizedData.subAssetType"] = subText;
        }
        if (b.quantity !== undefined) {
            if (b.quantity !== null && typeof b.quantity !== "string" && typeof b.quantity !== "number") {
                throw new common_1.BadRequestException("quantity must be a number, string, or null");
            }
            const q = coerceNumberishField(b.quantity);
            $set.quantity = q;
            $set["rawData.quantity"] = q;
            $set["normalizedData.quantity"] = q;
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
        if (b.images !== undefined) {
            await syncGridFsIncludeInReportFromPicImages(db, pid, picId, nextPic.images);
        }
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
        if (!picNode) {
            return { ok: true, alreadyGone: true };
        }
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
        const sheetFolderName = normalizeSubProjectName(sheetName) || "Sheet";
        const { created: createdSheetFolders, existing: existingSheetFolders } = await this.upsertItemsFolders(db, pid, [sheetFolderName], photosRoot._id, undefined);
        const sheetFolder = createdSheetFolders[0] ?? existingSheetFolders[0];
        if (!sheetFolder) {
            throw new common_1.BadRequestException("تعذر إنشاء مجلد رئيسي للشيت.");
        }
        const sheetFolderId = sheetFolder._id;
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
            const currentParentIsSheet = doc.parent?.equals(sheetFolderId) === true;
            const currentParentIsLegacyRoot = doc.parent?.equals(photosRoot._id) === true;
            if (doc.isAssetFolder === true && normDocName === normFolder && (currentParentIsSheet || currentParentIsLegacyRoot)) {
                if (currentParentIsSheet) {
                    unchangedRows += 1;
                    continue;
                }
                bulkOps.push({
                    updateOne: {
                        filter: { _id: doc._id, projectId: pid },
                        update: { $set: { parent: sheetFolderId, updatedAt: now } },
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
                            parent: sheetFolderId,
                            updatedAt: now,
                            isPresent: true,
                            isDone: false,
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
                $or: [{ parent: photosRoot._id }, { parent: sheetFolderId }],
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
            parent: sheetFolderId,
            name: { $in: queryNames },
            ...MV_PHOTO_FOLDER_FILTER,
        })
            .toArray();
        return {
            photosFolderId: photosRoot._id.toString(),
            parentFolderId: sheetFolderId.toString(),
            parentFolderName: sheetFolder.name,
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
    async listProjectAssetImageFiles(projectId, ctx, page) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        if (page == null)
            await runAssetImageBackfill(db, pid);
        const collection = db.collection(collections_2.MV_FILES_FILES_COLLECTION);
        const filter = {
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
        };
        if (page && page !== "skip-backfill") {
            const limit = Number.isFinite(page.limit)
                ? Math.min(250, Math.max(20, Math.trunc(page.limit)))
                : 100;
            const cursorText = String(page.cursor ?? "0").trim();
            if (!/^\d{1,7}$/.test(cursorText)) {
                throw new common_1.BadRequestException("cursor غير صالح.");
            }
            const offset = Number(cursorText);
            const dedupeStage = { $set: { __mvDedupeKey: assetImageDedupeKeyMongoExpr() } };
            const [files, total] = await Promise.all([
                collection
                    .aggregate([
                    { $match: filter },
                    dedupeStage,
                    { $sort: { uploadDate: 1, _id: 1 } },
                    { $group: { _id: "$__mvDedupeKey", doc: { $first: "$$ROOT" } } },
                    { $replaceRoot: { newRoot: "$doc" } },
                    {
                        $set: {
                            __mvOrderMissing: {
                                $cond: [{ $isNumber: "$metadata.displayOrder" }, 0, 1],
                            },
                            __mvPath: {
                                $ifNull: ["$metadata.relativePath", { $ifNull: ["$filename", ""] }],
                            },
                        },
                    },
                    {
                        $sort: {
                            __mvOrderMissing: 1,
                            "metadata.displayOrder": 1,
                            __mvPath: 1,
                            uploadDate: 1,
                            _id: 1,
                        },
                    },
                    { $skip: offset },
                    { $limit: limit },
                ], { allowDiskUse: true })
                    .toArray(),
                collection
                    .aggregate([
                    { $match: filter },
                    dedupeStage,
                    { $group: { _id: "$__mvDedupeKey" } },
                    { $count: "total" },
                ], { allowDiskUse: true })
                    .toArray()
                    .then((rows) => rows[0]?.total ?? 0),
            ]);
            const nextOffset = offset + files.length;
            const hasMore = nextOffset < total;
            return {
                items: files.map((file) => mapStoredFileDoc(file)),
                nextCursor: hasMore ? String(nextOffset) : null,
                hasMore,
                total,
            };
        }
        const files = dedupeAssetImageFileDocs(await collection.find(filter).toArray());
        files.sort(compareAssetImageGridDocs);
        return files.map((file) => mapStoredFileDoc(file));
    }
    async getProjectAssetImagesZip(projectId, ctx, requestedDownloadId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        const project = await this.loadProjectForAccess(db, pid, ctx);
        const downloadId = typeof requestedDownloadId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(requestedDownloadId)
            ? requestedDownloadId
            : undefined;
        if (downloadId) {
            this.trimAssetImagesDownloadJobs();
            this.assetImagesDownloadJobs.set(downloadId, {
                id: downloadId,
                projectId: pid.toString(),
                phase: "preparing",
                folderTotal: 0,
                foldersCompleted: 0,
                imageTotal: 0,
                imagesCompleted: 0,
                bytesTotal: 0,
                bytesProcessed: 0,
                percent: 1,
                currentFileName: null,
                error: null,
                updatedAt: Date.now(),
            });
        }
        await runAssetImageBackfill(db, pid, { force: true });
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        const [itemFolders, picFolders, assetFiles] = await Promise.all([
            db
                .collection(collections_2.MV_ITEMS_COLLECTION)
                .find({ projectId: pid })
                .toArray(),
            db
                .collection(collections_3.ASSETS_COLLECTION)
                .find({ projectId: pid, ...MV_PHOTO_FOLDER_FILTER })
                .toArray(),
            db
                .collection(collections_2.MV_FILES_FILES_COLLECTION)
                .find({
                "metadata.projectId": pid,
                "metadata.scope": "asset-images",
            })
                .toArray(),
        ]);
        const dedupedAssetFiles = dedupeAssetImageFileDocs(assetFiles);
        const itemById = new Map(itemFolders.map((item) => [item._id.toString(), item]));
        const picById = new Map(picFolders.map((pic) => [pic._id.toString(), pic]));
        const itemPathCache = new Map();
        const picPathCache = new Map();
        const rootId = photosRoot._id.toString();
        const uniqueItemNameById = new Map();
        const uniquePicNameById = new Map();
        const assignUniqueSiblingNames = (rows, fallback, target) => {
            const byParent = new Map();
            for (const row of rows) {
                const parentKey = row.parent?.toString?.() ?? "__root__";
                const group = byParent.get(parentKey) ?? [];
                group.push(row);
                byParent.set(parentKey, group);
            }
            for (const group of byParent.values()) {
                const usedNames = new Set();
                group
                    .slice()
                    .sort((a, b) => {
                    const an = sanitizeZipPathPart(a.name, fallback);
                    const bn = sanitizeZipPathPart(b.name, fallback);
                    const nameCmp = an.localeCompare(bn, "ar", { numeric: true, sensitivity: "base" });
                    if (nameCmp !== 0)
                        return nameCmp;
                    const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
                    const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
                    if (at !== bt)
                        return at - bt;
                    return a._id.toString().localeCompare(b._id.toString());
                })
                    .forEach((row) => {
                    const base = sanitizeZipPathPart(row.name, fallback);
                    target.set(row._id.toString(), uniqueZipChildName(base, usedNames));
                });
            }
        };
        assignUniqueSiblingNames(itemFolders, "مجلد", uniqueItemNameById);
        assignUniqueSiblingNames(picFolders, "أصل", uniquePicNameById);
        const itemPath = (id, seen = new Set()) => {
            const key = typeof id === "string" ? id : id?.toString();
            if (!key)
                return null;
            if (key === rootId)
                return [];
            if (itemPathCache.has(key))
                return itemPathCache.get(key) ?? null;
            if (seen.has(key))
                return null;
            seen.add(key);
            const item = itemById.get(key);
            if (!item)
                return null;
            const parent = item.parent ? itemPath(item.parent, seen) : null;
            if (!parent) {
                itemPathCache.set(key, null);
                return null;
            }
            const out = [...parent, uniqueItemNameById.get(key) ?? sanitizeZipPathPart(item.name, "مجلد")];
            itemPathCache.set(key, out);
            return out;
        };
        const picPath = (id, seen = new Set()) => {
            const key = typeof id === "string" ? id : id?.toString();
            if (!key)
                return null;
            if (picPathCache.has(key))
                return picPathCache.get(key) ?? null;
            if (seen.has(key))
                return null;
            seen.add(key);
            const pic = picById.get(key);
            if (!pic)
                return null;
            const parentSegments = itemPath(pic.parent, new Set(seen));
            if (!parentSegments) {
                picPathCache.set(key, null);
                return null;
            }
            const out = [...parentSegments, uniquePicNameById.get(key) ?? sanitizeZipPathPart(pic.name, "أصل")];
            picPathCache.set(key, out);
            return out;
        };
        const rootFolderName = "صور الأصول";
        const directoryPaths = new Set([rootFolderName]);
        for (const item of itemFolders) {
            const path = itemPath(item._id);
            if (path && path.length > 0)
                directoryPaths.add(joinZipPath([rootFolderName, ...path]));
        }
        for (const pic of picFolders) {
            const path = picPath(pic._id);
            if (path && path.length > 0)
                directoryPaths.add(joinZipPath([rootFolderName, ...path]));
        }
        const imageFiles = dedupedAssetFiles
            .filter((file) => isLikelyImageUpload(file.metadata?.originalFileName || file.filename || "file", file.metadata?.mimeType))
            .sort(compareAssetImageGridDocs);
        const zipFileName = sanitizeZipFileName(`${rootFolderName}-${project.name || projectId}.zip`, "asset-images.zip");
        const sortedDirectoryPaths = [...directoryPaths].sort((a, b) => a.localeCompare(b, "ar", { numeric: true }));
        const bytesTotal = imageFiles.reduce((sum, file) => sum + Math.max(0, file.length ?? 0), 0);
        this.updateAssetImagesDownloadJob(downloadId, {
            folderTotal: sortedDirectoryPaths.length,
            imageTotal: imageFiles.length,
            bytesTotal,
            phase: "folders",
            percent: 3,
        });
        const out = new node_stream_1.PassThrough({ highWaterMark: 1024 * 1024 });
        const archive = new zip_stream_1.default({ forceZip64: true, store: true });
        archive.pipe(out);
        out.on("close", () => {
            if (!out.writableEnded) {
                archive.destroy();
                const currentJob = downloadId ? this.assetImagesDownloadJobs.get(downloadId) : undefined;
                if (currentJob?.phase !== "failed") {
                    this.updateAssetImagesDownloadJob(downloadId, {
                        phase: "failed",
                        currentFileName: null,
                        error: "تم إلغاء التنزيل أو انقطع الاتصال.",
                    });
                }
            }
        });
        void (async () => {
            const usedZipPaths = new Set();
            let foldersCompleted = 0;
            let imagesCompleted = 0;
            let bytesProcessed = 0;
            try {
                for (const dir of sortedDirectoryPaths) {
                    const normalized = uniqueZipPath(`${dir.replace(/\/+$/, "")}/`, usedZipPaths);
                    await addZipStreamEntry(archive, null, {
                        name: normalized,
                        type: "directory",
                        date: new Date(),
                    });
                    foldersCompleted += 1;
                    this.updateAssetImagesDownloadJob(downloadId, {
                        foldersCompleted,
                        percent: Math.min(10, 3 + Math.round((foldersCompleted / Math.max(1, sortedDirectoryPaths.length)) * 7)),
                    });
                }
                this.updateAssetImagesDownloadJob(downloadId, { phase: "images", percent: 10 });
                for (const file of imageFiles) {
                    const meta = file.metadata;
                    const rawName = meta?.originalFileName ||
                        file.filename ||
                        String(meta?.relativePath ?? "").split(/[\\/]/).filter(Boolean).pop() ||
                        "image";
                    const fileName = sanitizeZipFileName(rawName, "image");
                    const picId = meta?.picAssetId?.toString?.();
                    const picSegments = picId ? picPath(picId) : null;
                    let zipPath;
                    if (picSegments && picSegments.length > 0) {
                        zipPath = joinZipPath([rootFolderName, ...picSegments, fileName]);
                    }
                    else {
                        const relative = sanitizeUploadedRelativePath(meta?.relativePath || rawName, fileName);
                        const parts = relative
                            .split("/")
                            .filter(Boolean)
                            .map((part, index, arr) => index === arr.length - 1
                            ? sanitizeZipFileName(part, fileName)
                            : sanitizeZipPathPart(part, "مجلد"));
                        if (parts[0] === rootFolderName)
                            parts.shift();
                        zipPath = joinZipPath([rootFolderName, ...parts]);
                    }
                    const stream = await this.openStoredProjectFileStream(db, file);
                    const meter = new node_stream_1.PassThrough({ highWaterMark: 1024 * 1024 });
                    stream.on("error", (error) => meter.destroy(error));
                    meter.on("data", (chunk) => {
                        bytesProcessed += chunk.length;
                        const ratio = bytesTotal > 0
                            ? bytesProcessed / bytesTotal
                            : imagesCompleted / Math.max(1, imageFiles.length);
                        this.updateAssetImagesDownloadJob(downloadId, {
                            bytesProcessed,
                            percent: Math.min(98, 10 + Math.round(Math.min(1, ratio) * 88)),
                        });
                    });
                    stream.pipe(meter);
                    this.updateAssetImagesDownloadJob(downloadId, { currentFileName: fileName });
                    await addZipStreamEntry(archive, meter, {
                        name: uniqueZipPath(zipPath, usedZipPaths),
                        type: "file",
                        date: meta?.updatedAt instanceof Date ? meta.updatedAt : file.uploadDate,
                    });
                    imagesCompleted += 1;
                    this.updateAssetImagesDownloadJob(downloadId, { imagesCompleted });
                }
                this.updateAssetImagesDownloadJob(downloadId, {
                    phase: "finalizing",
                    currentFileName: null,
                    percent: 99,
                });
                archive.once("end", () => {
                    this.updateAssetImagesDownloadJob(downloadId, {
                        phase: "completed",
                        foldersCompleted: sortedDirectoryPaths.length,
                        imagesCompleted: imageFiles.length,
                        bytesProcessed: bytesTotal,
                        currentFileName: null,
                        percent: 100,
                    });
                });
                archive.finalize();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.error(`Asset images ZIP failed: ${message}`);
                this.updateAssetImagesDownloadJob(downloadId, {
                    phase: "failed",
                    currentFileName: null,
                    error: message,
                });
                archive.destroy(error instanceof Error ? error : new Error(message));
                out.destroy(error instanceof Error ? error : new Error(message));
            }
        })();
        return {
            stream: out,
            fileName: zipFileName,
            imageCount: imageFiles.length,
            folderCount: sortedDirectoryPaths.length,
            downloadId,
        };
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
        return this.listProjectAssetImageFiles(projectId, ctx, "skip-backfill");
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
        const siblingDocsForFolder = async (folderNorm, picOid) => col
            .find({
            "metadata.projectId": pid,
            "metadata.scope": "asset-images",
            ...picAssetScopeFilter(picOid),
            ...assetImageFolderMongoFilter(folderNorm),
            _id: { $ne: oidMoving },
        })
            .toArray();
        if (targetPicOid) {
            const picFolder = await db.collection(collections_3.ASSETS_COLLECTION).findOne({
                _id: targetPicOid,
                projectId: pid,
                ...MV_PHOTO_FOLDER_FILTER,
            });
            if (!picFolder) {
                throw new common_1.BadRequestException("Target asset folder not found.");
            }
            const photosRoot = await this.ensurePhotosRootFolder(db, pid);
            await this.assertPicAssetFolderCanReceiveImages(db, pid, photosRoot._id, picFolder);
        }
        if (targetPicOid) {
            if (!this.inspectorSpaces.isReady()) {
                throw new common_1.BadRequestException("DigitalOcean Spaces غير مهيأ لرفع صور الأصول.");
            }
            const existingSpacesKey = moveDoc.metadata?.storage === "digitalocean" ? moveDoc.metadata.spacesKey?.trim() : "";
            let imageUrl;
            let imageKey;
            if (existingSpacesKey) {
                imageUrl = this.inspectorSpaces.publicUrlForKey(existingSpacesKey);
                imageKey = existingSpacesKey;
            }
            else {
                const bucket = this.getFilesBucket(db);
                const chunks = [];
                for await (const chunk of bucket.openDownloadStream(oidMoving)) {
                    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                }
                const data = Buffer.concat(chunks);
                const imageId = new mongodb_1.ObjectId();
                let uploaded;
                try {
                    uploaded = await this.inspectorSpaces.uploadAssetImage({
                        projectId,
                        assetId: targetPicOid.toString(),
                        imageId: imageId.toString(),
                        fileName: oldBasename,
                        buffer: data,
                        contentType: moveDoc.metadata?.mimeType || "application/octet-stream",
                    });
                }
                catch (err) {
                    this.logger.error(`placeProjectAssetImageFile Spaces: ${err instanceof Error ? err.message : String(err)}`);
                    throw new common_1.BadRequestException("فشل رفع صورة الأصل إلى DigitalOcean Spaces.");
                }
                imageUrl = uploaded.url;
                imageKey = uploaded.key;
            }
            const now = new Date();
            const imageDoc = {
                _id: new mongodb_1.ObjectId(),
                url: imageUrl,
                publicId: imageKey,
                createdAt: now,
                mediaType: "image",
                mimeType: moveDoc.metadata?.mimeType || "application/octet-stream",
                includeInReport: moveDoc.metadata?.includeInReport !== false,
            };
            await db.collection(collections_3.ASSETS_COLLECTION).updateOne({ _id: targetPicOid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, buildAppendPicAssetImageUpdate(null, imageDoc, now));
            if (existingSpacesKey) {
                await col.deleteOne({ _id: oidMoving });
            }
            else {
                await this.getFilesBucket(db).delete(oidMoving);
            }
            if (sourcePicOid) {
                const restSource = (await siblingDocsForFolder(sourceFolderNormalized, sourcePicOid)).sort(compareAssetImageGridDocs);
                await Promise.all(restSource.map((d, i) => col.updateOne({ _id: d._id }, {
                    $set: {
                        "metadata.displayOrder": i,
                        "metadata.folderPath": sourceFolderNormalized,
                        "metadata.updatedAt": now,
                    },
                })));
            }
            return this.listProjectAssetImageFiles(projectId, ctx, "skip-backfill");
        }
        let insertBeforeOid = null;
        if (insertBeforeTrim) {
            insertBeforeOid = (0, object_id_util_1.tryParseObjectId)(insertBeforeTrim);
            if (!insertBeforeOid) {
                throw new common_1.BadRequestException("معرف موضع الإدراج غير صالح.");
            }
            if (insertBeforeOid.equals(oidMoving)) {
                return this.listProjectAssetImageFiles(projectId, ctx, "skip-backfill");
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
            if (anchorPicOid) {
                throw new common_1.BadRequestException("موضع الإدراج لا ينتمي لنفس مجلد صور الأصول.");
            }
        }
        const siblingsSorted = (await siblingDocsForFolder(targetFolderNormalized, null)).sort(compareAssetImageGridDocs);
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
            const setMeta = {
                "metadata.relativePath": uniq.relativePath,
                "metadata.folderPath": uniq.folderPath,
                "metadata.updatedAt": now,
            };
            const unsetMeta = {};
            if (sourcePicOid) {
                unsetMeta["metadata.picAssetId"] = "";
            }
            const updatePayload = { $set: setMeta };
            if (Object.keys(unsetMeta).length > 0)
                updatePayload.$unset = unsetMeta;
            await col.updateOne({ _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" }, updatePayload);
        }
        if (!crossFolderMove && sourcePicOid) {
            await col.updateOne({ _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" }, { $set: { "metadata.updatedAt": now }, $unset: { "metadata.picAssetId": "" } });
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
        return this.listProjectAssetImageFiles(projectId, ctx, "skip-backfill");
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
        if (result.matchedCount === 0 && ids.length > 0) {
            this.logger.warn(`updateProjectAssetImageReportSelection: no GridFS matches for ${ids.length} id(s) in project ${projectId}`);
        }
        try {
            await syncPicImagesIncludeInReportFromGridFsIds(db, pid, ids, includeInReport);
        }
        catch (err) {
            this.logger.warn(`syncPicImagesIncludeInReportFromGridFsIds failed for project ${projectId}: ${err.message}`);
        }
        return this.listProjectAssetImageFiles(projectId, ctx, "skip-backfill");
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
        const picAssetFolder = sid
            ? (await db
                .collection(collections_3.ASSETS_COLLECTION)
                .findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }))
            : null;
        const folderIsPicAsset = picAssetFolder != null;
        if (picAssetFolder) {
            if (options.scope !== "asset-images" || options.imageOnly !== true) {
                throw new common_1.BadRequestException("الأصل يقبل صور الأصول فقط.");
            }
            if (!this.inspectorSpaces.isReady()) {
                throw new common_1.BadRequestException("DigitalOcean Spaces غير مهيأ لرفع صور الأصول.");
            }
            const photosRoot = await this.ensurePhotosRootFolder(db, pid);
            await this.assertPicAssetFolderCanReceiveImages(db, pid, photosRoot._id, picAssetFolder);
        }
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
            if (folderIsPicAsset && sid) {
                const imageId = new mongodb_1.ObjectId();
                let uploaded;
                try {
                    uploaded = await this.inspectorSpaces.uploadAssetImage({
                        projectId,
                        assetId: sid.toString(),
                        imageId: imageId.toString(),
                        fileName,
                        buffer: data,
                        contentType: file.mimetype || "application/octet-stream",
                    });
                }
                catch (err) {
                    this.logger.error(`uploadProjectFiles Spaces (asset image): ${err instanceof Error ? err.message : String(err)}`);
                    throw new common_1.BadRequestException("فشل رفع صورة الأصل إلى DigitalOcean Spaces.");
                }
                const imageDoc = {
                    _id: imageId,
                    url: uploaded.url,
                    publicId: uploaded.key,
                    createdAt: now,
                    mediaType: "image",
                    mimeType: metadata.mimeType,
                    includeInReport: true,
                };
                await db.collection(collections_3.ASSETS_COLLECTION).updateOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER }, buildAppendPicAssetImageUpdate(null, imageDoc, now));
                return mapStoredFileDoc({
                    _id: imageId,
                    filename: fileName,
                    length: data.length,
                    uploadDate: now,
                    metadata: {
                        ...metadata,
                        storage: "digitalocean",
                        spacesKey: uploaded.key,
                        sourceUrl: uploaded.url,
                    },
                });
            }
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
    async openStoredProjectFileStream(db, file) {
        const spacesKey = file.metadata?.storage === "digitalocean" ? file.metadata.spacesKey?.trim() : undefined;
        const bucket = spacesKey ? null : this.getFilesBucket(db);
        const maxAttempts = 4;
        const self = this;
        async function* readWithResume() {
            let offset = 0;
            let attempt = 0;
            for (;;) {
                attempt += 1;
                let source;
                try {
                    if (spacesKey) {
                        const object = await self.inspectorSpaces.getObjectStream(spacesKey, offset > 0 ? { rangeHeader: `bytes=${offset}-` } : undefined);
                        source = object.stream;
                    }
                    else {
                        source = bucket.openDownloadStream(file._id, offset > 0 ? { start: offset } : undefined);
                    }
                    for await (const rawChunk of source) {
                        const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
                        if (chunk.length === 0)
                            continue;
                        offset += chunk.length;
                        yield chunk;
                    }
                    return;
                }
                catch (error) {
                    const errName = error && typeof error === "object" && "name" in error
                        ? String(error.name || "")
                        : "";
                    const errCode = error && typeof error === "object" && "Code" in error
                        ? String(error.Code || "")
                        : "";
                    const httpStatus = error &&
                        typeof error === "object" &&
                        "$metadata" in error &&
                        error.$metadata?.httpStatusCode;
                    if (errName === "NoSuchKey" || errCode === "NoSuchKey" || httpStatus === 404) {
                        throw new common_1.NotFoundException("ملف التخزين غير موجود أو تم حذفه.");
                    }
                    if (attempt >= maxAttempts)
                        throw error;
                    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
                }
            }
        }
        return node_stream_1.Readable.from(readWithResume(), { highWaterMark: 1024 * 1024 });
    }
    async getProjectFileDownload(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        const file = await this.getStoredFileDoc(db, pid, fid);
        return {
            file: mapStoredFileDoc(file),
            stream: await this.openStoredProjectFileStream(db, file),
        };
    }
    async deleteProjectFile(projectId, fileId, ctx) {
        const db = await (0, mongodb_2.getMongoDb)();
        const pid = toId(projectId);
        await this.loadProjectForAccess(db, pid, ctx);
        const fid = toId(fileId);
        let file = null;
        try {
            file = await this.getStoredFileDoc(db, pid, fid);
        }
        catch (err) {
            if (err instanceof common_1.NotFoundException) {
                return { ok: true, alreadyGone: true };
            }
            throw err;
        }
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
            try {
                await this.getFilesBucket(db).delete(fid);
            }
            catch (err) {
                this.logger.warn(`deleteProjectFile GridFS: ${err instanceof Error ? err.message : String(err)}`);
            }
            await db.collection(collections_2.MV_FILES_FILES_COLLECTION).deleteOne({ _id: fid, "metadata.projectId": pid });
        }
        const pa = db.collection(collections_3.ASSETS_COLLECTION);
        const folders = await pa
            .find({
            projectId: pid,
            ...MV_PHOTO_FOLDER_FILTER,
            ...picAssetImagesExistFilter(),
        })
            .project({ images: 1 })
            .toArray();
        const now = new Date();
        const ops = [];
        for (const folder of folders) {
            const { next, changed } = removePicAssetImageByFileId(folder.images, fid);
            if (!changed)
                continue;
            ops.push({
                updateOne: {
                    filter: { _id: folder._id, projectId: pid },
                    update: { $set: { images: next, updatedAt: now } },
                },
            });
        }
        if (ops.length > 0) {
            await pa.bulkWrite(ops, { ordered: false });
        }
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
                            if: { $gt: [mongoSafeArraySize("$rowValues"), 0] },
                            then: mongoSafeArraySize("$rowValues"),
                            else: mongoSafeArraySize("$rows"),
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
    listProjectWorkflowStatuses() {
        return types_1.MV_PROJECT_WORKFLOW_STATUSES.map((value) => ({
            value,
            labelAr: types_1.MV_PROJECT_WORKFLOW_STATUS_META[value].labelAr,
            labelEn: types_1.MV_PROJECT_WORKFLOW_STATUS_META[value].labelEn,
        }));
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
