import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tryCoerceToObjectId, tryParseObjectId } from "@/common/object-id.util";
import { AnyBulkWriteOperation, type Db, Filter, GridFSBucket, ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import { getAuthCollections } from "@/server/auth-tracking/collections";
import type { UserDoc, UserProfileDoc } from "@/server/auth-tracking/types";
import {
  MV_FILES_BUCKET,
  MV_FILES_FILES_COLLECTION,
  MV_PROJECTS_COLLECTION,
  MV_SUBPROJECTS_COLLECTION,
  MV_ITEMS_COLLECTION,
  MV_SHEETS_COLLECTION,
  MV_HEADER_OPTIONS_COLLECTION,
} from "./collections";
import type { AssetType } from "@/assets/types";
import type {
  MvAccessContext,
  MvProjectDoc,
  MvProjectContact,
  MvProjectLocation,
  MvProjectMongoDoc,
  MvProjectReportData,
  MvProjectReportType,
  MvProjectWorkflowStatus,
  MvReportEditableSection,
  MvReportInsertedBlock,
  MvReportInsertedBlockKind,
  MvReportTeamMember,
  PicAssetDoc,
  PicAssetPatch,
  MvSubProjectDoc,
  MvSubProjectMongoDoc,
  PicAssetMongoDoc,
  MvItemDoc,
  MvSheetDoc,
  MvSheetMongoDoc,
  MvHeaderOptionDoc,
  MvHeaderOptionMongoDoc,
  MvInspectionAssignment,
  MvInspectorFileDoc,
  MvSpreadsheetMeta,
  MvStoredFileMetadata,
} from "./types";
import { DigitalOceanSpacesService } from "./digitalocean-spaces.service";
import { MV_INSPECTOR_FILE_MAX_BYTES } from "./inspector-files.constants";
import {
  inspectorLogicalTypeFromMime,
  normalizeInspectorFilesArray,
  serializeInspectorFileForClient,
} from "./inspector-files.util";
import { parseInspectorBytesRange } from "./inspector-download-range.util";
import {
  decodeUploadFilename,
  recordsToRowValues,
  rowValuesToRecords,
} from "./sheet-rows.util";
import { mvProjectSharesCompany } from "./mv-project-scope.util";
import { ASSETS_COLLECTION, ensureAssetsCollectionsInitialized } from "@/assets/collections";
import type { AssetDoc } from "@/assets/types";
import { sanitizeTextInput } from "@/assets/asset-import.utils";
import { ASSET_IMPORT_MAX_FILE_BYTES } from "@/assets/asset-import.constants";

const MV_PHOTO_FOLDER_FILTER = { isAssetFolder: true as const };
const EXTERNAL_ASSET_IMAGE_FETCH_TIMEOUT_MS = 15_000;
const MV_VALUATION_EXCEL_SCOPE = "valuation-excel" as const;

function toId(raw: string): ObjectId {
  if (!ObjectId.isValid(raw)) throw new NotFoundException("Not found");
  return new ObjectId(raw);
}

function normalizeWorkflowStatus(raw: unknown): MvProjectWorkflowStatus {
  if (raw === "review" || raw === "approved" || raw === "new") return raw;
  return "new";
}

function normalizeReportType(raw: unknown): MvProjectReportType {
  if (raw === "advanced") return "advanced";
  return "simple";
}

function projectWorkflowStatus(doc: MvProjectDoc): MvProjectWorkflowStatus {
  return normalizeWorkflowStatus(doc.workflowStatus);
}

function projectReportType(doc: MvProjectDoc): MvProjectReportType {
  return normalizeReportType(doc.reportType);
}

function sanitizeOptionalText(value: unknown, maxLength = 1000): string {
  if (value == null) return "";
  return String(value).trim().slice(0, maxLength);
}

function normalizeRoleName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function optionalProfileText(
  profile: Pick<UserProfileDoc, "additionalInfo"> | null | undefined,
  keys: string[],
  maxLength = 120,
): string | null {
  const info = profile?.additionalInfo;
  if (!info || typeof info !== "object") return null;
  for (const key of keys) {
    const value = (info as Record<string, unknown>)[key];
    const text = sanitizeOptionalText(value, maxLength);
    if (text) return text;
  }
  return null;
}

function sanitizeCoordinate(value: unknown, kind: "lat" | "lng"): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (kind === "lat" && (n < -90 || n > 90)) return null;
  if (kind === "lng" && (n < -180 || n > 180)) return null;
  return Math.round(n * 1_000_000) / 1_000_000;
}

function sanitizeProjectLocations(value: unknown, strict = true): MvProjectLocation[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (!strict) return [];
    throw new BadRequestException("locations must be an array");
  }

  return value
    .slice(0, 10)
    .map((item, index): MvProjectLocation | null => {
      const data =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const id =
        sanitizeOptionalText(data.id ?? data.siteId ?? data.locationId ?? data._id, 80) ||
        `site-${index + 1}`;
      const region = sanitizeOptionalText(data.region, 120);
      const city = sanitizeOptionalText(data.city, 120);
      const latitude = sanitizeCoordinate(data.latitude ?? data.lat, "lat");
      const longitude = sanitizeCoordinate(data.longitude ?? data.lng, "lng");
      const mapUrl = sanitizeOptionalText(data.mapUrl ?? data.url, 600);
      const name = sanitizeOptionalText(data.name ?? data.label ?? data.title, 120);
      const primaryPhone = sanitizeOptionalText(
        data.primaryPhone ?? data.primaryContactPhone ?? data.contactPhone ?? data.phone,
        60,
      );
      const secondaryPhone = sanitizeOptionalText(
        data.secondaryPhone ?? data.secondaryContactPhone ?? data.backupPhone ?? data.alternatePhone,
        60,
      );
      const notes = sanitizeOptionalText(data.notes ?? data.note, 2000);

      if (
        !name &&
        !region &&
        !city &&
        latitude === null &&
        longitude === null &&
        !mapUrl &&
        !primaryPhone &&
        !secondaryPhone &&
        !notes
      ) {
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
      } satisfies MvProjectLocation;
    })
    .filter((item): item is MvProjectLocation => item != null);
}

function sanitizeProjectContacts(value: unknown, strict = true): MvProjectContact[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (!strict) return [];
    throw new BadRequestException("contacts must be an array");
  }

  return value
    .slice(0, 20)
    .flatMap((item, index): MvProjectContact[] => {
      if (typeof item === "string") {
        const phone = sanitizeOptionalText(item, 60);
        return phone
          ? [{ type: index === 1 ? "secondary" : "primary", phone }]
          : [];
      }

      const data =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const primaryPhone = sanitizeOptionalText(data.primaryPhone ?? data.primaryContactPhone ?? data.contactPhone, 60);
      const secondaryPhone = sanitizeOptionalText(
        data.secondaryPhone ?? data.secondaryContactPhone ?? data.backupPhone ?? data.alternatePhone,
        60,
      );
      const type =
        data.type === "secondary" || (!data.type && !data.phone && !data.value && !data.number && secondaryPhone)
          ? "secondary"
          : "primary";
      const phone = sanitizeOptionalText(
        data.phone ?? data.value ?? data.number ?? (type === "secondary" ? secondaryPhone : primaryPhone),
        60,
      );
      const locationId = sanitizeOptionalText(data.locationId ?? data.siteId, 80);
      const rawLocationIndex = Number(data.locationIndex ?? data.siteIndex);
      const locationIndex =
        Number.isInteger(rawLocationIndex) && rawLocationIndex >= 0 && rawLocationIndex < 10
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

function mergeProjectContactsWithLocationPhones(
  contactsRaw: unknown,
  locations: MvProjectLocation[],
  strict = true,
): MvProjectContact[] {
  const rawContacts = sanitizeProjectContacts(contactsRaw, strict);
  const hasExplicitContactLinks = rawContacts.some(
    (contact) => contact.locationId || typeof contact.locationIndex === "number" || contact.locationName,
  );
  const typeOccurrence = new Map<MvProjectContact["type"], number>();
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

    const location =
      contact.locationId
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
  const contactKey = (contact: Pick<MvProjectContact, "type" | "locationId" | "locationIndex">) =>
    contact.locationId
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

function mergeProjectLocationsWithContacts(
  locations: MvProjectLocation[],
  contacts: MvProjectContact[],
): MvProjectLocation[] {
  const hasExplicitContactLinks = contacts.some(
    (contact) => contact.locationId || typeof contact.locationIndex === "number" || contact.locationName,
  );
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
          if (contact.locationId && contact.locationId === locationId) return true;
          if (typeof contact.locationIndex === "number" && contact.locationIndex === index) return true;
          return !!contact.locationName && !!locationName && contact.locationName === locationName;
        })
      : [unlinkedPrimaryContacts[index], unlinkedSecondaryContacts[index]].filter(
          (contact): contact is MvProjectContact => contact != null,
        );

    const primaryPhone =
      sanitizeOptionalText(location.primaryPhone, 60) ||
      linkedContacts.find((contact) => contact.type === "primary")?.phone ||
      "";
    const secondaryPhone =
      sanitizeOptionalText(location.secondaryPhone, 60) ||
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

function parseStringArrayField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall back to comma-separated form below.
  }
  return trimmed.split(",");
}

function sanitizeLocationIdSelection(value: unknown, locations: MvProjectLocation[]): string[] {
  const allowed = new Set(
    locations
      .map((location, index) => sanitizeOptionalText(location.id, 80) || `site-${index + 1}`)
      .filter(Boolean),
  );
  const raw = parseStringArrayField(value);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = sanitizeOptionalText(item, 80);
    if (!id || id === "__all__" || id === "all") return [];
    if (allowed.size > 0 && !allowed.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 20) break;
  }
  return out;
}

function coerceDate(value: unknown, fallback: Date): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function sanitizeInspectionAssignments(
  value: unknown,
  locations: MvProjectLocation[],
  assignedBy?: string | null,
): MvInspectionAssignment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new BadRequestException("inspectionAssignments must be an array");
  const now = new Date();
  const out: MvInspectionAssignment[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 50)) {
    const data =
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};
    const inspectorUserId = sanitizeOptionalText(data.inspectorUserId ?? data.userId ?? data.id, 80);
    const inspectorName = sanitizeOptionalText(data.inspectorName ?? data.name ?? data.username, 180);
    if (!inspectorUserId || !inspectorName) continue;
    const locationIds = sanitizeLocationIdSelection(data.locationIds, locations);
    const key = `${inspectorUserId}:${locationIds.length > 0 ? locationIds.join("|") : "all"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: sanitizeOptionalText(data.id, 80) || randomUUID(),
      inspectorUserId,
      inspectorName,
      ...(locationIds.length > 0 ? { locationIds } : {}),
      assignedBy:
        typeof data.assignedBy === "string"
          ? sanitizeOptionalText(data.assignedBy, 80) || null
          : assignedBy ?? null,
      createdAt: coerceDate(data.createdAt, now),
      updatedAt: coerceDate(data.updatedAt, now),
    });
  }
  return out;
}

function serializeInspectionAssignment(row: MvInspectionAssignment | Record<string, unknown>) {
  const r = row as Record<string, unknown>;
  const now = new Date();
  const locationIds = parseStringArrayField(r.locationIds)
    .map((item) => sanitizeOptionalText(item, 80))
    .filter(Boolean)
    .slice(0, 20);
  return {
    id: sanitizeOptionalText(r.id, 80) || randomUUID(),
    inspectorUserId: sanitizeOptionalText(r.inspectorUserId ?? r.userId, 80),
    inspectorName: sanitizeOptionalText(r.inspectorName ?? r.name ?? r.username, 180),
    locationIds,
    assignedBy: r.assignedBy != null ? sanitizeOptionalText(r.assignedBy, 80) || null : null,
    createdAt: coerceDate(r.createdAt, now).toISOString(),
    updatedAt: coerceDate(r.updatedAt, now).toISOString(),
  };
}

function sanitizeIsoDateOnly(value: unknown): string {
  const text = sanitizeOptionalText(value, 32);
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function sanitizeFinalValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n * 100) / 100);
}

function sanitizeReportTeamMembers(value: unknown): MvReportTeamMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((item, index) => {
      const data =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const name = sanitizeOptionalText(data.name, 180);
      const title = sanitizeOptionalText(data.title, 180);
      const membershipNo = sanitizeOptionalText(data.membershipNo, 80);
      const role = sanitizeOptionalText(data.role, 500);

      if (!name && !title && !membershipNo && !role) return null;

      return {
        id: sanitizeOptionalText(data.id, 80) || `member-${index + 1}`,
        name,
        ...(title ? { title } : {}),
        ...(membershipNo ? { membershipNo } : {}),
        ...(role ? { role } : {}),
      } satisfies MvReportTeamMember;
    })
    .filter((item): item is MvReportTeamMember => item != null);
}

function sanitizeReportTextOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 260)) {
    const key = sanitizeOptionalText(rawKey, 180);
    if (!key) continue;
    out[key] = sanitizeOptionalText(rawValue, 4000);
  }
  return out;
}

function sanitizeReportEditableSections(value: unknown): MvReportEditableSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 40)
    .map((item, index) => {
      const data =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const title = sanitizeOptionalText(data.title, 220);
      const body = sanitizeOptionalText(data.body, 50_000);
      const sectionNumber = sanitizeOptionalText(data.sectionNumber, 40);
      const companyDefaultSectionId = sanitizeOptionalText(data.companyDefaultSectionId, 120);
      if (!title && !body) return null;
      return {
        id: sanitizeOptionalText(data.id, 120) || `section-${index + 1}`,
        ...(sectionNumber ? { sectionNumber } : {}),
        title: title || "قسم جديد",
        body,
        ...(sanitizeOptionalText(data.insertAfterAnchorId, 180)
          ? { insertAfterAnchorId: sanitizeOptionalText(data.insertAfterAnchorId, 180) }
          : {}),
        ...(companyDefaultSectionId ? { companyDefaultSectionId } : {}),
      } satisfies MvReportEditableSection;
    })
    .filter((item): item is MvReportEditableSection => item != null);
}

function sanitizeReportInsertedBlockKind(value: unknown): MvReportInsertedBlockKind {
  return value === "paragraph" || value === "image" ? value : "heading";
}

function sanitizeReportInsertedBlocks(value: unknown): MvReportInsertedBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 120)
    .map((item, index) => {
      const data =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const kind = sanitizeReportInsertedBlockKind(data.kind);
      const content = sanitizeOptionalText(data.content, 50_000);
      const imageDataUrl = sanitizeOptionalText(data.imageDataUrl, 10_000_000);
      const caption = sanitizeOptionalText(data.caption, 2000);
      const position = data.position === "before" ? "before" : data.position === "after" ? "after" : undefined;
      const align =
        data.align === "start" || data.align === "center" || data.align === "end"
          ? data.align
          : undefined;
      const widthPercent =
        typeof data.widthPercent === "number" && Number.isFinite(data.widthPercent)
          ? Math.min(100, Math.max(20, Math.round(data.widthPercent)))
          : undefined;
      if (kind === "image" && !imageDataUrl) return null;
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
      } satisfies MvReportInsertedBlock;
    })
    .filter((item): item is MvReportInsertedBlock => item != null);
}

function sanitizeReportAnchorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value.slice(0, 180)) {
    const id = sanitizeOptionalText(raw, 180);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function sanitizeReportPageOrientations(value: unknown): Record<string, "portrait" | "landscape"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, "portrait" | "landscape"> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 220)) {
    const key = sanitizeOptionalText(rawKey, 180);
    if (!key) continue;
    if (rawValue === "portrait" || rawValue === "landscape") out[key] = rawValue;
  }
  return out;
}

function sanitizeReportData(raw: unknown): MvProjectReportData {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    reportReference: sanitizeOptionalText(data.reportReference, 120),
    reportTitle: sanitizeOptionalText(data.reportTitle, 220),
    valuationMethod: sanitizeOptionalText(data.valuationMethod, 120),
    valuationPurpose: sanitizeOptionalText(data.valuationPurpose, 120),
    valuePremise: sanitizeOptionalText(data.valuePremise, 120),
    valuationBasis: sanitizeOptionalText(data.valuationBasis, 220),
    valuationBasisDefinition: sanitizeOptionalText(data.valuationBasisDefinition, 2000),
    includeAssetImages: data.includeAssetImages !== false,
    includeValuationAccountImages: data.includeValuationAccountImages !== false,
    reportIssueDate: sanitizeIsoDateOnly(data.reportIssueDate),
    agreementDate: sanitizeIsoDateOnly(data.agreementDate),
    inspectionDate: sanitizeIsoDateOnly(data.inspectionDate),
    valuationDate: sanitizeIsoDateOnly(data.valuationDate),
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
    assetSubjectDescription: sanitizeOptionalText(data.assetSubjectDescription, 4000),
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

const MV_VALUATION_WORKSPACE_MAX_JSON_CHARS = 9_500_000;

function jsonDeepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneValuationAccountingWorkspaceObject(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return structuredClone(raw) as Record<string, unknown>;
    } catch {
      /* Embedded BSON / non-cloneable values fallback */
    }
  }
  return jsonDeepClone(raw);
}

function sanitizeValuationAccountingWorkspaceForPersist(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new BadRequestException("valuationAccountingWorkspace is required when provided");
  }
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("valuationAccountingWorkspace must be valid JSON");
    }
  } else if (typeof raw === "object") {
    obj = cloneValuationAccountingWorkspaceObject(raw as Record<string, unknown>);
  } else {
    throw new BadRequestException("valuationAccountingWorkspace must be an object");
  }
  if (!obj || typeof obj !== "object") {
    throw new BadRequestException("valuationAccountingWorkspace invalid");
  }
  if (obj.version !== 1) {
    throw new BadRequestException("valuationAccountingWorkspace version must be 1");
  }

  const sources = obj.sources;
  if (sources != null && !Array.isArray(sources)) {
    throw new BadRequestException("valuationAccountingWorkspace.sources invalid");
  }
  if (Array.isArray(sources)) {
    for (const s of sources) {
      if (s && typeof s === "object") {
        const row = s as Record<string, unknown>;
        const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
        if (fid) delete row.dataUrl;
      }
    }
  }
  const images = obj.images;
  if (images != null && !Array.isArray(images)) {
    throw new BadRequestException("valuationAccountingWorkspace.images invalid");
  }
  if (Array.isArray(images)) {
    for (const im of images) {
      if (im && typeof im === "object") {
        const row = im as Record<string, unknown>;
        const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
        if (fid) delete row.dataUrl;
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
          delete (s as Record<string, unknown>).importResult;
        }
      }
    }
    serialized = JSON.stringify(obj);
  }
  if (serialized.length > MV_VALUATION_WORKSPACE_MAX_JSON_CHARS) {
    throw new BadRequestException("valuationAccountingWorkspace exceeds maximum allowed size");
  }
  return obj;
}

function sanitizeValuationAccountingWorkspaceForClient(raw: unknown | undefined | null): unknown {
  if (raw == null) return undefined;
  try {
    if (typeof raw === "string") {
      return JSON.parse(raw);
    }
    if (typeof raw === "object" && raw !== null) {
      return cloneValuationAccountingWorkspaceObject(raw as Record<string, unknown>);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function sanitizeValuationReadyExcelWorkspaceForPersist(raw: unknown): Record<string, unknown> {
  if (raw == null) {
    throw new BadRequestException("valuationReadyExcelWorkspace is required when provided");
  }
  let obj: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("valuationReadyExcelWorkspace must be valid JSON");
    }
  } else if (typeof raw === "object") {
    obj = jsonDeepClone(raw as Record<string, unknown>);
  } else {
    throw new BadRequestException("valuationReadyExcelWorkspace must be an object");
  }
  if (obj.version !== 1) {
    throw new BadRequestException("valuationReadyExcelWorkspace version must be 1");
  }

  const accountImages = obj.accountImages;
  if (accountImages != null && !Array.isArray(accountImages)) {
    throw new BadRequestException("valuationReadyExcelWorkspace.accountImages invalid");
  }
  if (Array.isArray(accountImages)) {
    obj.accountImages = accountImages
      .map((im) => {
        if (!im || typeof im !== "object") return null;
        const row = { ...(im as Record<string, unknown>) };
        const fid = typeof row.fileId === "string" ? row.fileId.trim() : "";
        if (fid) delete row.dataUrl;
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
    throw new BadRequestException("valuationReadyExcelWorkspace exceeds maximum allowed size");
  }
  return obj;
}

function sanitizeValuationReadyExcelWorkspaceForClient(raw: unknown | undefined | null): unknown {
  if (raw == null) return undefined;
  try {
    if (typeof raw === "string") {
      return JSON.parse(raw);
    }
    return jsonDeepClone(raw);
  } catch {
    return undefined;
  }
}

/** تواريخ قد تُخزَّن كنص في BSON قديم — يتجنّب ‎toISOString‎ على غير ‎Date‎ */
function mvProjectDateToIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(0).toISOString();
}

/** مخرجات ‎$group / $sum‎ قد تكون ‎Long‎ أو ‎Int32‎ — نحوّلها لأعداد عادية لتسلسل JSON بأمان */
function toSafeNonNegativeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
  }
  if (value != null && typeof (value as { valueOf?: () => unknown }).valueOf === "function") {
    const v = Number((value as { valueOf: () => unknown }).valueOf());
    if (Number.isFinite(v)) return Math.max(0, Math.trunc(v));
  }
  return 0;
}

function mvProjectIdString(project: { _id?: unknown }): string | null {
  const id = project?._id;
  if (id == null) return null;
  if (id instanceof ObjectId) return id.toString();
  if (typeof id === "string" || typeof id === "number") return String(id);
  if (typeof (id as { toString?: () => string }).toString === "function") {
    return (id as { toString: () => string }).toString();
  }
  return null;
}

const DEFAULT_PROJECT_SUBFOLDERS = [
  "1.ملفات العميل",
  "2.صور المعاينة",
  "3.اعداد مسودة التقرير و حسابات القيمة",
  "4.التقرير بالتوقيع",
  "5.ملفات التسليم النهائية",
] as const;

const DEFAULT_PHOTOS_SUBFOLDER_NAME = "2.صور المعاينة";

const ASSET_TYPE_VALUES: readonly AssetType[] = [
  "vehicles",
  "machinery",
  "electronics",
  "furniture",
  "other",
] as const;
const ASSET_TYPE_SET = new Set<string>(ASSET_TYPE_VALUES);

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

/** دعم الترحيل: حقل ‎`parent`‎ والقديم ‎`parentSubProjectId`‎ */
function getParentIdFromDoc(
  sub: Pick<MvSubProjectDoc, "parent"> & { parentSubProjectId?: ObjectId },
): ObjectId | null | undefined {
  if (sub.parent !== undefined && sub.parent !== null) {
    return sub.parent;
  }
  if (sub.parent === null) return null;
  const legacy = (sub as { parentSubProjectId?: ObjectId }).parentSubProjectId;
  return legacy;
}

function isRootSubProject(
  sub: Pick<MvSubProjectDoc, "parent"> & { parentSubProjectId?: ObjectId },
): boolean {
  const p = getParentIdFromDoc(sub);
  return p === undefined || p === null;
}

/** مطابقة صف ‎mv‎ مع مجلد الصور في ‎assets‎ عبر ‎(parent, name)‎ */
function picMatchKeyForMvSub(sub: MvSubProjectMongoDoc): string | null {
  const p = getParentIdFromDoc(sub);
  if (p == null) return null;
  return `${p.toString()}\u001f${normalizeSubProjectName(sub.name)}`;
}

function picMatchKeyForPicDoc(pic: { parent?: ObjectId | null; name?: string | null }): string {
  const par = pic.parent;
  const nm = pic.name ?? "";
  if (par == null) {
    return `__\u001f${normalizeSubProjectName(nm)}`;
  }
  return `${par.toString()}\u001f${normalizeSubProjectName(nm)}`;
}

function buildPicAssetDocument(
  projectId: ObjectId,
  parentFolderId: ObjectId,
  name: string,
  now: Date,
  createdBy: ObjectId | null,
): AssetDoc {
  const id = new ObjectId();
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
    isDone: false,
    createdAt: now,
  };
}

/**
 * لكل مجلد ‎mv‎ تحت ‎parentFolderId‎: إن لم يوجد سجل مجلد صور مطابق في ‎assets‎ يُنشأ السجل.
 */
async function backfillMissingPicAssets(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  projectId: ObjectId,
  parentFolderId: ObjectId,
  names: string[],
  createdBy: ObjectId | null,
) {
  if (names.length === 0) return;
  const now = new Date();
  const sp = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
  const pa = db.collection<AssetDoc>(ASSETS_COLLECTION);
  const queryNames = Array.from(
    new Set(names.map((n) => normalizeSubProjectName(n)).filter(Boolean)),
  );
  if (queryNames.length === 0) return;
  const subs = await sp
    .find({
      projectId,
      $or: [
        { parent: parentFolderId },
        { parentSubProjectId: parentFolderId } as Record<string, unknown>,
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
    if (has) continue;
    await pa.insertOne(
      buildPicAssetDocument(projectId, parentRef, sub.name, now, createdBy),
    );
  }
}

function filterSubProjectsForInspector(
  subs: MvSubProjectMongoDoc[],
  photosName: string,
): MvSubProjectMongoDoc[] {
  if (subs.length === 0) return subs;
  const byId = new Map(subs.map((s) => [s._id.toString(), s]));
  const photosRoot = subs.find((s) => isRootSubProject(s) && s.name === photosName);
  if (!photosRoot) return subs;
  const photosId = photosRoot._id;
  return subs.filter((s) => isUnderOrIsPhotos(s, photosId, byId));
}

function isUnderOrIsPhotos(
  s: MvSubProjectMongoDoc,
  photosId: ObjectId,
  byId: Map<string, MvSubProjectMongoDoc>,
): boolean {
  if (s._id.equals(photosId)) return true;
  const seen = new Set<string>();
  let cur: MvSubProjectMongoDoc | undefined = s;
  while (cur) {
    const p = getParentIdFromDoc(cur);
    if (p === undefined || p === null) {
      return false;
    }
    if (p.equals(photosId)) return true;
    if (seen.has(cur._id.toString())) return false;
    seen.add(cur._id.toString());
    cur = byId.get(p.toString());
  }
  return false;
}

type FolderTreeEntry = { _id: string; name: string; parent: string | null };

function filterFolderEntriesForInspector(
  entries: FolderTreeEntry[],
  photosName: string,
): FolderTreeEntry[] {
  if (entries.length === 0) return entries;
  const byId = new Map(entries.map((e) => [e._id, e]));
  const photosRoot = entries.find((e) => e.parent == null && e.name === photosName);
  if (!photosRoot) return entries;
  const photosId = photosRoot._id;
  return entries.filter((e) => isEntryUnderOrIsPhotos(e, photosId, byId));
}

function isEntryUnderOrIsPhotos(
  e: FolderTreeEntry,
  photosId: string,
  byId: Map<string, FolderTreeEntry>,
): boolean {
  if (e._id === photosId) return true;
  const seen = new Set<string>();
  let cur: FolderTreeEntry | undefined = e;
  while (cur) {
    if (cur.parent == null) {
      return false;
    }
    if (cur.parent === photosId) return true;
    if (seen.has(cur._id)) return false;
    seen.add(cur._id);
    cur = byId.get(cur.parent);
  }
  return false;
}

function toObjectIdListFromStringIds(
  fieldLabel: "images" | "voiceNotes",
  ids: string[] | undefined,
): ObjectId[] | undefined {
  if (ids === undefined) return undefined;
  const out: ObjectId[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string" || !ObjectId.isValid(raw)) {
      throw new BadRequestException(`Invalid id in ${fieldLabel}`);
    }
    out.push(new ObjectId(raw));
  }
  return out;
}

function gridFsIdArrayToStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (item instanceof ObjectId) out.push(item.toString());
    else if (typeof item === "string" && ObjectId.isValid(item)) out.push(item);
  }
  return out;
}

/** تطبيع ‎assetType‎ من أنظمة خارجية (‎"vehicle"‎) إلى قيم ‎AssetType‎ في التطبيق */
function normalizeAssetTypeForApi(raw: unknown): AssetType {
  if (raw === undefined || raw === null) return "other";
  const s = String(raw).toLowerCase().trim();
  if (s === "vehicle" || s === "vehicles" || s === "car" || s === "cars") return "vehicles";
  if (s === "machine" || s === "machinery" || s === "industrial") return "machinery";
  if (s === "electronic" || s === "electronics" || s === "it") return "electronics";
  if (s === "furniture" || s === "furnitures") return "furniture";
  if (typeof raw === "string" && ASSET_TYPE_SET.has(raw)) return raw as AssetType;
  if (s === "other" || s === "") return "other";
  return "other";
}

function coerceNumberishField(v: unknown): number | string | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
    return t;
  }
  return null;
}

/**
 * ‎images‎ في ‎DB‎: ‎ObjectId[]‎ (GridFS قديم) أو كائنات وسائط كاملة ‎{ url, publicId, mediaType, … }‎ من التطبيق.
 */
function serializePicAssetImages(raw: unknown): Array<
  | { fileId: string; url?: undefined; publicId?: string; _id?: string; createdAt?: string }
  | {
      url: string;
      fileId?: undefined;
      publicId?: string;
      _id?: string;
      createdAt?: string;
      mediaType?: string;
      mimeType?: string;
      duration?: number | null;
      thumbnailUrl?: string | null;
      includeInReport?: boolean;
    }
> {
  if (!Array.isArray(raw)) return [];
  const out: Array<
    | { fileId: string; url?: undefined; publicId?: string; _id?: string; createdAt?: string }
    | {
        url: string;
        fileId?: undefined;
        publicId?: string;
        _id?: string;
        createdAt?: string;
        mediaType?: string;
        mimeType?: string;
        duration?: number | null;
        thumbnailUrl?: string | null;
        includeInReport?: boolean;
      }
  > = [];
  for (const item of raw) {
    if (item instanceof ObjectId) {
      out.push({ fileId: item.toString() });
      continue;
    }
    if (typeof item === "string" && ObjectId.isValid(item)) {
      out.push({ fileId: item });
      continue;
    }
    if (item && typeof item === "object" && "url" in (item as object)) {
      const u = (item as { url?: unknown }).url;
      if (typeof u === "string" && u.length > 0) {
        const o = item as {
          url: string;
          publicId?: unknown;
          _id?: unknown;
          createdAt?: unknown;
          mediaType?: unknown;
          mimeType?: unknown;
          duration?: unknown;
          thumbnailUrl?: unknown;
          includeInReport?: unknown;
        };
        const row: (typeof out)[number] = {
          url: o.url,
          publicId: typeof o.publicId === "string" ? o.publicId : undefined,
          _id:
            o._id instanceof ObjectId
              ? o._id.toString()
              : typeof o._id === "string"
                ? o._id
                : undefined,
          createdAt:
            o.createdAt instanceof Date
              ? o.createdAt.toISOString()
              : typeof o.createdAt === "string"
                ? o.createdAt
                : undefined,
        };
        if (typeof o.mediaType === "string" && o.mediaType.length > 0) {
          (row as { mediaType?: string }).mediaType = o.mediaType;
        }
        if (typeof o.mimeType === "string" && o.mimeType.length > 0) {
          (row as { mimeType?: string }).mimeType = o.mimeType;
        }
        if (o.duration === null) {
          (row as { duration?: number | null }).duration = null;
        } else if (typeof o.duration === "number" && Number.isFinite(o.duration)) {
          (row as { duration?: number | null }).duration = o.duration;
        } else if (typeof o.duration === "string" && o.duration.trim() !== "" && Number.isFinite(Number(o.duration))) {
          (row as { duration?: number | null }).duration = Number(o.duration);
        }
        if (o.thumbnailUrl === null) {
          (row as { thumbnailUrl?: string | null }).thumbnailUrl = null;
        } else if (typeof o.thumbnailUrl === "string" && o.thumbnailUrl.length > 0) {
          (row as { thumbnailUrl?: string | null }).thumbnailUrl = o.thumbnailUrl;
        }
        if (typeof o.includeInReport === "boolean") {
          (row as { includeInReport?: boolean }).includeInReport = o.includeInReport;
        }
        out.push(row);
      }
    }
  }
  return out;
}

/**
 * ‎voiceNotes‎: ‎ObjectId[]‎ (GridFS) أو كائنات ‎{ url, publicId, duration?, … }‎
 */
function serializePicAssetVoiceNotes(raw: unknown): Array<
  | { fileId: string; url?: undefined; publicId?: string; _id?: string; createdAt?: string; duration?: number }
  | {
      url: string;
      fileId?: undefined;
      publicId?: string;
      _id?: string;
      createdAt?: string;
      duration?: number;
    }
> {
  if (!Array.isArray(raw)) return [];
  const out: Array<
    | { fileId: string; url?: undefined; publicId?: string; _id?: string; createdAt?: string; duration?: number }
    | {
        url: string;
        fileId?: undefined;
        publicId?: string;
        _id?: string;
        createdAt?: string;
        duration?: number;
      }
  > = [];
  for (const item of raw) {
    if (item instanceof ObjectId) {
      out.push({ fileId: item.toString() });
      continue;
    }
    if (typeof item === "string" && ObjectId.isValid(item)) {
      out.push({ fileId: item });
      continue;
    }
    if (item && typeof item === "object" && "url" in (item as object)) {
      const u = (item as { url?: unknown }).url;
      if (typeof u === "string" && u.length > 0) {
        const o = item as {
          url: string;
          publicId?: unknown;
          _id?: unknown;
          createdAt?: unknown;
          duration?: unknown;
        };
        const dur = o.duration;
        out.push({
          url: o.url,
          publicId: typeof o.publicId === "string" ? o.publicId : undefined,
          _id:
            o._id instanceof ObjectId
              ? o._id.toString()
              : typeof o._id === "string"
                ? o._id
                : undefined,
          createdAt:
            o.createdAt instanceof Date
              ? o.createdAt.toISOString()
              : typeof o.createdAt === "string"
                ? o.createdAt
                : undefined,
          duration:
            typeof dur === "number" && Number.isFinite(dur)
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

/**
 * تخزين ‎DB‎: ‎ObjectId‎ أو كائن وسائط خارجي يحتوي ‎url‎.
 */
function normalizePicAssetMediaArrayForPatch(
  raw: unknown,
  field: "images" | "voiceNotes",
): (ObjectId | Record<string, unknown>)[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`${field} must be an array`);
  }
  const out: (ObjectId | Record<string, unknown>)[] = [];
  for (const item of raw) {
    if (typeof item === "string" && ObjectId.isValid(item)) {
      out.push(new ObjectId(item));
      continue;
    }
    if (item && typeof item === "object" && "fileId" in (item as object)) {
      const fid = (item as { fileId?: unknown }).fileId;
      if (typeof fid === "string" && ObjectId.isValid(fid)) {
        out.push(new ObjectId(fid));
        continue;
      }
    }
    if (item && typeof item === "object" && "url" in (item as object)) {
      const o = item as {
        url?: unknown;
        publicId?: unknown;
        _id?: unknown;
        createdAt?: unknown;
        duration?: unknown;
        mediaType?: unknown;
        mimeType?: unknown;
        thumbnailUrl?: unknown;
        includeInReport?: unknown;
      };
      if (typeof o.url !== "string" || o.url.length === 0) {
        throw new BadRequestException(`Invalid ${field} entry: missing url`);
      }
      let oid: ObjectId;
      if (o._id != null) {
        if (o._id instanceof ObjectId) {
          oid = o._id;
        } else if (typeof o._id === "string" && ObjectId.isValid(o._id)) {
          oid = new ObjectId(o._id);
        } else {
          throw new BadRequestException(`Invalid ${field} _id`);
        }
      } else {
        oid = new ObjectId();
      }
      let createdAt: Date;
      if (o.createdAt instanceof Date) {
        createdAt = o.createdAt;
      } else if (typeof o.createdAt === "string" || typeof o.createdAt === "number") {
        const d = new Date(o.createdAt);
        createdAt = Number.isNaN(d.getTime()) ? new Date() : d;
      } else {
        createdAt = new Date();
      }
      const sub: Record<string, unknown> = {
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
        } else if (typeof o.thumbnailUrl === "string") {
          sub.thumbnailUrl = o.thumbnailUrl;
        }
        if (typeof o.includeInReport === "boolean") {
          sub.includeInReport = o.includeInReport;
        }
        if (o.duration === null) {
          sub.duration = null;
        } else if (typeof o.duration === "number" && Number.isFinite(o.duration)) {
          sub.duration = o.duration;
        } else if (typeof o.duration === "string" && o.duration.trim() !== "" && Number.isFinite(Number(o.duration))) {
          sub.duration = Number(o.duration);
        }
      }
      if (field === "voiceNotes" && o.duration != null) {
        const d = o.duration;
        if (typeof d === "number" && Number.isFinite(d)) {
          sub.duration = d;
        } else if (typeof d === "string" && d.trim() !== "" && Number.isFinite(Number(d))) {
          sub.duration = Number(d);
        }
      }
      out.push(sub);
      continue;
    }
    throw new BadRequestException(`Invalid ${field} entry`);
  }
  return out;
}

function serializeMvSubProject(
  sub: MvSubProjectMongoDoc,
  idFallback?: { _id: ObjectId; projectId: ObjectId },
) {
  const oid = (sub as { _id?: ObjectId | null })._id ?? idFallback?._id;
  const proj = (sub as { projectId?: ObjectId | null }).projectId ?? idFallback?.projectId;
  if (oid == null || proj == null) {
    throw new BadRequestException("Sub-project record is missing _id or projectId");
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

function serializePicAsset(pic: PicAssetMongoDoc, idFallback?: { _id: ObjectId; projectId: ObjectId }) {
  const parentRaw = (pic as { parent?: ObjectId | null }).parent;
  const createdSrc =
    (pic as { createdAt?: unknown }).createdAt ?? pic.importedAt ?? pic.updatedAt;
  const oid = (pic as { _id?: ObjectId | null })._id ?? idFallback?._id;
  const proj = (pic as { projectId?: ObjectId | null }).projectId ?? idFallback?.projectId;
  if (oid == null || proj == null) {
    throw new BadRequestException("Asset record is missing _id or projectId");
  }
  return {
    _id: oid.toString(),
    projectId: proj.toString(),
    parent: parentRaw != null ? parentRaw.toString() : "",
    name: pic.name ?? "",
    importId: pic.importId instanceof ObjectId ? pic.importId.toString() : null,
    sheetName: typeof pic.sheetName === "string" && pic.sheetName.trim() ? pic.sheetName : null,
    createdAt: mvProjectDateToIso(createdSrc),
    updatedAt: mvProjectDateToIso(pic.updatedAt),
    isAssetFolder: true as const,
    writtenDescription: pic.writtenDescription,
    condition: pic.condition,
    assetType: normalizeAssetTypeForApi((pic as { assetType?: unknown }).assetType),
    brand: pic.brand,
    code: pic.code,
    model: pic.model,
    manufactureYear: coerceNumberishField((pic as { manufactureYear?: unknown }).manufactureYear),
    kilometersDriven: coerceNumberishField((pic as { kilometersDriven?: unknown }).kilometersDriven),
    isPresent: pic.isPresent,
    createdBy:
      pic.createdBy instanceof ObjectId
        ? pic.createdBy.toString()
        : pic.createdBy != null
          ? String(pic.createdBy)
          : null,
    images: serializePicAssetImages((pic as { images?: unknown }).images),
    voiceNotes: serializePicAssetVoiceNotes((pic as { voiceNotes?: unknown }).voiceNotes),
    isDone: pic.isDone === true,
  };
}

type PicAssetWithMediaCounts = PicAssetMongoDoc & {
  imageCount?: number;
  voiceNoteCount?: number;
};

/**
 * نفس حقول ‎serializePicAsset‎ لكن بدون مصفوفات الصور/الصوت (تُستبعد في ‎Mongo‎) مع أعداد للواجهة.
 * يُستخدم مع ‎getProject?picAssetMode=summary‎ لتفادي نقل آلاف المعرفات في شجرة المجلدات.
 */
function serializePicAssetSummary(pic: PicAssetWithMediaCounts) {
  const full = serializePicAsset(pic);
  const imgN =
    typeof pic.imageCount === "number" && Number.isFinite(pic.imageCount)
      ? Math.max(0, Math.floor(pic.imageCount))
      : full.images.length;
  const vnN =
    typeof pic.voiceNoteCount === "number" && Number.isFinite(pic.voiceNoteCount)
      ? Math.max(0, Math.floor(pic.voiceNoteCount))
      : full.voiceNotes.length;
  return {
    ...full,
    images: [] as typeof full.images,
    voiceNotes: [] as typeof full.voiceNotes,
    imageCount: imgN,
    voiceNoteCount: vnN,
  };
}

function sanitizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return undefined;
  return trimmed.toUpperCase();
}

function sanitizeSpreadsheetMeta(
  meta: unknown,
  rowCount: number,
  colCount: number,
): MvSpreadsheetMeta | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const raw = meta as MvSpreadsheetMeta;
  const next: MvSpreadsheetMeta = {};

  if (Array.isArray(raw.columnFormats) && raw.columnFormats.length > 0) {
    next.columnFormats = Array.from({ length: colCount }, (_, idx) => {
      const val = raw.columnFormats?.[idx];
      return ALLOWED_COLUMN_FORMATS.has(val ?? "")
        ? (val as NonNullable<MvSpreadsheetMeta["columnFormats"]>[number])
        : "general";
    });
  }

  if (Array.isArray(raw.columnWidths) && raw.columnWidths.length > 0) {
    next.columnWidths = Array.from({ length: colCount }, (_, idx) => {
      const val = raw.columnWidths?.[idx];
      if (typeof val !== "number" || !Number.isFinite(val)) return DEFAULT_COLUMN_WIDTH;
      return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, Math.round(val)));
    });
  }

  if (typeof raw.frozenCols === "number" && Number.isFinite(raw.frozenCols)) {
    next.frozenCols = Math.max(0, Math.min(colCount, Math.round(raw.frozenCols)));
  }

  if (Array.isArray(raw.cellStyles) && raw.cellStyles.length > 0) {
    next.cellStyles = Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: colCount }, (_, colIndex) => {
        const style = raw.cellStyles?.[rowIndex]?.[colIndex];
        if (!style || typeof style !== "object") return null;
        const normalized = {
          backgroundColor: sanitizeColor(style.backgroundColor),
          textColor: sanitizeColor(style.textColor),
          fontSize:
            typeof style.fontSize === "number" && Number.isFinite(style.fontSize)
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
        if (
          !normalized.backgroundColor &&
          !normalized.textColor &&
          !normalized.fontSize &&
          !normalized.fontFamily &&
          !normalized.fontWeight &&
          !normalized.textAlign
        ) {
          return null;
        }
        return normalized;
      }),
    );
  }

  if (
    !next.columnFormats &&
    !next.columnWidths &&
    next.frozenCols === undefined &&
    !next.cellStyles
  ) {
    return undefined;
  }

  return next;
}

function normalizeSubProjectName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ");
}

function sanitizeGeneratedFolderName(raw: unknown): string | null {
  const normalized = normalizeSubProjectName(String(raw ?? ""));
  if (!normalized) return null;
  const cleaned = normalized.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeUploadedFileName(raw: unknown): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()
    ?.trim() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").trim();
  return cleaned || "file";
}

function sanitizeUploadedPathPart(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();
  return cleaned.slice(0, 120);
}

function sanitizeUploadedRelativePath(raw: unknown, fallbackFileName: string): string {
  const parts = String(raw ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map(sanitizeUploadedPathPart)
    .filter(Boolean);

  if (parts.length === 0) return fallbackFileName;
  parts[parts.length - 1] = sanitizeUploadedFileName(parts[parts.length - 1]);
  return parts.join("/").slice(0, 900) || fallbackFileName;
}

function folderPathFromRelativePath(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

/** يطابق تطبيع المسار المستخدم لواجهات صور الأصول (مجلدات نسبية). */
function normalizeMvAssetFolderPath(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map(sanitizeUploadedPathPart)
    .filter(Boolean)
    .join("/");
}

function extractFileExtension(fileName: string): string | undefined {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === fileName.length - 1) return undefined;
  return fileName.slice(lastDot + 1).trim().toLowerCase() || undefined;
}

function isLikelyImageUpload(fileName: string, mimeType: string | undefined): boolean {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|svg|tif|tiff)$/i.test(fileName);
}

function imageExtensionFromMimeType(mimeType: string): string | undefined {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/tiff") return "tif";
  return undefined;
}

function fileNameFromExternalAssetImageUrl(
  url: string,
  folderName: string,
  imageIndex: number,
  mimeType: string,
): string {
  let lastPathPart = "";
  try {
    lastPathPart = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    lastPathPart = "";
  }

  const fromUrl = sanitizeUploadedFileName(lastPathPart);
  if (fromUrl !== "file" && isLikelyImageUpload(fromUrl, mimeType)) return fromUrl;

  const extension = imageExtensionFromMimeType(mimeType) ?? "jpg";
  const folderBase = sanitizeUploadedPathPart(folderName) || "asset";
  return sanitizeUploadedFileName(`${folderBase}-${imageIndex + 1}.${extension}`);
}

function picAssetExternalImageUrl(raw: unknown): { url: string; rawUrl: string } | null {
  if (!raw || typeof raw !== "object" || raw instanceof ObjectId || !("url" in raw)) return null;
  const rawUrl = (raw as { url?: unknown }).url;
  if (typeof rawUrl !== "string") return null;
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, rawUrl };
}

function picAssetImageIncludeInReport(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || raw instanceof ObjectId) return false;
  return (raw as { includeInReport?: unknown }).includeInReport === true;
}

function picAssetImageDisplayOrder(raw: unknown, fallback: number): number {
  if (!raw || typeof raw !== "object" || raw instanceof ObjectId) return fallback;
  const displayOrder = (raw as { displayOrder?: unknown }).displayOrder;
  if (typeof displayOrder === "number" && Number.isFinite(displayOrder)) return displayOrder;
  return fallback;
}

async function fetchExternalAssetImageBuffer(
  url: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), EXTERNAL_ASSET_IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: ac.signal, redirect: "follow" });
    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(contentLength) && contentLength > ASSET_IMPORT_MAX_FILE_BYTES) return null;

    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (contentType && !contentType.startsWith("image/") && !isLikelyImageUpload(url, contentType)) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > ASSET_IMPORT_MAX_FILE_BYTES) return null;

    const mimeType = contentType || "image/jpeg";
    if (!isLikelyImageUpload(url, mimeType)) return null;

    return { data: Buffer.from(arrayBuffer), mimeType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface MvUploadProjectFilesOptions {
  scope?: string;
  relativePaths?: string[];
  imageOnly?: boolean;
  /**
   * عند true وتهيئة DigitalOcean Spaces: رفع المحتوى إلى Spaces وتسجيل ‎spacesKey‎ في ‎fs.files‎ (بدون أجزاء GridFS).
   * يُستخدم لإجراءات التقييم (Excel / PDF / صور) لمطابقة منطق ملفات المعاينة.
   */
  preferDigitalOcean?: boolean;
}

/** تدفقات GridFS المتزامنة لكل طلب رفع؛ تقليل التسلسل يحسّن زمن الطلب الكبير. */
const MV_GRIDFS_PARALLEL_UPLOAD_LIMIT = 24;

async function runWithConcurrency<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const capped = Math.min(Math.max(1, limit), tasks.length);
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  }

  await Promise.all(Array.from({ length: capped }, () => worker()));
  return results;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function missingAssetImageFolderPathClause(): Record<string, unknown> {
  return {
    $or: [
      { "metadata.folderPath": { $exists: false } },
      { "metadata.folderPath": null },
    ],
  };
}

function assetImageFolderMongoFilter(folderPathNormalized: string): Record<string, unknown> {
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

function compareAssetImageGridDocs(
  a: { metadata?: MvStoredFileMetadata; uploadDate?: Date },
  b: { metadata?: MvStoredFileMetadata; uploadDate?: Date },
): number {
  const oa = a.metadata?.displayOrder;
  const ob = b.metadata?.displayOrder;
  if (typeof oa === "number" && typeof ob === "number" && oa !== ob) return oa - ob;
  if (typeof oa === "number" && typeof ob !== "number") return -1;
  if (typeof oa !== "number" && typeof ob === "number") return 1;
  const pa = String(a.metadata?.relativePath || "").replace(/\\/g, "/");
  const pb = String(b.metadata?.relativePath || "").replace(/\\/g, "/");
  const cmp = pa.localeCompare(pb, "ar", { sensitivity: "base", numeric: true });
  if (cmp !== 0) return cmp;
  const da = a.uploadDate instanceof Date ? a.uploadDate.getTime() : 0;
  const dbt = b.uploadDate instanceof Date ? b.uploadDate.getTime() : 0;
  return da - dbt;
}

function mapStoredFileDoc(
  doc: {
    _id: ObjectId;
    filename?: string;
    length?: number;
    uploadDate?: Date;
    metadata?: MvStoredFileMetadata;
  },
) {
  const uploadDate = doc.uploadDate instanceof Date ? doc.uploadDate : new Date();
  const updatedAt =
    doc.metadata?.updatedAt instanceof Date ? doc.metadata.updatedAt : uploadDate;

  return {
    _id: doc._id.toString(),
    projectId: doc.metadata?.projectId?.toString?.() ?? "",
    subProjectId: doc.metadata?.subProjectId?.toString?.(),
    picAssetId: doc.metadata?.picAssetId?.toString?.(),
    name: doc.metadata?.originalFileName || doc.filename || "file",
    scope: doc.metadata?.scope,
    relativePath:
      doc.metadata?.relativePath ||
      doc.metadata?.originalFileName ||
      doc.filename ||
      "file",
    folderPath:
      doc.metadata?.folderPath ??
      folderPathFromRelativePath(
        doc.metadata?.relativePath ||
          doc.metadata?.originalFileName ||
          doc.filename ||
          "file",
      ),
    mimeType: doc.metadata?.mimeType || "application/octet-stream",
    extension:
      doc.metadata?.extension ||
      extractFileExtension(doc.metadata?.originalFileName || doc.filename || ""),
    sizeBytes: typeof doc.length === "number" ? doc.length : 0,
    uploadedAt: uploadDate.toISOString(),
    updatedAt: updatedAt.toISOString(),
    displayOrder:
      typeof doc.metadata?.displayOrder === "number" ? doc.metadata.displayOrder : undefined,
    includeInReport: doc.metadata?.includeInReport === true,
    ...(typeof doc.metadata?.sourceUrl === "string" && doc.metadata.sourceUrl.length > 0
      ? { sourceUrl: doc.metadata.sourceUrl }
      : {}),
  };
}

function picAssetImageFileObjectId(raw: unknown): ObjectId | null {
  if (raw instanceof ObjectId) return raw;
  if (typeof raw === "string") return tryParseObjectId(raw);
  if (raw && typeof raw === "object" && "fileId" in raw) {
    const fileId = (raw as { fileId?: unknown }).fileId;
    if (fileId instanceof ObjectId) return fileId;
    return typeof fileId === "string" ? tryParseObjectId(fileId) : null;
  }
  return null;
}

type ExternalPicAssetImageRef = {
  picAssetId: ObjectId;
  folderName: string;
  imageIndex: number;
  url: string;
  rawUrl: string;
  includeInReport: boolean;
  displayOrder: number;
};

async function uploadExternalPicAssetImageToGridFs(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  projectId: ObjectId,
  ref: ExternalPicAssetImageRef,
): Promise<ObjectId | null> {
  const col = db.collection<{
    _id: ObjectId;
    filename?: string;
    metadata?: MvStoredFileMetadata;
  }>(MV_FILES_FILES_COLLECTION);

  const existing = await col.findOne({
    "metadata.projectId": projectId,
    "metadata.scope": "asset-images",
    "metadata.picAssetId": ref.picAssetId,
    "metadata.sourceUrl": ref.url,
    "metadata.displayOrder": ref.displayOrder,
  });
  if (existing) return existing._id;

  const fetched = await fetchExternalAssetImageBuffer(ref.url);
  if (!fetched) return null;

  const fileName = fileNameFromExternalAssetImageUrl(
    ref.url,
    ref.folderName,
    ref.imageIndex,
    fetched.mimeType,
  );
  const folderPath = normalizeMvAssetFolderPath(ref.folderName || "asset");
  const relativePath = sanitizeUploadedRelativePath(
    folderPath ? `${folderPath}/${fileName}` : fileName,
    fileName,
  );
  const now = new Date();
  const metadata: MvStoredFileMetadata = {
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

  const bucket = new GridFSBucket(db, { bucketName: MV_FILES_BUCKET });
  return new Promise<ObjectId>((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(fileName, { metadata });
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve(uploadStream.id as ObjectId));
    uploadStream.end(fetched.data);
  });
}

async function backfillPicAssetGridFsImagesAsAssetFiles(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  projectId: ObjectId,
): Promise<void> {
  const picFolders = await db
    .collection<AssetDoc>(ASSETS_COLLECTION)
    .find({
      projectId,
      ...MV_PHOTO_FOLDER_FILTER,
      images: { $exists: true, $ne: [] },
    })
    .project<{ _id: ObjectId; name?: string | null; images?: unknown[] }>({
      _id: 1,
      name: 1,
      images: 1,
    })
    .toArray();

  const refsByFileId = new Map<
    string,
    { fileId: ObjectId; picAssetId: ObjectId; folderName: string; imageIndex: number }
  >();
  const externalRefs: ExternalPicAssetImageRef[] = [];

  for (const folder of picFolders) {
    const images = Array.isArray(folder.images) ? folder.images : [];
    images.forEach((image, imageIndex) => {
      const fileId = picAssetImageFileObjectId(image);
      const folderName = sanitizeUploadedPathPart(folder.name || "asset");
      if (fileId) {
        const key = fileId.toString();
        if (refsByFileId.has(key)) return;
        refsByFileId.set(key, {
          fileId,
          picAssetId: folder._id,
          folderName,
          imageIndex,
        });
        return;
      }

      const external = picAssetExternalImageUrl(image);
      if (!external) return;
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

  /**
   * نرفع نسخة ‎GridFS‎ للمعاينة/التقرير فقط — **دون** تعديل ‎assets.images‎.
   * استبدال عنصر ‎{ url, publicId, … }‎ بـ ‎ObjectId‎ كان يفسد هيكل التطبيق الجوال.
   */
  for (const ref of externalRefs) {
    try {
      await uploadExternalPicAssetImageToGridFs(db, projectId, ref);
    } catch {
      /* تجاهل فشل الجلب/الرفع لعنصر واحد */
    }
  }

  if (refsByFileId.size === 0) return;

  const fileIds = Array.from(refsByFileId.values()).map((ref) => ref.fileId);
  const col = db.collection<{
    _id: ObjectId;
    filename?: string;
    metadata?: MvStoredFileMetadata;
  }>(MV_FILES_FILES_COLLECTION);
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
  const ops: AnyBulkWriteOperation<{
    _id: ObjectId;
    filename?: string;
    metadata?: MvStoredFileMetadata;
  }>[] = [];

  for (const doc of docs) {
    const ref = refsByFileId.get(doc._id.toString());
    if (!ref) continue;

    const existingPicAssetId = doc.metadata?.picAssetId?.toString?.() ?? "";
    const needsPathBackfill =
      doc.metadata?.scope !== "asset-images" ||
      existingPicAssetId !== ref.picAssetId.toString() ||
      typeof doc.metadata?.relativePath !== "string" ||
      typeof doc.metadata?.folderPath !== "string";
    const needsDisplayOrderBackfill = typeof doc.metadata?.displayOrder !== "number";
    const needsMetadataBackfill =
      doc.metadata?.projectId?.toString?.() !== projectId.toString() ||
      doc.metadata?.scope !== "asset-images" ||
      existingPicAssetId !== ref.picAssetId.toString() ||
      needsPathBackfill ||
      typeof doc.metadata?.originalFileName !== "string" ||
      doc.metadata?.includeInReport === undefined ||
      needsDisplayOrderBackfill;
    if (!needsMetadataBackfill) continue;

    const folderPath = needsPathBackfill
      ? normalizeMvAssetFolderPath(ref.folderName || "asset")
      : normalizeMvAssetFolderPath(doc.metadata?.folderPath ?? "");
    const fileName = sanitizeUploadedFileName(
      doc.metadata?.originalFileName || doc.filename || `image-${ref.imageIndex + 1}.jpg`,
    );
    const relativePath = needsPathBackfill
      ? sanitizeUploadedRelativePath(folderPath ? `${folderPath}/${fileName}` : fileName, fileName)
      : doc.metadata?.relativePath;

    const setMeta: Record<string, unknown> = {
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

@Injectable()
export class MachineValuationService implements OnModuleInit {
  private readonly logger = new Logger(MachineValuationService.name);

  constructor(private readonly inspectorSpaces: DigitalOceanSpacesService) {}

  /**
   * إزالة الحقل/الفهارس القديمة ‎subProjectId‎ من وثائق مجلدات الصور في ‎assets‎ (لم يعد مستخدماً).
   */
  private async migratePhotoFolderAssetsRemoveSubProjectIdField(
    db: Awaited<ReturnType<typeof getMongoDb>>,
  ) {
    const col = db.collection(ASSETS_COLLECTION);
    try {
      const picIdx = await col.listIndexes().toArray();
      for (const spec of picIdx) {
        if (spec.name === "_id_") continue;
        const key = spec.key as Record<string, number>;
        if (key && Object.prototype.hasOwnProperty.call(key, "subProjectId") && spec.name) {
          await col.dropIndex(spec.name);
        }
      }
    } catch {
      // تجاهل
    }
    await col
      .updateMany(
        { ...MV_PHOTO_FOLDER_FILTER, subProjectId: { $exists: true } },
        { $unset: { subProjectId: "" } } as never,
      )
      .catch(() => undefined);
  }

  /**
   * حذف أي مجموعة تخزين قديمة مُهجورة من المخطط الحالي (كل البيانات في ‎assets‎ فقط).
   * لا يُنشَأ هذا الاسم في التطبيق؛ يُزال من الخادم إن بقي من إصدارات سابقة.
   */
  private async dropAbandonedLegacyPhotoStorageCollection(
    db: Awaited<ReturnType<typeof getMongoDb>>,
  ) {
    /** اسم مجموعة قديمة من مخطط سابق — التطبيق لا يستخدمه؛ يُزال من الخادم فقط إن وُجد */
    const legacyName = "pic_assets";
    try {
      const listed = await db.listCollections({ name: legacyName }).toArray();
      if (listed.length === 0) return;
      const coll = db.collection(legacyName);
      const n = await coll.estimatedDocumentCount().catch(() => 0);
      if (n > 0) {
        this.logger.warn(
          `Removing legacy DB collection (${n} doc(s)). Application storage is assets only; migrate data beforehand if needed.`,
        );
      }
      await coll.drop();
      this.logger.log("Unified storage: assets collection only.");
    } catch (e) {
      this.logger.warn(
        `Legacy storage cleanup: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private photosTreeParentKey(projectId: ObjectId, parentId: ObjectId): string {
    return `${projectId.toString()}\u001f${parentId.toString()}`;
  }

  private photosTreeLocationKey(
    projectId: ObjectId,
    parentId: ObjectId | null,
    name: string,
  ): string {
    return `${projectId.toString()}\u001f${parentId?.toString() ?? "__root__"}\u001f${normalizeSubProjectName(name)}`;
  }

  private async redirectPhotosFolderReferences(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    fromId: ObjectId,
    toId: ObjectId,
  ) {
    if (fromId.equals(toId)) return;
    const now = new Date();
    await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
    await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .updateMany(
        { projectId, parentSubProjectId: fromId } as Filter<Record<string, unknown>>,
        { $set: { parent: toId, updatedAt: now }, $unset: { parentSubProjectId: "" } } as never,
      );
    await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
    await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .updateMany(
        { projectId, parentSubProjectId: fromId } as Filter<Record<string, unknown>>,
        { $set: { parent: toId, updatedAt: now }, $unset: { parentSubProjectId: "" } } as never,
      );
    await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .updateMany({ projectId, parent: fromId }, { $set: { parent: toId, updatedAt: now } });
    await db.collection(MV_FILES_FILES_COLLECTION).updateMany(
      { "metadata.projectId": projectId, "metadata.subProjectId": fromId },
      { $set: { "metadata.subProjectId": toId, "metadata.updatedAt": now } },
    );
    await db.collection(MV_FILES_FILES_COLLECTION).updateMany(
      { "metadata.projectId": projectId, "metadata.picAssetId": fromId },
      { $set: { "metadata.picAssetId": toId, "metadata.updatedAt": now } },
    );
  }

  private async retargetLegacyAssetMirrorFiles(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    legacySubProjectId: ObjectId,
    picAssetId: ObjectId,
  ) {
    if (legacySubProjectId.equals(picAssetId)) return;
    const now = new Date();
    await db.collection(MV_FILES_FILES_COLLECTION).updateMany(
      {
        "metadata.projectId": projectId,
        "metadata.scope": "asset-images",
        "metadata.subProjectId": legacySubProjectId,
      },
      {
        $set: { "metadata.picAssetId": picAssetId, "metadata.updatedAt": now },
        $unset: { "metadata.subProjectId": "" },
      },
    );
    await db.collection(MV_FILES_FILES_COLLECTION).updateMany(
      {
        "metadata.projectId": projectId,
        "metadata.scope": "asset-images",
        "metadata.picAssetId": legacySubProjectId,
      },
      { $set: { "metadata.picAssetId": picAssetId, "metadata.updatedAt": now } },
    );
  }

  private async migratePhotosTreeSubProjectsToItems(
    db: Awaited<ReturnType<typeof getMongoDb>>,
  ) {
    const subProjects = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    const items = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    const photoAssets = db.collection<AssetDoc>(ASSETS_COLLECTION);
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
      } as Filter<MvItemDoc>)
      .toArray()) as MvSubProjectMongoDoc[];

    if (roots.length === 0) return;

    const projectIds = Array.from(
      new Map(roots.map((root) => [root.projectId.toString(), root.projectId])).values(),
    );
    const legacyRows = (await subProjects
      .find({ projectId: { $in: projectIds } })
      .toArray()) as MvSubProjectMongoDoc[];
    if (legacyRows.length === 0) return;

    const legacyChildrenByParent = new Map<string, MvSubProjectMongoDoc[]>();
    for (const row of legacyRows) {
      const parent = getParentIdFromDoc(row);
      if (parent == null) continue;
      const key = this.photosTreeParentKey(row.projectId, parent);
      const bucket = legacyChildrenByParent.get(key);
      if (bucket) bucket.push(row);
      else legacyChildrenByParent.set(key, [row]);
    }

    const orderedLegacyPhotosRows: MvSubProjectMongoDoc[] = [];
    const visited = new Set<string>();
    const queue = roots.map((root) => ({
      projectId: root.projectId,
      folderId: root._id,
    }));
    while (queue.length > 0) {
      const current = queue.shift()!;
      const children =
        legacyChildrenByParent.get(this.photosTreeParentKey(current.projectId, current.folderId)) ??
        [];
      for (const child of children) {
        const idKey = child._id.toString();
        if (visited.has(idKey)) continue;
        visited.add(idKey);
        orderedLegacyPhotosRows.push(child);
        queue.push({ projectId: child.projectId, folderId: child._id });
      }
    }

    if (orderedLegacyPhotosRows.length === 0) return;

    const existingItems = (await items
      .find({ projectId: { $in: projectIds } })
      .toArray()) as MvSubProjectMongoDoc[];
    const itemIdByLocation = new Map<string, ObjectId>();
    for (const item of existingItems) {
      itemIdByLocation.set(
        this.photosTreeLocationKey(
          item.projectId,
          getParentIdFromDoc(item) ?? null,
          item.name,
        ),
        item._id,
      );
    }

    const parentRedirects = new Map<string, ObjectId>();
    let movedFolders = 0;
    let mergedFolders = 0;
    let removedAssetMirrors = 0;

    for (const legacy of orderedLegacyPhotosRows) {
      const originalParent = getParentIdFromDoc(legacy) ?? null;
      const redirectedParent =
        originalParent != null
          ? parentRedirects.get(originalParent.toString()) ?? originalParent
          : null;
      const locationKey = this.photosTreeLocationKey(
        legacy.projectId,
        redirectedParent,
        legacy.name,
      );
      const existingItemId = itemIdByLocation.get(locationKey);

      if (existingItemId && !existingItemId.equals(legacy._id)) {
        await this.redirectPhotosFolderReferences(db, legacy.projectId, legacy._id, existingItemId);
        await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
        parentRedirects.set(legacy._id.toString(), existingItemId);
        mergedFolders += 1;
        continue;
      }

      const legacyHasChildren =
        legacyChildrenByParent.get(this.photosTreeParentKey(legacy.projectId, legacy._id))?.length ??
        0;
      const matchingPicAsset =
        redirectedParent != null
          ? await photoAssets.findOne({
              projectId: legacy.projectId,
              parent: redirectedParent,
              name: legacy.name,
              ...MV_PHOTO_FOLDER_FILTER,
            })
          : null;
      if (matchingPicAsset && legacyHasChildren === 0) {
        await this.retargetLegacyAssetMirrorFiles(
          db,
          legacy.projectId,
          legacy._id,
          matchingPicAsset._id,
        );
        await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
        removedAssetMirrors += 1;
        continue;
      }

      const now = new Date();
      await items.updateOne(
        { _id: legacy._id, projectId: legacy.projectId } as Filter<MvItemDoc>,
        {
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
        } as never,
        { upsert: true },
      );
      await subProjects.deleteOne({ _id: legacy._id, projectId: legacy.projectId });
      itemIdByLocation.set(locationKey, legacy._id);
      movedFolders += 1;
    }

    if (movedFolders > 0 || mergedFolders > 0 || removedAssetMirrors > 0) {
      this.logger.log(
        `Migrated asset-images tree from mv_subprojects: moved=${movedFolders}, merged=${mergedFolders}, removedAssetMirrors=${removedAssetMirrors}`,
      );
    }
  }

  async onModuleInit() {
    const db = await getMongoDb();
    await this.dropAbandonedLegacyPhotoStorageCollection(db);
    const mvCol = db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION);
    await mvCol.createIndex({ companyId: 1 }).catch(() => undefined);
    await mvCol.createIndex({ companyId: 1, createdAt: -1 }).catch(() => undefined);
    await mvCol.createIndex({ userId: 1 }).catch(() => undefined);
    await mvCol
      .updateMany(
        { $or: [{ locations: { $exists: false } }, { locations: null }] } as Filter<MvProjectDoc>,
        { $set: { locations: [] } },
      )
      .catch(() => undefined);
    await mvCol
      .updateMany(
        { $or: [{ contacts: { $exists: false } }, { contacts: null }] } as Filter<MvProjectDoc>,
        { $set: { contacts: [] } },
      )
      .catch(() => undefined);

    const { userCompanyMemberships } = getAuthCollections(db);
    const missingCompanyFilter = {
      $or: [
        { companyId: { $exists: false } },
        { companyId: null },
        { companyId: "" },
      ],
    } as Filter<MvProjectDoc>;
    const orphans = await mvCol
      .find(missingCompanyFilter)
      .project({ _id: 1, userId: 1 })
      .toArray();
    const now = new Date();
    for (const p of orphans) {
      const uid = tryCoerceToObjectId(p.userId);
      if (!uid) continue;
      /** عضوية واحدة حتمية حتى لا يُنسَخ نفس المشروع لعدة شركات عند وجود المستخدم في أكثر من شركة. */
      const mems = await userCompanyMemberships
        .find({ userId: uid })
        .sort({ createdAt: 1 })
        .toArray();
      if (mems.length === 0) continue;
      const chosenCompanyId = mems[0]!.companyId;
      await mvCol.updateOne(
        { _id: p._id },
        { $set: { companyId: chosenCompanyId, updatedAt: now } },
      );
    }

    const sp = db.collection(MV_SUBPROJECTS_COLLECTION);
    const photoAssets = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const itCol = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    await this.migratePhotoFolderAssetsRemoveSubProjectIdField(db);
    await photoAssets.createIndex({ projectId: 1, parent: 1 }).catch(() => undefined);
    await itCol.createIndex({ projectId: 1 }).catch(() => undefined);
    const toRename = await sp
      .find({ parentSubProjectId: { $exists: true } } as Filter<Record<string, unknown>>)
      .toArray();
    for (const row of toRename) {
      const pse = (row as { parentSubProjectId?: ObjectId }).parentSubProjectId;
      if (!pse) continue;
      await sp.updateOne(
        { _id: row._id },
        { $set: { parent: pse }, $unset: { parentSubProjectId: "" } },
      );
    }
    await sp
      .updateMany(
        {
          $and: [
            { parent: { $exists: false } },
            { parentSubProjectId: { $exists: false } },
          ],
        },
        { $set: { parent: null, updatedAt: new Date() } },
      )
      .catch(() => undefined);

    const photosRootMvFilter: Filter<Record<string, unknown>> = {
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
    const legacyPhotosInMv = await sp.find(photosRootMvFilter as never).toArray();
    for (const leg of legacyPhotosInMv) {
      const d = leg as unknown as MvSubProjectMongoDoc;
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
        } as never);
        await sp.deleteOne({ _id: d._id, projectId: d.projectId });
      } catch (e) {
        this.logger.warn(
          `migrate 2.صور المعاينة to items: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    try {
      const picIdByProject = await photoAssets
        .aggregate<{ _id: ObjectId; picIds: ObjectId[] }>([
          { $match: MV_PHOTO_FOLDER_FILTER },
          { $group: { _id: "$projectId", picIds: { $addToSet: "$_id" } } },
        ])
        .toArray();
      for (const row of picIdByProject) {
        if (row._id == null || !row.picIds?.length) continue;
        await sp.deleteMany({ projectId: row._id, _id: { $in: row.picIds } });
      }
    } catch (e) {
      this.logger.warn(
        `Remove mv_subprojects rows duplicated with photo-folder asset _id: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
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
      const d = doc as MvSubProjectMongoDoc & { parentSubProjectId?: ObjectId };
      if (!getParentIdFromDoc(d)) continue;
      const p0 = getParentIdFromDoc(d) as ObjectId;
      const hasPic = await photoAssets.findOne({
        projectId: d.projectId,
        parent: p0,
        name: d.name,
        ...MV_PHOTO_FOLDER_FILTER,
      });
      if (hasPic) {
        await sp.updateOne(
          { _id: d._id },
          {
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
          },
        );
        continue;
      }
      const p = getParentIdFromDoc(d) as ObjectId;
      const pad: PicAssetDoc = {
        projectId: d.projectId,
        parent: p,
        name: d.name,
        createdAt: d.createdAt,
        updatedAt: nowM,
        isAssetFolder: true,
        writtenDescription: (d as { writtenDescription?: string | null }).writtenDescription ?? null,
        condition: (d as { condition?: string | null }).condition ?? null,
        assetType: ((d as { assetType?: AssetType }).assetType ?? "other") as AssetType,
        brand: (d as { brand?: string | null }).brand ?? null,
        code: (d as { code?: string | null }).code ?? null,
        model: (d as { model?: string | null }).model ?? null,
        manufactureYear: (d as { manufactureYear?: number | null }).manufactureYear ?? null,
        kilometersDriven: (d as { kilometersDriven?: number | null }).kilometersDriven ?? null,
        isPresent: (d as { isPresent?: boolean }).isPresent !== false,
        createdBy: tryCoerceToObjectId((d as { createdBy?: unknown }).createdBy) ?? null,
        images: (d as { images?: ObjectId[] }).images ?? [],
        voiceNotes: (d as { voiceNotes?: ObjectId[] }).voiceNotes ?? [],
        isDone: (d as { isDone?: boolean }).isDone === true,
      };
      const shell = buildPicAssetDocument(
        pad.projectId,
        pad.parent,
        pad.name,
        nowM,
        pad.createdBy,
      );
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
        isDone: pad.isDone,
        createdAt: pad.createdAt,
        importedAt: pad.createdAt,
        updatedAt: pad.updatedAt,
      });
      await sp.updateOne(
        { _id: d._id },
        {
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
        },
      );
    }

    await this.migratePhotosTreeSubProjectsToItems(db);
  }

  /**
   * عرض المشاريع حسب الشركة فقط: `companyId` يطابق الشركة النشطة.
   * لا يُستخدم `userId` في التصفية (كان يسبب ظهور مشروع واحد لعدة شركات إذا كان المنشئ عضوًا فيها).
   */
  private buildProjectsVisibleToCompanyFilter(companyIdStr: string): Filter<MvProjectDoc> {
    const coId = tryParseObjectId(companyIdStr);
    if (!coId) return { _id: { $in: [] } };

    return {
      $or: [
        { companyId: coId },
        { companyId: coId.toString() },
      ],
    } as Filter<MvProjectDoc>;
  }

  private assertProjectInScope(project: MvProjectDoc, ctx: MvAccessContext): void {
    if (ctx.isSuperAdmin) return;
    if (!ctx.companyId) {
      throw new NotFoundException("Project not found");
    }
    const ctxCo = tryParseObjectId(ctx.companyId);
    if (!ctxCo) {
      throw new NotFoundException("Project not found");
    }
    if (mvProjectSharesCompany(project, ctxCo)) {
      return;
    }
    throw new NotFoundException("Project not found");
  }

  private async assertInspectorAccessToFolderId(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    folderId: ObjectId,
    ctx: MvAccessContext,
  ) {
    if (ctx.userRole !== "inspector") return;
    const mvList = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find({ projectId })
      .toArray();
    const itemList = await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .find({ projectId })
      .toArray();
    const picList = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
      .toArray();
    const fromMv: FolderTreeEntry[] = mvList.map((m) => {
      const p = getParentIdFromDoc(m);
      return {
        _id: m._id.toString(),
        name: m.name,
        parent: p != null ? p.toString() : null,
      };
    });
    const fromItems: FolderTreeEntry[] = itemList.map((m) => {
      const p = getParentIdFromDoc(m);
      return {
        _id: m._id.toString(),
        name: m.name,
        parent: p != null ? p.toString() : null,
      };
    });
    const mvKeySet = new Set<string>();
    for (const m of mvList) {
      const k = picMatchKeyForMvSub(m as MvSubProjectMongoDoc);
      if (k) mvKeySet.add(k);
    }
    for (const m of itemList) {
      const k = picMatchKeyForMvSub(m as MvSubProjectMongoDoc);
      if (k) mvKeySet.add(k);
    }
    const standalonePics = (picList as PicAssetMongoDoc[]).filter(
      (p) => !mvKeySet.has(picMatchKeyForPicDoc(p)),
    );
    const fromPics: FolderTreeEntry[] = standalonePics
      .filter((p) => p.parent != null)
      .map((p) => ({
        _id: p._id.toString(),
        name: p.name ?? "",
        parent: p.parent!.toString(),
      }));
    const combined = [...fromMv, ...fromItems, ...fromPics];
    const allowed = new Set(
      filterFolderEntriesForInspector(
        combined,
        DEFAULT_PHOTOS_SUBFOLDER_NAME,
      ).map((e) => e._id),
    );
    if (!allowed.has(folderId.toString())) {
      throw new NotFoundException("Sub-project not found");
    }
  }

  private async loadProjectForAccess(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    ctx: MvAccessContext,
  ): Promise<MvProjectMongoDoc> {
    const project = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id: projectId });
    if (!project) throw new NotFoundException("Project not found");
    this.assertProjectInScope(project, ctx);
    return project;
  }

  /**
   * مجلدات أصول الصور فقط — وثائق ‎`assets`‎ ذات ‎`isAssetFolder`‎ دون ‎`mv_subprojects`‎.
   */
  private async upsertPicAssetFoldersOnly(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    photosParentId: ObjectId,
    names: string[],
    createdBy: ObjectId | null,
  ): Promise<{
    created: PicAssetMongoDoc[];
    existing: PicAssetMongoDoc[];
  }> {
    const uniqueNames = Array.from(
      new Set(names.map((n) => normalizeSubProjectName(n)).filter(Boolean)),
    );
    if (uniqueNames.length === 0) {
      return { created: [], existing: [] };
    }
    const pa = db.collection<AssetDoc>(ASSETS_COLLECTION);
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
    const created: PicAssetMongoDoc[] = [];
    for (const name of toCreate) {
      const ins = buildPicAssetDocument(
        projectId,
        photosParentId,
        name,
        now,
        createdBy,
      );
      const r = await pa.insertOne(ins);
      const row = await pa.findOne({ _id: r.insertedId });
      if (row) created.push(row as PicAssetMongoDoc);
    }
    return { created, existing: existing as PicAssetMongoDoc[] };
  }

  private async upsertSubProjects(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    names: string[],
    parentId?: ObjectId,
    newDocExtras?: Partial<MvSubProjectDoc>,
  ) {
    const uniqueNames = Array.from(
      new Set(names.map((name) => normalizeSubProjectName(name)).filter(Boolean)),
    );
    if (uniqueNames.length === 0) {
      return { created: [] as MvSubProjectMongoDoc[], existing: [] as MvSubProjectMongoDoc[] };
    }

    const filter: Record<string, unknown> = {
      projectId,
      name: { $in: uniqueNames },
    };
    if (parentId) {
      filter.$or = [
        { parent: parentId },
        { parentSubProjectId: parentId } as Record<string, unknown>,
      ];
    } else {
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
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find(filter)
      .toArray();
    const existingNames = new Set(existing.map((doc) => normalizeSubProjectName(doc.name)));
    const toCreate = uniqueNames.filter((name) => !existingNames.has(name));

    const now = new Date();
    const extras = newDocExtras ?? {};
    const docs: MvSubProjectDoc[] = toCreate.map((name) => ({
      ...extras,
      projectId,
      parent: parentId === undefined ? null : parentId,
      name,
      createdAt: now,
      updatedAt: now,
    }));

    const created: MvSubProjectMongoDoc[] = [];
    if (toCreate.length > 0) {
      const result = await db
        .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
        .insertMany(docs);

      toCreate.forEach((_, index) => {
        const doc = docs[index]!;
        const _id = result.insertedIds[index]!;
        created.push({ _id, ...doc });
      });
    }

    return { created, existing };
  }

  private async upsertItemsFolders(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    names: string[],
    parentId?: ObjectId,
    newDocExtras?: Partial<MvItemDoc>,
  ) {
    const uniqueNames = Array.from(
      new Set(names.map((name) => normalizeSubProjectName(name)).filter(Boolean)),
    );
    if (uniqueNames.length === 0) {
      return { created: [] as MvSubProjectMongoDoc[], existing: [] as MvSubProjectMongoDoc[] };
    }

    const filter: Record<string, unknown> = {
      projectId,
      name: { $in: uniqueNames },
    };
    if (parentId) {
      filter.$or = [
        { parent: parentId },
        { parentSubProjectId: parentId } as Record<string, unknown>,
      ];
    } else {
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

    const items = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    const subProjects = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    const existingItems = (await items.find(filter).toArray()) as MvSubProjectMongoDoc[];

    const existingNames = new Set(existingItems.map((doc) => normalizeSubProjectName(doc.name)));
    const legacySubProjects = (await subProjects.find(filter).toArray()) as MvSubProjectMongoDoc[];
    const movedLegacy: MvSubProjectMongoDoc[] = [];
    for (const legacy of legacySubProjects) {
      const normalized = normalizeSubProjectName(legacy.name);
      if (!normalized || existingNames.has(normalized)) continue;
      const parent = getParentIdFromDoc(legacy);
      const docForItems: MvItemDoc & { _id: ObjectId } = {
        _id: legacy._id,
        projectId: legacy.projectId,
        parent: parent ?? null,
        name: legacy.name,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
        ...(newDocExtras ?? {}),
      };
      await items.updateOne(
        { _id: legacy._id, projectId },
        { $setOnInsert: docForItems },
        { upsert: true },
      );
      await subProjects.deleteOne({ _id: legacy._id, projectId });
      movedLegacy.push(docForItems as MvSubProjectMongoDoc);
      existingNames.add(normalized);
    }

    const toCreate = uniqueNames.filter((name) => !existingNames.has(name));
    const now = new Date();
    const extras = newDocExtras ?? {};
    const docs: MvItemDoc[] = toCreate.map((name) => ({
      ...extras,
      projectId,
      parent: parentId === undefined ? null : parentId,
      name,
      createdAt: now,
      updatedAt: now,
    }));

    const created: MvSubProjectMongoDoc[] = [];
    if (toCreate.length > 0) {
      const result = await items.insertMany(docs);
      toCreate.forEach((_, index) => {
        const doc = docs[index]!;
        const _id = result.insertedIds[index]!;
        created.push({ _id, ...doc });
      });
    }

    return { created, existing: [...existingItems, ...movedLegacy] };
  }

  private async collectDescendantSubProjectIds(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    rootId: ObjectId,
  ) {
    const subs = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find({ projectId })
      .project({ _id: 1, parent: 1, parentSubProjectId: 1 })
      .toArray();
    const items = await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .find({ projectId })
      .project({ _id: 1, parent: 1, parentSubProjectId: 1 })
      .toArray();

    const childrenByParent = new Map<string, ObjectId[]>();
    for (const sub of [...subs, ...items]) {
      const par = getParentIdFromDoc(sub);
      if (par == null) continue;
      const key = par.toString();
      const bucket = childrenByParent.get(key);
      if (bucket) bucket.push(sub._id);
      else childrenByParent.set(key, [sub._id]);
    }

    const ids: ObjectId[] = [];
    const queue: ObjectId[] = [rootId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      ids.push(current);
      const children = childrenByParent.get(current.toString()) ?? [];
      queue.push(...children);
    }
    return ids;
  }

  /** شجرة مجلدات الصور في ‎assets‎ ابتداءً من ‎rootPicId‎ (يشمل الجذر). */
  private async collectDescendantPicAssetIds(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    rootPicId: ObjectId,
  ) {
    const pics = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
      .project({ _id: 1, parent: 1 })
      .toArray();
    const childrenByParent = new Map<string, ObjectId[]>();
    for (const p of pics) {
      if (p.parent == null) continue;
      const key = p.parent.toString();
      const bucket = childrenByParent.get(key);
      if (bucket) bucket.push(p._id);
      else childrenByParent.set(key, [p._id]);
    }
    const out: ObjectId[] = [];
    const queue: ObjectId[] = [rootPicId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      out.push(current);
      const children = childrenByParent.get(current.toString()) ?? [];
      queue.push(...children);
    }
    return out;
  }

  /**
   * عند حذف مجلدات ‎mv‎: حذف وثائق مجلد الصور في ‎assets‎ المطابقة بـ ‎(parent, name)‎
   * وأيضاً المجلدات التي ‎parent‎ يشير إلى ‎mv‎ أو ‎pic‎ يُحذف.
   */
  private async collectAllPicForMvDeletion(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    mvIds: ObjectId[],
  ) {
    const sp = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    const it = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    const all = (await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find({ projectId, ...MV_PHOTO_FOLDER_FILTER })
      .toArray()) as PicAssetMongoDoc[];
    const mvIdSet = new Set(mvIds.map((id) => id.toString()));
    const toDel = new Set<string>();
    for (const mid of mvIds) {
      const m =
        (await sp.findOne({ _id: mid, projectId })) ?? (await it.findOne({ _id: mid, projectId }));
      if (!m) continue;
      const pFolder = getParentIdFromDoc(m);
      if (pFolder == null) continue;
      for (const pRow of all) {
        if (pRow.parent == null) continue;
        if (
          pRow.parent.equals(pFolder) &&
          normalizeSubProjectName(pRow.name ?? "") === normalizeSubProjectName(m.name)
        ) {
          toDel.add(pRow._id.toString());
        }
      }
    }
    for (const p of all) {
      if (p.parent == null) continue;
      if (mvIdSet.has(p.parent.toString())) {
        toDel.add(p._id.toString());
      }
    }
    let added = true;
    while (added) {
      added = false;
      for (const p of all) {
        if (toDel.has(p._id.toString())) continue;
        if (p.parent == null) continue;
        if (toDel.has(p.parent.toString())) {
          toDel.add(p._id.toString());
          added = true;
        }
      }
    }
    const candidate = [...toDel].map((s) => new ObjectId(s));
    const existing = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .find({ projectId, _id: { $in: candidate }, ...MV_PHOTO_FOLDER_FILTER })
      .project({ _id: 1 })
      .toArray();
    return existing.map((d) => d._id);
  }

  /** المجلد (mv أو ‎items‎ أو pic) داخل نطاق ‎2.صور المعاينة‎ (الجذر أو أحفاده). */
  private async isInPhotosHoldingSubtree(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    photosRootId: ObjectId,
    folderId: ObjectId,
  ) {
    if (folderId.equals(photosRootId)) return true;
    const sp = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    const it = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    const pa = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const seen = new Set<string>();
    let cur: ObjectId | null = folderId;
    while (cur) {
      if (cur.equals(photosRootId)) return true;
      if (seen.has(cur.toString())) return false;
      seen.add(cur.toString());
      const mv = await sp.findOne({ _id: cur, projectId });
      if (mv) {
        const parentRef = getParentIdFromDoc(mv);
        if (parentRef == null) return false;
        cur = parentRef;
        continue;
      }
      const itDoc = await it.findOne({ _id: cur, projectId });
      if (itDoc) {
        const parentRef = getParentIdFromDoc(itDoc);
        if (parentRef == null) return false;
        cur = parentRef;
        continue;
      }
      const picDoc: PicAssetMongoDoc | null =
        (await pa.findOne({ _id: cur, projectId, ...MV_PHOTO_FOLDER_FILTER })) as PicAssetMongoDoc | null;
      if (picDoc) {
        const pPar = picDoc.parent;
        if (pPar == null) return false;
        cur = pPar;
        continue;
      }
      return false;
    }
    return false;
  }

  private async assertPicAssetFolderCanReceiveImages(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    photosRootId: ObjectId,
    picFolder: Pick<PicAssetMongoDoc, "_id" | "parent">,
  ) {
    const parent = picFolder.parent;
    if (!parent) {
      throw new BadRequestException("مجلد الأصل يجب أن يكون داخل صور المعاينة.");
    }
    if (parent.equals(photosRootId)) return;

    const parentIsNormalFolder =
      (await db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION).findOne({
        _id: parent,
        projectId,
      })) ??
      (await db.collection<MvItemDoc>(MV_ITEMS_COLLECTION).findOne({
        _id: parent,
        projectId,
      }));

    if (!parentIsNormalFolder) {
      throw new BadRequestException("مجلد الأصل يجب أن يكون تحت الجذر أو تحت مجلد عادي.");
    }
    const parentUnderPhotos = await this.isInPhotosHoldingSubtree(db, projectId, photosRootId, parent);
    if (!parentUnderPhotos) {
      throw new BadRequestException("مجلد الأصل يجب أن يكون داخل صور المعاينة.");
    }
  }

  /**
   * إنشاء وثيقة ‎2.صور المعاينة‎ في ‎`items`‎ (تُستدعى عند إنشاء مشروع جديد).
   */
  private async ensureInspectionPhotosItemInItems(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
  ) {
    const it = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
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
    if (existing) return existing;

    const now = new Date();
    const ins = await it.insertOne({
      projectId,
      parent: null,
      name: DEFAULT_PHOTOS_SUBFOLDER_NAME,
      createdAt: now,
      updatedAt: now,
    } as never);
    const row = await it.findOne({ _id: ins.insertedId! });
    if (!row) throw new BadRequestException("Could not prepare the inspection photos folder");
    return row;
  }

  private async ensurePhotosRootFolder(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
  ) {
    const it = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
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
    if (fromItems) return fromItems;

    const legacy = await db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION).findOne({
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
      const doc: MvItemDoc = {
        projectId: legacy.projectId,
        parent: getParentIdFromDoc(legacy as MvSubProjectMongoDoc) ?? null,
        name: legacy.name,
        createdAt: legacy.createdAt,
        updatedAt: legacy.updatedAt,
      };
      try {
        await it.insertOne({ _id: legacy._id, ...doc } as never);
      } catch (e: unknown) {
        const code = e && typeof e === "object" ? (e as { code?: number }).code : undefined;
        if (code !== 11000) throw e;
      }
      await db
        .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
        .deleteOne({ _id: legacy._id, projectId });
      const moved = await it.findOne({ _id: legacy._id, projectId });
      if (moved) return moved;
    }
    return this.ensureInspectionPhotosItemInItems(db, projectId);
  }

  private getFilesBucket(db: Awaited<ReturnType<typeof getMongoDb>>) {
    return new GridFSBucket(db, { bucketName: MV_FILES_BUCKET });
  }

  private async assertSubProjectContext(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    subProjectId: ObjectId | undefined,
    ctx: MvAccessContext,
  ) {
    await this.loadProjectForAccess(db, projectId, ctx);

    if (subProjectId) {
      const inMv = await db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION).findOne({
        _id: subProjectId,
        projectId,
      });
      const inItem = await db.collection<MvItemDoc>(MV_ITEMS_COLLECTION).findOne({
        _id: subProjectId,
        projectId,
      });
      const inPic = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
        _id: subProjectId,
        projectId,
        ...MV_PHOTO_FOLDER_FILTER,
      });
      if (!inMv && !inItem && !inPic) {
        throw new NotFoundException("Sub-project not found");
      }
      if (ctx.userRole === "inspector") {
        await this.assertInspectorAccessToFolderId(db, projectId, subProjectId, ctx);
      }
    }
  }

  private async deleteStoredFiles(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    filter: Record<string, unknown>,
  ) {
    const bucket = this.getFilesBucket(db);
    const files = await db
      .collection<{ _id: ObjectId; metadata?: MvStoredFileMetadata }>(MV_FILES_FILES_COLLECTION)
      .find(filter, { projection: { _id: 1, metadata: 1 } })
      .toArray();

    for (const file of files) {
      const meta = file.metadata;
      if (meta?.storage === "digitalocean" && meta.spacesKey?.trim()) {
        try {
          await this.inspectorSpaces.deleteObject(meta.spacesKey.trim());
        } catch (err) {
          this.logger.warn(
            `deleteStoredFiles Spaces: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await db.collection(MV_FILES_FILES_COLLECTION).deleteOne({ _id: file._id });
      } else {
        try {
          await bucket.delete(file._id);
        } catch (err) {
          this.logger.warn(
            `deleteStoredFiles GridFS: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return files.length;
  }

  private async getStoredFileDoc(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    fileId: ObjectId,
  ) {
    const file = await db
      .collection<{
        _id: ObjectId;
        filename?: string;
        length?: number;
        uploadDate?: Date;
        metadata?: MvStoredFileMetadata;
      }>(MV_FILES_FILES_COLLECTION)
      .findOne({
        _id: fileId,
        "metadata.projectId": projectId,
      });

    if (!file) throw new NotFoundException("File not found");
    return file;
  }
  /* ───────── Projects ───────── */

  /**
   * Computes display numbers for projects that were created before the
   * counter was introduced. Within each company, missing values are filled
   * in ascending `createdAt` order so the visible numbering stays stable.
   */
  /**
   * Lazily persists a `displayNumber` for a single project that was created
   * before the counter existed (legacy data). Returns the resolved number.
   */
  private async ensureDisplayNumberForProject(
    db: Db,
    project: { _id: ObjectId; companyId?: ObjectId | string; displayNumber?: number },
  ): Promise<number | null> {
    if (typeof project.displayNumber === "number" && Number.isFinite(project.displayNumber)) {
      return project.displayNumber;
    }
    const companyIdRaw = project.companyId;
    let companyOid: ObjectId | null = null;
    if (companyIdRaw instanceof ObjectId) {
      companyOid = companyIdRaw;
    } else if (typeof companyIdRaw === "string" && companyIdRaw.trim()) {
      companyOid = tryParseObjectId(companyIdRaw.trim());
    }
    if (!companyOid) return null;
    try {
      // Count older projects (created before this one) within the same company
      // to deterministically assign a number compatible with list ordering.
      const projectDoc = await db
        .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
        .findOne({ _id: project._id }, { projection: { createdAt: 1 } });
      const createdAt = projectDoc?.createdAt instanceof Date ? projectDoc.createdAt : new Date(0);
      const olderCount = await db
        .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
        .countDocuments({ companyId: companyOid, createdAt: { $lt: createdAt } });
      const next = olderCount + 1;
      await db
        .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
        .updateOne({ _id: project._id }, { $set: { displayNumber: next } });
      // Sync the company counter if it is behind, so future creations stay monotonic.
      try {
        await getAuthCollections(db).companies.updateOne(
          { _id: companyOid, $or: [{ projectSequenceCounter: { $exists: false } }, { projectSequenceCounter: { $lt: next } }] },
          { $set: { projectSequenceCounter: next } },
        );
      } catch {
        // counter sync is best-effort
      }
      return next;
    } catch (err) {
      this.logger.warn(
        `ensureDisplayNumberForProject failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Computes display numbers for projects that were created before the
   * counter was introduced. Within each company, missing values are filled
   * in ascending `createdAt` order so the visible numbering stays stable.
   */
  private static fillMissingProjectDisplayNumbers<
    T extends {
      _id: string;
      companyId: string | null;
      displayNumber: number | null;
      createdAt: string;
    },
  >(rows: T[]): T[] {
    const byCompany = new Map<string, T[]>();
    for (const row of rows) {
      const key = row.companyId ?? "__no_company__";
      const bucket = byCompany.get(key) ?? [];
      bucket.push(row);
      byCompany.set(key, bucket);
    }
    for (const bucket of byCompany.values()) {
      const taken = new Set(
        bucket
          .map((r) => r.displayNumber)
          .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0),
      );
      const needsFill = bucket
        .filter((r) => r.displayNumber == null)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      let next = 1;
      for (const r of needsFill) {
        while (taken.has(next)) next += 1;
        r.displayNumber = next;
        taken.add(next);
        next += 1;
      }
    }
    return rows;
  }

  async listProjects(ctx: MvAccessContext) {
    if (!ctx.isSuperAdmin) {
      if (!ctx.userId) {
        throw new UnauthorizedException("يجب تسجيل الدخول لعرض مشاريع التقييم.");
      }
      if (!ctx.companyId) {
        throw new ForbiddenException(
          "يجب أن يكون حسابك مرتبطاً بشركة لعرض مشاريع تقييم الآلات والمعدات.",
        );
      }
    }

    const db = await getMongoDb();
    const col = db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION);
    /** تقليل حجم نقل المستندات — الحقول المستخدمة في الاستجابة فقط */
    const projectListProject = {
      name: 1,
      companyId: 1,
      displayNumber: 1,
      createdAt: 1,
      updatedAt: 1,
      userId: 1,
      workflowStatus: 1,
      reportType: 1,
      locations: 1,
      contacts: 1,
      inspectionAssignments: 1,
    } as const;

    let projects: MvProjectMongoDoc[];
    if (ctx.isSuperAdmin) {
      projects = (await col
        .find({})
        .project(projectListProject)
        .sort({ createdAt: -1 })
        .toArray()) as MvProjectMongoDoc[];
    } else if (ctx.companyId) {
      const filter = this.buildProjectsVisibleToCompanyFilter(ctx.companyId);
      projects = (await col
        .find(filter)
        .project(projectListProject)
        .sort({ createdAt: -1 })
        .toArray()) as MvProjectMongoDoc[];
    } else {
      projects = [];
    }

    if (projects.length === 0) {
      return [];
    }

    const projectIds = projects.map((p) => p._id);
    const matchInProjects = { $match: { projectId: { $in: projectIds } } } as const;
    const groupByProject = { $group: { _id: "$projectId", count: { $sum: 1 } } } as const;

    const [counts, itemCounts, sheetAgg] = await Promise.all([
      db
        .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
        .aggregate<{ _id: ObjectId | null; count: number }>([matchInProjects, groupByProject])
        .toArray()
        .catch((err) => {
          this.logger.warn(
            `listProjects: subProject aggregate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [] as { _id: ObjectId | null; count: number }[];
        }),
      db
        .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
        .aggregate<{ _id: ObjectId | null; count: number }>([matchInProjects, groupByProject])
        .toArray()
        .catch((err) => {
          this.logger.warn(
            `listProjects: items aggregate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [] as { _id: ObjectId | null; count: number }[];
        }),
      db
        .collection<MvSheetDoc>(MV_SHEETS_COLLECTION)
        .aggregate<{ _id: ObjectId | null; count: number }>([matchInProjects, groupByProject])
        .toArray()
        .catch((err) => {
          this.logger.warn(
            `listProjects: sheet aggregate failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return [] as { _id: ObjectId | null; count: number }[];
        }),
    ]);

    const countMap = new Map(
      counts
        .filter((c) => c._id != null)
        .map((c) => [c._id!.toString(), toSafeNonNegativeInt(c.count)] as [string, number]),
    );
    const itemMap = new Map(
      itemCounts
        .filter((c) => c._id != null)
        .map((c) => [c._id!.toString(), toSafeNonNegativeInt(c.count)] as [string, number]),
    );
    const sheetMap = new Map(
      sheetAgg
        .filter((c) => c._id != null)
        .map((c) => [c._id!.toString(), toSafeNonNegativeInt(c.count)] as [string, number]),
    );

    const creatorIds = Array.from(
      new Set(
        projects
          .map((project) => tryCoerceToObjectId(project.userId))
          .filter((value): value is ObjectId => value != null),
      ),
    );

    const creatorNameMap = new Map<string, string>();
    if (creatorIds.length > 0) {
      try {
        const creatorRows = await getAuthCollections(db).users
          .find({ _id: { $in: creatorIds } })
          .project({ _id: 1, username: 1 })
          .toArray();
        for (const user of creatorRows) {
          if (user?._id == null) continue;
          creatorNameMap.set(user._id.toString(), String(user.username ?? ""));
        }
      } catch (err) {
        this.logger.warn(
          `listProjects: user lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const rows = projects
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
            if (c === undefined || c === null || c === "") return null;
            if (c instanceof ObjectId) return c.toString();
            return String(c).trim() || null;
          })(),
          displayNumber:
            typeof p.displayNumber === "number" && Number.isFinite(p.displayNumber)
              ? p.displayNumber
              : null,
          createdAt: mvProjectDateToIso(p.createdAt),
          updatedAt: mvProjectDateToIso(p.updatedAt),
          subProjectCount:
            toSafeNonNegativeInt(countMap.get(idStr)) + toSafeNonNegativeInt(itemMap.get(idStr)),
          sheetCount: toSafeNonNegativeInt(sheetMap.get(idStr)),
          workflowStatus: projectWorkflowStatus(p),
          reportType: projectReportType(p),
          locations: sanitizeProjectLocations(p.locations, false),
          contacts: sanitizeProjectContacts(p.contacts, false),
          inspectionAssignments: sanitizeInspectionAssignments(
            p.inspectionAssignments,
            sanitizeProjectLocations(p.locations, false),
          ).map(serializeInspectionAssignment),
          createdByUserId: (() => {
            const id = tryCoerceToObjectId(p.userId);
            return id?.toString() ?? (typeof p.userId === "string" ? p.userId : null);
          })(),
          createdByName: (() => {
            const id = tryCoerceToObjectId(p.userId);
            return id ? creatorNameMap.get(id.toString()) ?? null : null;
          })(),
        };
      })
      .filter(
        (row): row is NonNullable<typeof row> => row != null,
      );
    return MachineValuationService.fillMissingProjectDisplayNumbers(rows);
  }

  async createProject(
    name: string,
    ctx: MvAccessContext,
    companyIdForSuperAdmin?: string | null,
    reportTypeRaw?: string | null,
    locationsRaw?: unknown,
    contactsRaw?: unknown,
  ) {
    const n = name?.trim();
    if (!n) throw new BadRequestException("Project name is required");

    let resolvedCompanyId: ObjectId;
    if (ctx.isSuperAdmin) {
      const raw = companyIdForSuperAdmin?.trim();
      if (!raw) {
        throw new BadRequestException("companyId is required");
      }
      const coId = tryParseObjectId(raw);
      if (!coId) {
        throw new BadRequestException("Invalid companyId");
      }
      const dbCheck = await getMongoDb();
      const co = await getAuthCollections(dbCheck).companies.findOne({ _id: coId });
      if (!co) {
        throw new BadRequestException("Invalid companyId");
      }
      resolvedCompanyId = coId;
    } else {
      if (!ctx.userId) throw new UnauthorizedException("Login required");
      if (!ctx.companyId) {
        throw new ForbiddenException("Company membership required");
      }
      const cid = tryParseObjectId(ctx.companyId);
      if (!cid) {
        throw new ForbiddenException("Company membership required");
      }
      resolvedCompanyId = cid;
    }

    const uid = ctx.userId ? tryParseObjectId(ctx.userId) : null;

    const db = await getMongoDb();
    const now = new Date();
    const reportType = normalizeReportType(reportTypeRaw);
    let locations = sanitizeProjectLocations(locationsRaw);
    const contacts = mergeProjectContactsWithLocationPhones(contactsRaw, locations);
    locations = mergeProjectLocationsWithContacts(locations, contacts);

    /**
     * Atomically reserve the next per-company project sequence number so that
     * `displayNumber` is monotonic, stable, and unaffected by deletions.
     * Older companies that lack the counter will be backfilled to (existingProjects + 1).
     */
    const companiesCollection = getAuthCollections(db).companies;
    let displayNumber: number | undefined;
    try {
      const seqDoc = await companiesCollection.findOneAndUpdate(
        { _id: resolvedCompanyId },
        { $inc: { projectSequenceCounter: 1 }, $set: { updatedAt: now } },
        { returnDocument: "after", projection: { projectSequenceCounter: 1 } },
      );
      if (seqDoc) {
        const counter =
          typeof seqDoc.projectSequenceCounter === "number" && Number.isFinite(seqDoc.projectSequenceCounter)
            ? seqDoc.projectSequenceCounter
            : null;
        if (typeof counter === "number") {
          if (counter === 1) {
            // First sequence — but legacy projects may already exist without
            // a counter; rebase to existing count + 1 to avoid collisions.
            const existing = await db
              .collection<MvProjectDoc>(MV_PROJECTS_COLLECTION)
              .countDocuments({ companyId: resolvedCompanyId });
            if (existing > 0) {
              displayNumber = existing + 1;
              await companiesCollection.updateOne(
                { _id: resolvedCompanyId },
                { $set: { projectSequenceCounter: displayNumber } },
              );
            } else {
              displayNumber = 1;
            }
          } else {
            displayNumber = counter;
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `createProject: project sequence reservation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const doc: Omit<MvProjectDoc, "_id"> = {
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
    const { insertedId } = await db.collection(MV_PROJECTS_COLLECTION).insertOne(doc);
    const subfolderNames = DEFAULT_PROJECT_SUBFOLDERS.filter(
      (name) => name !== DEFAULT_PHOTOS_SUBFOLDER_NAME,
    );
    await this.upsertSubProjects(db, insertedId, [...subfolderNames] as string[]);
    await this.ensureInspectionPhotosItemInItems(db, insertedId);
    return {
      _id: insertedId.toString(),
      name: n,
      companyId: resolvedCompanyId.toString(),
      displayNumber: displayNumber ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      workflowStatus: "new" as const,
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

  async updateProject(
    id: string,
    ctx: MvAccessContext,
    body?: {
      workflowStatus?: string;
      name?: string;
      reportType?: string;
      reportData?: unknown;
      locations?: unknown;
      contacts?: unknown;
      inspectionAssignments?: unknown;
      valuationAccountingWorkspace?: unknown | null;
      valuationReadyExcelWorkspace?: unknown | null;
    } | null,
  ) {
    const db = await getMongoDb();
    const _id = toId(id);
    const currentProject = await this.loadProjectForAccess(db, _id, ctx);
    const now = new Date();
    const b = body ?? {};

    const $set: Record<string, unknown> = { updatedAt: now };

    if (b.workflowStatus !== undefined && b.workflowStatus !== null) {
      $set.workflowStatus = normalizeWorkflowStatus(b.workflowStatus);
    }

    if (b.name !== undefined) {
      const nextName = sanitizeOptionalText(b.name, 220);
      if (!nextName) throw new BadRequestException("Project name is required");
      $set.name = nextName;
    }

    if (b.reportType !== undefined && b.reportType !== null) {
      $set.reportType = normalizeReportType(b.reportType);
    }

    if (b.reportData !== undefined) {
      $set.reportData = sanitizeReportData(b.reportData);
    }

    let nextLocationsForContactMerge: MvProjectLocation[] | null = null;
    if (b.locations !== undefined) {
      nextLocationsForContactMerge = sanitizeProjectLocations(b.locations);
    }

    let nextContactsForLocationMerge: MvProjectContact[] | null = null;
    if (b.contacts !== undefined) {
      nextContactsForLocationMerge = mergeProjectContactsWithLocationPhones(
        b.contacts,
        nextLocationsForContactMerge ?? [],
      );
    } else if (
      nextLocationsForContactMerge?.some((location) => location.primaryPhone || location.secondaryPhone)
    ) {
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
      const assignmentLocations =
        nextLocationsForContactMerge ??
        sanitizeProjectLocations(currentProject.locations, false);
      $set.inspectionAssignments = sanitizeInspectionAssignments(
        b.inspectionAssignments,
        assignmentLocations,
        ctx.userId,
      );
    }

    if (b.valuationAccountingWorkspace !== undefined) {
      if (b.valuationAccountingWorkspace === null) {
        $set.valuationAccountingWorkspace = null;
      } else {
        $set.valuationAccountingWorkspace = sanitizeValuationAccountingWorkspaceForPersist(
          b.valuationAccountingWorkspace,
        );
      }
    }

    if (b.valuationReadyExcelWorkspace !== undefined) {
      if (b.valuationReadyExcelWorkspace === null) {
        $set.valuationReadyExcelWorkspace = null;
      } else {
        $set.valuationReadyExcelWorkspace = sanitizeValuationReadyExcelWorkspaceForPersist(
          b.valuationReadyExcelWorkspace,
        );
      }
    }

    if (Object.keys($set).length === 1) {
      throw new BadRequestException("No project fields to update");
    }

    const updated = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOneAndUpdate(
      { _id },
      { $set },
      { returnDocument: "after" },
    );
    if (!updated) throw new NotFoundException("Project not found");
    const updatedDisplayNumber = await this.ensureDisplayNumberForProject(db, updated);
    return {
      ok: true as const,
      project: {
        _id: updated._id.toString(),
        name: updated.name,
        companyId:
          updated.companyId instanceof ObjectId
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
        inspectionAssignments: sanitizeInspectionAssignments(
          updated.inspectionAssignments,
          sanitizeProjectLocations(updated.locations, false),
        ).map(serializeInspectionAssignment),
        createdByUserId:
          tryCoerceToObjectId(updated.userId)?.toString() ??
          (typeof updated.userId === "string" ? updated.userId : null),
        createdByName: null,
        inspectorFiles: normalizeInspectorFilesArray(updated.inspectorFiles).map(
          serializeInspectorFileForClient,
        ),
        valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(
          updated.valuationAccountingWorkspace,
        ),
        valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(
          updated.valuationReadyExcelWorkspace,
        ),
      },
      updatedAt: now.toISOString(),
    };
  }

  async getProject(
    id: string,
    ctx: MvAccessContext,
    opts?: { picAssetMode?: "full" | "summary" },
  ) {
    const db = await getMongoDb();
    const _id = toId(id);
    const project = await this.loadProjectForAccess(db, _id, ctx);
    const creatorOid = tryCoerceToObjectId(project.userId);
    const creator = creatorOid
      ? await getAuthCollections(db).users.findOne(
          { _id: creatorOid },
          { projection: { _id: 1, username: 1 } },
        )
      : null;

    const subProjects = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find({ projectId: _id })
      .sort({ createdAt: -1 })
      .toArray();

    const itemRows = await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .find({ projectId: _id })
      .sort({ createdAt: -1 })
      .toArray();

    const sheetCount = await db
      .collection<MvSheetDoc>(MV_SHEETS_COLLECTION)
      .countDocuments({ projectId: _id });

    const allSubs: MvSubProjectMongoDoc[] = [
      ...subProjects.map((s) => s as MvSubProjectMongoDoc),
      ...(itemRows as unknown as MvSubProjectMongoDoc[]),
    ];

    const picAssetMode = opts?.picAssetMode === "summary" ? "summary" : "full";

    const picRows: PicAssetWithMediaCounts[] =
      picAssetMode === "summary"
        ? ((await db
            .collection<AssetDoc>(ASSETS_COLLECTION)
            .aggregate<PicAssetWithMediaCounts>([
              { $match: { projectId: _id, ...MV_PHOTO_FOLDER_FILTER } },
              {
                $addFields: {
                  imageCount: { $size: { $ifNull: ["$images", []] } },
                  voiceNoteCount: { $size: { $ifNull: ["$voiceNotes", []] } },
                },
              },
              { $project: { images: 0, voiceNotes: 0 } },
            ])
            .toArray()) as PicAssetWithMediaCounts[])
        : ((await db
            .collection<AssetDoc>(ASSETS_COLLECTION)
            .find({ projectId: _id, ...MV_PHOTO_FOLDER_FILTER })
            .toArray()) as PicAssetWithMediaCounts[]);

    const serPic = (pi: PicAssetWithMediaCounts) =>
      picAssetMode === "summary" ? serializePicAssetSummary(pi) : serializePicAsset(pi);

    const mvKeySet = new Set<string>();
    for (const s of allSubs) {
      const k = picMatchKeyForMvSub(s);
      if (k) mvKeySet.add(k);
    }
    const picByKey = new Map<string, PicAssetWithMediaCounts>();
    for (const p of picRows) {
      picByKey.set(picMatchKeyForPicDoc(p), p);
    }

    const subsForApi = allSubs.filter(
      (s) => (s as { _id?: unknown })._id != null && (s as { projectId?: unknown }).projectId != null,
    );
    const mvWithPic = subsForApi.map((s) => {
      const k = picMatchKeyForMvSub(s);
      const pi = k ? picByKey.get(k) : undefined;
      const hasPicIds =
        pi != null &&
        (pi as { _id?: unknown })._id != null &&
        (pi as { projectId?: unknown }).projectId != null;
      return {
        ...serializeMvSubProject(s as MvSubProjectMongoDoc),
        picAsset: hasPicIds ? serPic(pi) : null,
      };
    });

    const standalonePics = picRows.filter((p) => !mvKeySet.has(picMatchKeyForPicDoc(p)));
    const picOnlyRows = standalonePics
      .filter((p) => (p as { _id?: unknown })._id != null && (p as { projectId?: unknown }).projectId != null)
      .map((p) => ({
        _id: (p._id as ObjectId).toString(),
        projectId: (p.projectId as ObjectId).toString(),
        parent: p.parent != null ? p.parent.toString() : "",
        name: p.name ?? "",
        createdAt: mvProjectDateToIso(
          (p as { createdAt?: unknown }).createdAt ?? p.importedAt ?? p.updatedAt,
        ),
        updatedAt: mvProjectDateToIso(p.updatedAt),
        picAsset: serPic(p),
      }));

    let merged = [...mvWithPic, ...picOnlyRows].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    if (ctx.userRole === "inspector") {
      const forInspector = filterSubProjectsForInspector(
        allSubs,
        DEFAULT_PHOTOS_SUBFOLDER_NAME,
      );
      const fromTree: FolderTreeEntry[] = forInspector.map((m) => {
        const p = getParentIdFromDoc(m);
        return {
          _id: m._id.toString(),
          name: m.name,
          parent: p != null ? p.toString() : null,
        };
      });
      const fromPics: FolderTreeEntry[] = standalonePics
        .filter((p) => p.parent != null)
        .map((p) => ({
          _id: p._id.toString(),
          name: p.name ?? "",
          parent: p.parent!.toString(),
        }));
      const allowed = new Set(
        filterFolderEntriesForInspector(
          [...fromTree, ...fromPics],
          DEFAULT_PHOTOS_SUBFOLDER_NAME,
        ).map((e) => e._id),
      );
      merged = merged.filter((row) => allowed.has(row._id));
    }

    const ensuredDisplayNumber = await this.ensureDisplayNumberForProject(db, project);
    return {
      project: {
        _id: project._id.toString(),
        name: project.name,
        companyId:
          project.companyId instanceof ObjectId
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
        inspectionAssignments: sanitizeInspectionAssignments(
          project.inspectionAssignments,
          sanitizeProjectLocations(project.locations, false),
        ).map(serializeInspectionAssignment),
        sheetCount,
        subProjectCount: merged.length,
        createdByUserId:
          creatorOid?.toString() ??
          (typeof project.userId === "string" ? project.userId : null),
        createdByName: creator?.username ?? null,
        inspectorFiles: normalizeInspectorFilesArray(project.inspectorFiles).map(
          serializeInspectorFileForClient,
        ),
        valuationAccountingWorkspace: sanitizeValuationAccountingWorkspaceForClient(
          project.valuationAccountingWorkspace,
        ),
        valuationReadyExcelWorkspace: sanitizeValuationReadyExcelWorkspaceForClient(
          project.valuationReadyExcelWorkspace,
        ),
      },
      subProjects: merged,
    };
  }

  private inspectorDownloadApiPath(projectId: string, entryId: string): string {
    return `/api/mv/projects/${projectId}/inspectorFiles/${encodeURIComponent(entryId)}/download`;
  }

  /** عند فقدان ‎gridFsFileId‎ في المستند أو عدم تطابق ‎ObjectId‎ مع ‎files.files‎ */
  private async findInspectorGridFsIdByEntryId(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    projectId: ObjectId,
    inspectorEntryId: string,
  ): Promise<ObjectId | null> {
    const doc = await db
      .collection<{ _id: ObjectId; metadata?: MvStoredFileMetadata }>(MV_FILES_FILES_COLLECTION)
      .findOne({
        "metadata.projectId": projectId,
        "metadata.scope": "mv-inspector",
        "metadata.inspectorEntryId": inspectorEntryId,
      });
    return doc?._id ?? null;
  }

  private async deleteInspectorBlobFromStores(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    entry: MvInspectorFileDoc,
  ): Promise<void> {
    if (entry.spacesKey) {
      try {
        await this.inspectorSpaces.deleteObject(entry.spacesKey);
      } catch (err) {
        this.logger.warn(
          `deleteInspectorBlob Spaces: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    if (entry.gridFsFileId != null) {
      const gid = tryParseObjectId(String(entry.gridFsFileId));
      if (gid) {
        try {
          await this.getFilesBucket(db).delete(gid);
        } catch (err) {
          this.logger.warn(
            `deleteInspectorBlob GridFS: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return;
    }
  }

  async listInspectorFiles(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(projectId);
    const project = await this.loadProjectForAccess(db, _id, ctx);
    const files = normalizeInspectorFilesArray(project.inspectorFiles);
    return {
      files: files.map(serializeInspectorFileForClient),
    };
  }

  async listProjectInspectors(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(projectId);
    const project = await this.loadProjectForAccess(db, _id, ctx);
    const companyObjectId =
      tryCoerceToObjectId(project.companyId) ??
      (ctx.companyId ? tryParseObjectId(ctx.companyId) : null);
    if (!companyObjectId) {
      return { inspectors: [] as { id: string; username: string; email: string | null; phone: string | null }[] };
    }

    const { users, userCompanyMemberships } = getAuthCollections(db);
    const memberLinks = await userCompanyMemberships.find({ companyId: companyObjectId }).toArray();
    const roleByUserId = new Map(memberLinks.map((m) => [m.userId.toString(), m.role]));
    const memberIds = memberLinks.map((m) => m.userId);
    if (memberIds.length === 0) {
      return { inspectors: [] as { id: string; username: string; email: string | null; phone: string | null }[] };
    }
    const rows = await users
      .find({ _id: { $in: memberIds } })
      .sort({ username: 1 })
      .limit(500)
      .toArray();

    return {
      inspectors: rows
        .filter(
          (u) =>
            normalizeRoleName(roleByUserId.get(u._id.toString())) === "inspector" ||
            normalizeRoleName(u.role) === "inspector",
        )
        .map((u) => ({
          id: u._id.toString(),
          username: String(u.username ?? ""),
          email: u.email ?? null,
          phone: u.phone ?? null,
        })),
    };
  }

  async listSystemInspectors(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(projectId);
    await this.loadProjectForAccess(db, _id, ctx);

    const { users, userProfiles } = getAuthCollections(db);
    const inspectorFilter = {
      $and: [
        { role: { $in: ["inspector", "Inspector"] } },
        {
          $or: [
            { company: null },
            { company: "" },
            { company: { $exists: false } },
          ],
        },
        { isBlocked: { $ne: true } },
      ],
    } as unknown as Filter<UserDoc>;

    const rows = await users
      .find(inspectorFilter)
      .project({
        _id: 1,
        username: 1,
        email: 1,
        phone: 1,
        role: 1,
        company: 1,
        isBlocked: 1,
        isPhoneVerified: 1,
        lastLoginAt: 1,
        createdAt: 1,
      } as Record<string, 0 | 1>)
      .sort({ lastLoginAt: -1, createdAt: -1, username: 1 })
      .limit(500)
      .toArray();

    const userIds = rows.map((u) => u._id);
    const profiles =
      userIds.length > 0
        ? await userProfiles
            .find({ userId: { $in: userIds } })
            .project({ userId: 1, email: 1, phone: 1, additionalInfo: 1 } as Record<string, 0 | 1>)
            .toArray()
        : [];
    const profileByUserId = new Map(profiles.map((profile) => [profile.userId.toString(), profile]));

    return {
      inspectors: rows.map((u) => {
        const profile = profileByUserId.get(u._id.toString()) ?? null;
        const rawUser = u as UserDoc & {
          isPhoneVerified?: boolean;
          lastLoginAt?: Date | null;
        };
        return {
          id: u._id.toString(),
          username: String(u.username ?? ""),
          displayName:
            optionalProfileText(profile, ["displayName", "fullName", "name", "inspectorName"], 160) ?? null,
          email: u.email ?? profile?.email ?? null,
          phone: u.phone ?? profile?.phone ?? null,
          city: optionalProfileText(profile, ["city", "cityName"], 120),
          region: optionalProfileText(profile, ["region", "regionName"], 120),
          lastLoginAt:
            rawUser.lastLoginAt instanceof Date && !Number.isNaN(rawUser.lastLoginAt.getTime())
              ? rawUser.lastLoginAt.toISOString()
              : null,
          isPhoneVerified: rawUser.isPhoneVerified === true,
        };
      }),
    };
  }

  async uploadInspectorFile(
    projectId: string,
    file: Express.Multer.File,
    ctx: MvAccessContext,
    locationIdsRaw?: unknown,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException("ملف فارغ أو مفقود.");
    }
    if (file.buffer.length > MV_INSPECTOR_FILE_MAX_BYTES) {
      throw new BadRequestException(
        `حجم الملف يتجاوز الحد المسموح (${Math.round(MV_INSPECTOR_FILE_MAX_BYTES / (1024 * 1024))} ميجابايت).`,
      );
    }
    const decodedName = sanitizeUploadedFileName(decodeUploadFilename(file.originalname || "upload"));
    const db = await getMongoDb();
    const _id = toId(projectId);
    const project = await this.loadProjectForAccess(db, _id, ctx);
    const locationIds = sanitizeLocationIdSelection(
      locationIdsRaw,
      sanitizeProjectLocations(project.locations, false),
    );

    const logicalType = inspectorLogicalTypeFromMime(file.mimetype || "", decodedName);
    const id = randomUUID();
    const now = new Date();
    const fileName = decodedName.slice(0, 500);

    if (!this.inspectorSpaces.isReady()) {
      throw new BadRequestException(
        "DigitalOcean Spaces is not configured for inspector file uploads.",
      );
    }
    let uploaded: Awaited<ReturnType<DigitalOceanSpacesService["uploadInspectorFile"]>>;
    try {
      uploaded = await this.inspectorSpaces.uploadInspectorFile({
        projectId,
        entryId: id,
        fileName,
        buffer: file.buffer,
        contentType: file.mimetype || "application/octet-stream",
      });
    } catch (err) {
      this.logger.error(
        `uploadInspectorFile Spaces: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException("فشل رفع الملف إلى DigitalOcean Spaces.");
    }

    const row: MvInspectorFileDoc = {
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

    await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).updateOne(
      { _id },
      { $push: { inspectorFiles: row }, $set: { updatedAt: now } },
    );
    const updated = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id });
    const list = normalizeInspectorFilesArray(updated?.inspectorFiles).map(serializeInspectorFileForClient);
    return {
      ok: true as const,
      file: serializeInspectorFileForClient(row),
      inspectorFiles: list,
    };
  }

  async deleteInspectorFile(projectId: string, fileId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(projectId);
    const project = await this.loadProjectForAccess(db, _id, ctx);
    const files = normalizeInspectorFilesArray(project.inspectorFiles);
    const target = files.find((f) => f.id === fileId.trim());
    if (!target) {
      throw new NotFoundException("الملف غير موجود.");
    }
    await this.deleteInspectorBlobFromStores(db, target);
    const now = new Date();
    await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).updateOne(
      { _id },
      { $pull: { inspectorFiles: { id: target.id } }, $set: { updatedAt: now } },
    );
    const refreshed = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id });
    return {
      ok: true as const,
      removedId: target.id,
      inspectorFiles: normalizeInspectorFilesArray(refreshed?.inspectorFiles).map(
        serializeInspectorFileForClient,
      ),
    };
  }

  async renameInspectorFile(projectId: string, fileId: string, ctx: MvAccessContext, rawName: string) {
    const next = sanitizeUploadedFileName(rawName).slice(0, 500);
    if (!next) {
      throw new BadRequestException("اسم الملف مطلوب.");
    }
    const db = await getMongoDb();
    const _id = toId(projectId);
    await this.loadProjectForAccess(db, _id, ctx);
    const now = new Date();
    const res = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).updateOne(
      { _id, "inspectorFiles.id": fileId.trim() },
      { $set: { "inspectorFiles.$.name": next, updatedAt: now } },
    );
    if (res.matchedCount === 0) {
      throw new NotFoundException("الملف غير موجود.");
    }
    const updated = await db.collection<MvProjectDoc>(MV_PROJECTS_COLLECTION).findOne({ _id });
    return {
      ok: true as const,
      inspectorFiles: normalizeInspectorFilesArray(updated?.inspectorFiles).map(
        serializeInspectorFileForClient,
      ),
    };
  }

  async getInspectorFileDownload(
    projectId: string,
    fileId: string,
    ctx: MvAccessContext,
    opts?: { attachment?: boolean; rangeHeader?: string },
  ) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    const project = await this.loadProjectForAccess(db, pid, ctx);
    const files = normalizeInspectorFilesArray(project.inspectorFiles);
    const entry = files.find((f) => f.id === fileId.trim());
    if (!entry) {
      throw new NotFoundException("الملف غير موجود.");
    }
    if (entry.spacesKey) {
      let object: Awaited<ReturnType<DigitalOceanSpacesService["getObjectStream"]>>;
      try {
        object = await this.inspectorSpaces.getObjectStream(entry.spacesKey, {
          rangeHeader: opts?.rangeHeader,
        });
      } catch {
        throw new NotFoundException("الملف غير موجود.");
      }
      return {
        kind: "digitalocean" as const,
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
      let gid = tryParseObjectId(String(entry.gridFsFileId ?? ""));
      if (!gid) {
        gid = await this.findInspectorGridFsIdByEntryId(db, pid, entry.id);
      }
      if (!gid) {
        throw new NotFoundException("الملف غير موجود.");
      }
      let metaDoc: Awaited<ReturnType<typeof this.getStoredFileDoc>>;
      try {
        metaDoc = await this.getStoredFileDoc(db, pid, gid);
      } catch {
        const alt = await this.findInspectorGridFsIdByEntryId(db, pid, entry.id);
        if (!alt) {
          throw new NotFoundException("الملف غير موجود.");
        }
        metaDoc = await this.getStoredFileDoc(db, pid, alt);
        gid = alt;
      }
      const mime = entry.mimeType || "application/octet-stream";
      const totalBytes = Number(metaDoc.length) || 0;
      const bucket = this.getFilesBucket(db);
      const range = parseInspectorBytesRange(opts?.rangeHeader, totalBytes);
      let stream: ReturnType<GridFSBucket["openDownloadStream"]>;
      let httpStatus: 200 | 206 = 200;
      let contentRange: string | undefined;
      let contentLength = totalBytes;
      if (range && totalBytes > 0) {
        stream = bucket.openDownloadStream(gid, { start: range.start, end: range.end });
        httpStatus = 206;
        contentRange = `bytes ${range.start}-${range.end}/${totalBytes}`;
        contentLength = range.end - range.start + 1;
      } else {
        stream = bucket.openDownloadStream(gid);
      }
      return {
        kind: "gridfs" as const,
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
      throw new NotFoundException("الملف غير موجود.");
    }
    /** تنزيل مرفق: بث عبر الخادم حتى لا يفتح المتصفح رابط تخزين خارجي مباشرة. */
    if (opts?.attachment === true) {
      return {
        kind: "proxyFetch" as const,
        sourceUrl: entry.url,
        fileName: entry.name,
        mimeType: entry.mimeType || "application/octet-stream",
      };
    }
    return {
      kind: "redirect" as const,
      url: entry.url,
      fileName: entry.name,
      attachment: false,
    };
  }

  async deleteProject(id: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(id);
    const projectSnapshot = await this.loadProjectForAccess(db, _id, ctx);
    const inspectorEntries = normalizeInspectorFilesArray(projectSnapshot.inspectorFiles);
    for (const entry of inspectorEntries) {
      await this.deleteInspectorBlobFromStores(db, entry);
    }
    await db.collection(MV_SHEETS_COLLECTION).deleteMany({ projectId: _id });
    await this.deleteStoredFiles(db, {
      "metadata.projectId": _id,
      "metadata.scope": { $ne: "mv-inspector" },
    });
    await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .deleteMany({ projectId: _id, ...MV_PHOTO_FOLDER_FILTER });
    await db.collection(MV_ITEMS_COLLECTION).deleteMany({ projectId: _id });
    await db.collection(MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: _id });
    const del = await db.collection(MV_PROJECTS_COLLECTION).deleteOne({ _id });
    if (del.deletedCount === 0) throw new NotFoundException("Project not found");
    return { ok: true };
  }

  /* ───────── Sub-Projects ───────── */

  async createSubProject(
    projectId: string,
    name: string,
    ctx: MvAccessContext,
    parentSubProjectId?: string,
    options?: { kind?: "folder" | "asset" },
  ) {
    const n = normalizeSubProjectName(name);
    if (!n) throw new BadRequestException("Sub-project name is required");
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const parentId =
      parentSubProjectId && parentSubProjectId.trim().length > 0
        ? toId(parentSubProjectId)
        : undefined;
    if (ctx.userRole === "inspector") {
      if (!parentId) {
        throw new ForbiddenException(
          "لا يُسمح بإنشاء مجلد في جذر المشروع لدور المفتش. استخدم المجلد المخصص لمعاينة الصور.",
        );
      }
      await this.assertInspectorAccessToFolderId(db, pid, parentId, ctx);
    }
    const photosRoot = await this.ensurePhotosRootFolder(db, pid);
    let isPicUnderPhotos = false;
    let parentIsPicAsset = false;
    if (parentId) {
      const inMv = await db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION).findOne({
        _id: parentId,
        projectId: pid,
      });
      if (!inMv) {
        const inItem = await db
          .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
          .findOne({ _id: parentId, projectId: pid });
        if (!inItem) {
          const inPic = await db
            .collection<AssetDoc>(ASSETS_COLLECTION)
            .findOne({ _id: parentId, projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
          if (!inPic) throw new NotFoundException("Parent sub-project not found");
          parentIsPicAsset = true;
        }
      }
      isPicUnderPhotos = await this.isInPhotosHoldingSubtree(db, pid, photosRoot._id, parentId);
    }

    if (parentIsPicAsset) {
      throw new BadRequestException("لا يمكن إنشاء مجلدات أو أصول داخل أصل. الأصل يحتوي صوراً فقط.");
    }

    if (isPicUnderPhotos && parentId && options?.kind === "folder") {
      const duplicateAsset = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
        projectId: pid,
        parent: parentId,
        name: n,
        ...MV_PHOTO_FOLDER_FILTER,
      });
      if (duplicateAsset) {
        throw new BadRequestException("يوجد أصل بنفس الاسم داخل هذا المكان.");
      }
      const { created, existing } = await this.upsertItemsFolders(db, pid, [n], parentId, undefined);
      const target = created[0] ?? existing[0];
      if (!target) throw new BadRequestException("تعذر إنشاء المجلد.");
      return {
        ...serializeMvSubProject(target as MvSubProjectMongoDoc, {
          _id: target._id,
          projectId: pid,
        }),
        picAsset: null,
      };
    }

    if (isPicUnderPhotos && parentId && options?.kind !== "folder") {
      const duplicateFolder =
        (await db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION).findOne({
          projectId: pid,
          name: n,
          $or: [{ parent: parentId }, { parentSubProjectId: parentId }],
        })) ??
        (await db.collection<MvItemDoc>(MV_ITEMS_COLLECTION).findOne({
          projectId: pid,
          name: n,
          $or: [{ parent: parentId }, { parentSubProjectId: parentId }],
        }));
      if (duplicateFolder) {
        throw new BadRequestException("يوجد مجلد بنفس الاسم داخل هذا المكان.");
      }
      const createdBy = tryParseObjectId(ctx.userId ?? undefined) ?? null;
      const { created, existing } = await this.upsertPicAssetFoldersOnly(
        db,
        pid,
        parentId,
        [n],
        createdBy,
      );
      const target = created[0] ?? existing[0];
      if (!target) throw new BadRequestException("تعذّر إنشاء مجلد أصل الصور.");
      const tCreated = target.createdAt ?? target.importedAt ?? target.updatedAt;
      return {
        _id: target._id.toString(),
        projectId: target.projectId.toString(),
        parent: target.parent!.toString(),
        name: target.name ?? "",
        createdAt:
          tCreated instanceof Date && !Number.isNaN(tCreated.getTime())
            ? tCreated.toISOString()
            : target.updatedAt.toISOString(),
        updatedAt: target.updatedAt.toISOString(),
        picAsset: serializePicAsset(target),
      };
    }

    const { created, existing } = await this.upsertSubProjects(db, pid, [n], parentId, undefined);
    const target = created[0] ?? existing[0];
    if (!target) throw new BadRequestException("Sub-project could not be created");

    const fresh = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .findOne({ _id: target._id, projectId: pid });
    if (!fresh) throw new NotFoundException("Sub-project not found");
    const pFolderA = getParentIdFromDoc(fresh as MvSubProjectMongoDoc);
    const picA =
      pFolderA != null
        ? await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
            projectId: pid,
            parent: pFolderA,
            name: fresh.name,
            ...MV_PHOTO_FOLDER_FILTER,
          })
        : null;
    const idFb = { _id: fresh._id, projectId: pid };
    return {
      ...serializeMvSubProject(fresh as MvSubProjectMongoDoc, idFb),
      picAsset: picA
        ? serializePicAsset(picA as PicAssetMongoDoc, {
            _id: (picA as { _id?: ObjectId | null })._id ?? fresh._id,
            projectId: (picA as { projectId?: ObjectId | null }).projectId ?? pid,
          })
        : null,
    };
  }

  async getSubProject(projectId: string, subId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const sid = toId(subId);
    if (ctx.userRole === "inspector") {
      await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
    }
    const sub = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .findOne({ _id: sid, projectId: pid });
    if (sub) {
      const pFolderG = getParentIdFromDoc(sub as MvSubProjectMongoDoc);
      const pic =
        pFolderG != null
          ? await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
              projectId: pid,
              parent: pFolderG,
              name: sub.name,
              ...MV_PHOTO_FOLDER_FILTER,
            })
          : null;
      const idFb = { _id: sid, projectId: pid };
      return {
        ...serializeMvSubProject(sub as MvSubProjectMongoDoc, idFb),
        picAsset: pic ? serializePicAsset(pic as PicAssetMongoDoc, idFb) : null,
      };
    }
    const itemSub = await db
      .collection<MvItemDoc>(MV_ITEMS_COLLECTION)
      .findOne({ _id: sid, projectId: pid });
    if (itemSub) {
      const pFolderG = getParentIdFromDoc(itemSub as MvSubProjectMongoDoc);
      const pic =
        pFolderG != null
          ? await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
              projectId: pid,
              parent: pFolderG,
              name: itemSub.name,
              ...MV_PHOTO_FOLDER_FILTER,
            })
          : null;
      const idFb = { _id: sid, projectId: pid };
      return {
        ...serializeMvSubProject(itemSub as MvSubProjectMongoDoc, idFb),
        picAsset: pic ? serializePicAsset(pic as PicAssetMongoDoc, idFb) : null,
      };
    }
    const picOnlyRaw = (await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER })) as PicAssetMongoDoc | null;
    if (!picOnlyRaw) throw new NotFoundException("Sub-project not found");
    /** بعض السجلات القديمة قد تفتقد ‎_id‎ أو ‎projectId‎ على مستند الأصل — نستخدم معرفات الطلب. */
    const picOnly = {
      ...picOnlyRaw,
      _id: picOnlyRaw._id ?? sid,
      projectId: picOnlyRaw.projectId ?? pid,
    } as PicAssetMongoDoc;
    const poCreated = picOnly.createdAt ?? picOnly.importedAt ?? picOnly.updatedAt;
    const parentId = picOnly.parent != null ? String(picOnly.parent) : "";
    return {
      _id: picOnly._id.toString(),
      projectId: picOnly.projectId.toString(),
      parent: parentId,
      name: picOnly.name ?? "",
      createdAt:
        poCreated instanceof Date && !Number.isNaN(poCreated.getTime())
          ? poCreated.toISOString()
          : mvProjectDateToIso(picOnly.updatedAt),
      updatedAt: mvProjectDateToIso(picOnly.updatedAt),
      picAsset: serializePicAsset(picOnly),
    };
  }

  async patchSubProject(
    projectId: string,
    subId: string,
    ctx: MvAccessContext,
    body: PicAssetPatch | null | undefined,
  ) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const sid = toId(subId);
    if (ctx.userRole === "inspector") {
      await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
    }

    const pa = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const sp = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    /** يُحفَظ لإرجاع الـ API دون ‎find‎ إضافي على ‎mv_subprojects‎ */
    let folderMeta: MvSubProjectMongoDoc | MvItemDoc | null = null;
    let pic = await pa.findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
    if (!pic) {
      const sub =
        (await sp.findOne({ _id: sid, projectId: pid })) ??
        (await db.collection<MvItemDoc>(MV_ITEMS_COLLECTION).findOne({ _id: sid, projectId: pid }));
      if (!sub) throw new NotFoundException("Sub-project not found");
      folderMeta = sub;
      const pFolder = getParentIdFromDoc(sub);
      if (pFolder == null) {
        throw new BadRequestException("لا تتوفر بيانات أصل صور لمجلدات جذر المشروع.");
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
        const insr = await pa.insertOne(
          buildPicAssetDocument(
            pid,
            pFolder,
            sub.name,
            now0,
            tryParseObjectId(ctx.userId ?? undefined) ?? null,
          ),
        );
        pic = await pa.findOne({ _id: insr.insertedId!, ...MV_PHOTO_FOLDER_FILTER });
      }
    }
    if (!pic) throw new NotFoundException("photo folder asset not found");

    const b = body ?? {};
    const $set: Record<string, unknown> = {};
    const now = new Date();

    if (b.writtenDescription !== undefined) {
      if (b.writtenDescription !== null && typeof b.writtenDescription !== "string") {
        throw new BadRequestException("writtenDescription must be a string or null");
      }
      $set.writtenDescription = b.writtenDescription;
    }
    if (b.condition !== undefined) {
      if (b.condition !== null && typeof b.condition !== "string") {
        throw new BadRequestException("condition must be a string or null");
      }
      $set.condition = b.condition;
    }
    if (b.assetType !== undefined) {
      if (typeof b.assetType !== "string" || !ASSET_TYPE_SET.has(b.assetType)) {
        throw new BadRequestException("Invalid assetType");
      }
      $set.assetType = b.assetType as AssetType;
    }
    for (const key of ["brand", "code", "model"] as const) {
      if (b[key] !== undefined) {
        const v = b[key];
        if (v !== null && typeof v !== "string") {
          throw new BadRequestException(`${key} must be a string or null`);
        }
        $set[key] = v;
      }
    }
    if (b.manufactureYear !== undefined) {
      if (b.manufactureYear !== null && (typeof b.manufactureYear !== "number" || !Number.isFinite(b.manufactureYear))) {
        throw new BadRequestException("manufactureYear must be a finite number or null");
      }
      $set.manufactureYear = b.manufactureYear;
    }
    if (b.kilometersDriven !== undefined) {
      if (
        b.kilometersDriven !== null &&
        (typeof b.kilometersDriven !== "number" || !Number.isFinite(b.kilometersDriven))
      ) {
        throw new BadRequestException("kilometersDriven must be a finite number or null");
      }
      $set.kilometersDriven = b.kilometersDriven;
    }
    if (b.isPresent !== undefined) {
      if (typeof b.isPresent !== "boolean") {
        throw new BadRequestException("isPresent must be a boolean");
      }
      $set.isPresent = b.isPresent;
    }
    if (b.isDone !== undefined) {
      if (typeof b.isDone !== "boolean") {
        throw new BadRequestException("isDone must be a boolean");
      }
      $set.isDone = b.isDone;
    }
    if (b.images !== undefined) {
      $set.images = normalizePicAssetMediaArrayForPatch(
        b.images as unknown,
        "images",
      ) as never;
    }
    if (b.voiceNotes !== undefined) {
      $set.voiceNotes = normalizePicAssetMediaArrayForPatch(
        b.voiceNotes as unknown,
        "voiceNotes",
      ) as never;
    }

    if (Object.keys($set).length === 0) {
      throw new BadRequestException("No valid fields to update");
    }
    $set.isAssetFolder = true;
    $set.updatedAt = now;

    const picId = (pic as PicAssetMongoDoc)._id;
    const nextPic = (await pa.findOneAndUpdate(
      { _id: picId, projectId: pid, ...MV_PHOTO_FOLDER_FILTER },
      { $set },
      { returnDocument: "after" },
    )) as PicAssetMongoDoc | null;
    if (!nextPic) throw new NotFoundException("photo folder asset not found");
    const subForResponse =
      folderMeta ??
      (await sp.findOne({ _id: sid, projectId: pid })) ??
      (await db.collection<MvItemDoc>(MV_ITEMS_COLLECTION).findOne({ _id: sid, projectId: pid }));
    const patchIdFb = { _id: sid, projectId: pid };
    if (subForResponse) {
      return {
        ...serializeMvSubProject(subForResponse as MvSubProjectMongoDoc, patchIdFb),
        picAsset: serializePicAsset(nextPic, patchIdFb),
      };
    }
    const nextCreated = nextPic.createdAt ?? nextPic.importedAt;
    const npId = (nextPic as { _id?: ObjectId | null })._id ?? sid;
    const npProj = (nextPic as { projectId?: ObjectId | null }).projectId ?? pid;
    const npUpdated = nextPic.updatedAt instanceof Date ? nextPic.updatedAt : new Date(0);
    return {
      _id: npId.toString(),
      projectId: npProj.toString(),
      parent: nextPic.parent != null ? nextPic.parent.toString() : "",
      name: nextPic.name ?? "",
      createdAt:
        nextCreated instanceof Date && !Number.isNaN(nextCreated.getTime())
          ? nextCreated.toISOString()
          : npUpdated.toISOString(),
      updatedAt: npUpdated.toISOString(),
      picAsset: serializePicAsset(nextPic, patchIdFb),
    };
  }

  async deleteSubProject(projectId: string, subId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const sid = toId(subId);
    const sp = db.collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION);
    const it = db.collection<MvItemDoc>(MV_ITEMS_COLLECTION);
    const pa = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const sub = await sp.findOne({ _id: sid, projectId: pid });
    const item = sub ? null : await it.findOne({ _id: sid, projectId: pid });
    if (sub || item) {
      if (ctx.userRole === "inspector") {
        await this.assertInspectorAccessToFolderId(db, pid, sid, ctx);
      }
      const ids = await this.collectDescendantSubProjectIds(db, pid, sid);
      const picTied = await this.collectAllPicForMvDeletion(db, pid, ids);
      await db.collection(MV_SHEETS_COLLECTION).deleteMany({ subProjectId: { $in: ids } });
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
        throw new NotFoundException("Sub-project not found");
      }
      return { ok: true };
    }

    const picNode = (await pa.findOne({
      _id: sid,
      projectId: pid,
      ...MV_PHOTO_FOLDER_FILTER,
    })) as PicAssetMongoDoc | null;
    if (!picNode) throw new NotFoundException("Sub-project not found");
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
    if (delP.deletedCount === 0) throw new NotFoundException("Sub-project not found");
    return { ok: true };
  }

  /** حذف كل المجلدات الفرعية للمشروع مع جداولها المرتبطة */
  async deleteAllSubProjects(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const subs = await db
      .collection<MvSubProjectDoc>(MV_SUBPROJECTS_COLLECTION)
      .find({ projectId: pid })
      .project({ _id: 1 })
      .toArray();

    if (subs.length > 0) {
      const ids = subs.map((s) => s._id);
      await db.collection(MV_SHEETS_COLLECTION).deleteMany({ subProjectId: { $in: ids } });
    }
    await this.deleteStoredFiles(db, { "metadata.projectId": pid });
    await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
      .deleteMany({ projectId: pid, ...MV_PHOTO_FOLDER_FILTER });
    await db.collection(MV_ITEMS_COLLECTION).deleteMany({ projectId: pid });
    const del = await db.collection(MV_SUBPROJECTS_COLLECTION).deleteMany({ projectId: pid });
    return { ok: true, deletedCount: del.deletedCount };
  }

  async generateInspectionFoldersFromSheet(
    projectId: string,
    sheetId: string,
    ctx: MvAccessContext,
    body?: { columnName?: string; columnIndex?: number | string | null },
  ) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const sid = toId(sheetId);
    const sheet = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({
      _id: sid,
      projectId: pid,
    });
    if (!sheet) throw new NotFoundException("Sheet not found");

    const headers = sheet.headers ?? [];
    if (headers.length === 0) {
      throw new BadRequestException("Sheet has no columns");
    }

    let columnIndex: number | null = null;
    if (typeof body?.columnName === "string" && body.columnName.trim().length > 0) {
      columnIndex = headers.findIndex((header) => header === body.columnName);
    }
    if (
      columnIndex === null &&
      body?.columnIndex !== undefined &&
      body.columnIndex !== null &&
      body.columnIndex !== ""
    ) {
      const parsed = Number(body.columnIndex);
      if (Number.isFinite(parsed)) {
        const rounded = Math.round(parsed);
        if (rounded >= 0 && rounded < headers.length) {
          columnIndex = rounded;
        }
      }
    }
    if (columnIndex === null || columnIndex < 0 || columnIndex >= headers.length) {
      throw new BadRequestException("A valid column is required");
    }

    const rows =
      sheet.rowValues && sheet.rowValues.length > 0
        ? rowValuesToRecords(headers, sheet.rowValues)
        : (sheet.rows ?? []);

    const columnName = headers[columnIndex] ?? `Column ${columnIndex + 1}`;
    const folderNames = Array.from(
      new Set(
        rows
          .map((row) => sanitizeGeneratedFolderName(row[columnName]))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (folderNames.length === 0) {
      throw new BadRequestException("This column has no usable values to create folders");
    }

    const photosRoot = await this.ensurePhotosRootFolder(db, pid);
    const createdBy = tryParseObjectId(ctx.userId ?? undefined) ?? null;
    const { created, existing } = await this.upsertPicAssetFoldersOnly(
      db,
      pid,
      photosRoot._id,
      folderNames,
      createdBy,
    );

    const queryNames = Array.from(
      new Set(folderNames.map((n) => normalizeSubProjectName(n)).filter(Boolean)),
    );
    const refreshed = await db
      .collection<AssetDoc>(ASSETS_COLLECTION)
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
      folders: (refreshed as PicAssetMongoDoc[])
        .filter((p) => p.parent != null)
        .map((p) => ({
          _id: p._id.toString(),
          projectId: p.projectId.toString(),
          parent: p.parent!.toString(),
          name: p.name ?? "",
          createdAt: (p.createdAt ?? p.importedAt ?? p.updatedAt).toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          picAsset: serializePicAsset(p),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ar")),
    };
  }

  /**
   * مثل ‎generateInspectionFoldersFromSheet‎ لكن مصدر القيم هو أعمدة استيراد الأصول (‎rawData‎)
   * ضمن ورقة محددة. تُنشأ مجلدات فرعية تحت ‎2.صور المعاينة‎ في شجرة مشروع التقييم (‎mv_subprojects‎).
   */
  async generateInspectionFoldersFromAssetImport(
    projectId: string,
    ctx: MvAccessContext,
    body: { columnKey: string; importId: string; sheetName: string },
  ) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const columnKey = sanitizeTextInput(body.columnKey ?? "");
    if (!columnKey || columnKey.includes(".") || columnKey.includes("$")) {
      throw new BadRequestException("مفتاح العمود غير صالح.");
    }

    const importIdRaw = sanitizeTextInput(body.importId ?? "");
    const sheetName = sanitizeTextInput(body.sheetName ?? "");
    if (!ObjectId.isValid(importIdRaw)) {
      throw new BadRequestException("معرف الاستيراد غير صالح.");
    }
    if (!sheetName) {
      throw new BadRequestException("اسم الورقة مطلوب.");
    }

    await ensureAssetsCollectionsInitialized(db);
    const importOid = new ObjectId(importIdRaw);

    /** صفوف هذا الاستيراد والورقة فقط — بما فيها المجلدات المرتبطة لاحقاً (لها importId). */
    const rowFilter: Filter<AssetDoc> = {
      projectId: pid,
      importId: importOid,
      sheetName,
    };

    const coll = db.collection<AssetDoc>(ASSETS_COLLECTION);
    const photosRoot = await this.ensurePhotosRootFolder(db, pid);
    const createdBy = tryParseObjectId(ctx.userId ?? undefined) ?? null;
    const now = new Date();
    const sheetFolderName = normalizeSubProjectName(sheetName) || "Sheet";
    const { created: createdSheetFolders, existing: existingSheetFolders } = await this.upsertItemsFolders(
      db,
      pid,
      [sheetFolderName],
      photosRoot._id,
      undefined,
    );
    const sheetFolder = createdSheetFolders[0] ?? existingSheetFolders[0];
    if (!sheetFolder) {
      throw new BadRequestException("تعذر إنشاء مجلد رئيسي للشيت.");
    }
    const sheetFolderId = sheetFolder._id;

    const folderNames = new Set<string>();
    const bulkOps: AnyBulkWriteOperation<AssetDoc>[] = [];
    const BATCH = 500;
    let modifiedRows = 0;
    let unchangedRows = 0;

    const flushBulk = async () => {
      if (bulkOps.length === 0) return;
      const res = await coll.bulkWrite(bulkOps.splice(0, bulkOps.length), { ordered: false });
      modifiedRows += res.modifiedCount;
    };

    for await (const doc of coll.find(rowFilter)) {
      const rawVal = doc.rawData?.[columnKey];
      const normVal = doc.normalizedData?.[columnKey];
      const cell = rawVal !== undefined && rawVal !== null && rawVal !== "" ? rawVal : normVal;
      const folder = sanitizeGeneratedFolderName(cell);
      if (!folder) continue;

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
        /** مجلد قديم كان تحت جذر الصور مباشرة؛ ننقله تحت مجلد الشيت دون تغيير حالة المراجعة. */
        bulkOps.push({
          updateOne: {
            filter: { _id: doc._id, projectId: pid },
            update: { $set: { parent: sheetFolderId, updatedAt: now } },
          },
        });
        if (bulkOps.length >= BATCH) await flushBulk();
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

      if (bulkOps.length >= BATCH) await flushBulk();
    }

    await flushBulk();

    if (folderNames.size === 0) {
      throw new BadRequestException(
        "لا توجد قيم صالحة في هذا العمود لإنشاء مجلدات. تأكد أن الصفوف تحتوي بيانات في العمود المختار.",
      );
    }

    const queryNames = Array.from(
      new Set([...folderNames].map((n) => normalizeSubProjectName(n)).filter(Boolean)),
    );

    /** إزالة مجلدات الصور اليتيمة القديمة (بلا importId) التي كانت تُنشأ مكررة مع نفس الاسم و rawData فارغ. */
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
      folders: (refreshed as PicAssetMongoDoc[])
        .filter((p) => p.parent != null)
        .map((p) => ({
          _id: p._id.toString(),
          projectId: p.projectId.toString(),
          parent: p.parent!.toString(),
          name: p.name ?? "",
          createdAt: (p.createdAt ?? p.importedAt ?? p.updatedAt).toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          picAsset: serializePicAsset(p),
        }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ar")),
    };
  }

  /* ───────── Sheets ───────── */

  async listProjectFiles(projectId: string, ctx: MvAccessContext, subProjectId?: string) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    const sid =
      subProjectId && subProjectId.trim().length > 0
        ? toId(subProjectId)
        : undefined;

    await this.assertSubProjectContext(db, pid, sid, ctx);

    const filter: Record<string, unknown> = {
      "metadata.projectId": pid,
      "metadata.scope": { $ne: "asset-images" },
    };
    if (sid) {
      filter.$or = [
        { "metadata.subProjectId": sid },
        { "metadata.picAssetId": sid },
      ];
    } else {
      filter.$and = [
        { "metadata.subProjectId": { $exists: false } },
        { "metadata.picAssetId": { $exists: false } },
      ];
    }

    const files = await db
      .collection<{
        _id: ObjectId;
        filename?: string;
        length?: number;
        uploadDate?: Date;
        metadata?: MvStoredFileMetadata;
      }>(MV_FILES_FILES_COLLECTION)
      .find(filter)
      .sort({ uploadDate: -1 })
      .toArray();

    return files.map((file) => mapStoredFileDoc(file));
  }

  async listValuationExcelFiles(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const files = await db
      .collection<{
        _id: ObjectId;
        filename?: string;
        length?: number;
        uploadDate?: Date;
        metadata?: MvStoredFileMetadata;
      }>(MV_FILES_FILES_COLLECTION)
      .find({
        "metadata.projectId": pid,
        "metadata.scope": MV_VALUATION_EXCEL_SCOPE,
      })
      .sort({ uploadDate: -1 })
      .toArray();

    return files.map((file) => mapStoredFileDoc(file));
  }

  async uploadValuationExcelFiles(projectId: string, files: Express.Multer.File[], ctx: MvAccessContext) {
    const safeFiles = Array.isArray(files) ? files : [];
    if (safeFiles.length === 0) {
      throw new BadRequestException("At least one file is required");
    }
    // Store them under a dedicated scope (separate from assets/import).
    return this.uploadProjectFiles(projectId, safeFiles, ctx, undefined, {
      scope: MV_VALUATION_EXCEL_SCOPE,
      preferDigitalOcean: true,
    });
  }

  async getValuationExcelFileDownload(projectId: string, fileId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const fid = toId(fileId);
    const file = await this.getStoredFileDoc(db, pid, fid);
    if (file.metadata?.scope !== MV_VALUATION_EXCEL_SCOPE) {
      throw new NotFoundException("File not found");
    }
    if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
      try {
        const object = await this.inspectorSpaces.getObjectStream(file.metadata.spacesKey.trim());
        return {
          file: mapStoredFileDoc(file),
          stream: object.stream,
        };
      } catch {
        throw new NotFoundException("File not found");
      }
    }
    return {
      file: mapStoredFileDoc(file),
      stream: this.getFilesBucket(db).openDownloadStream(fid),
    };
  }

  async deleteValuationExcelFile(projectId: string, fileId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const fid = toId(fileId);
    const file = await this.getStoredFileDoc(db, pid, fid);
    if (file.metadata?.scope !== MV_VALUATION_EXCEL_SCOPE) {
      throw new NotFoundException("File not found");
    }
    if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
      try {
        await this.inspectorSpaces.deleteObject(file.metadata.spacesKey.trim());
      } catch (err) {
        this.logger.warn(
          `deleteValuationExcelFile Spaces: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await db.collection(MV_FILES_FILES_COLLECTION).deleteOne({ _id: fid, "metadata.projectId": pid });
    } else {
      await this.getFilesBucket(db).delete(fid);
    }
    return { ok: true };
  }

  async listProjectAssetImageFiles(projectId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    await backfillPicAssetGridFsImagesAsAssetFiles(db, pid);

    const files = await db
      .collection<{
        _id: ObjectId;
        filename?: string;
        length?: number;
        uploadDate?: Date;
        metadata?: MvStoredFileMetadata;
      }>(MV_FILES_FILES_COLLECTION)
      .find({
        "metadata.projectId": pid,
        "metadata.scope": "asset-images",
      })
      .toArray();

    files.sort(compareAssetImageGridDocs);
    return files.map((file) => mapStoredFileDoc(file));
  }

  /** يُحدِّث ‎displayOrder‎ لجميع صور مسار واحد وفقًا للترتيب المطلوب. */
  async reorderProjectAssetImageFiles(
    projectId: string,
    ctx: MvAccessContext,
    folderPathInput: string,
    orderedFileIds: string[],
    picAssetFolderIdInput?: unknown,
  ) {
    if (!Array.isArray(orderedFileIds) || orderedFileIds.length === 0) {
      throw new BadRequestException("orderedFileIds مطلوب.");
    }

    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const picAssetFolderId =
      typeof picAssetFolderIdInput === "string" && picAssetFolderIdInput.trim()
        ? toId(picAssetFolderIdInput.trim())
        : null;
    if (picAssetFolderId) {
      const picFolder = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
        _id: picAssetFolderId,
        projectId: pid,
        ...MV_PHOTO_FOLDER_FILTER,
      });
      if (!picFolder) throw new BadRequestException("Target asset folder not found.");
    }

    const normalizedFolder = normalizeMvAssetFolderPath(folderPathInput ?? "");
    const folderClause = assetImageFolderMongoFilter(normalizedFolder);
    const col = db.collection<{
      _id: ObjectId;
      metadata?: MvStoredFileMetadata;
    }>(MV_FILES_FILES_COLLECTION);

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
      throw new BadRequestException(
        "عدد الصور في الطلب لا يطابق هذا المجلد أو تكرار أو نقص.",
      );
    }

    const idSet = new Set(existing.map((d) => d._id.toString()));
    const orderedObjectIds: ObjectId[] = [];
    const requestedIds = new Set<string>();
    for (const id of orderedFileIds) {
      const oid = tryParseObjectId(id);
      const normalizedId = oid?.toString();
      if (!oid || !normalizedId || !idSet.has(normalizedId) || requestedIds.has(normalizedId)) {
        throw new BadRequestException("معرف ملف غير صالح أو لا ينتمي لهذا المجلد.");
      }
      requestedIds.add(normalizedId);
      orderedObjectIds.push(oid);
    }

    const now = new Date();
    await Promise.all(
      orderedObjectIds.map((fid, i) =>
        col.updateOne(
          { _id: fid, ...baseFilter },
          {
            $set: {
              "metadata.displayOrder": i,
              "metadata.folderPath": normalizedFolder,
              "metadata.updatedAt": now,
            },
          },
        ),
      ),
    );

    return this.listProjectAssetImageFiles(projectId, ctx);
  }

  /**
   * نقل أو إعادة ترتيب ملف واحد بين مجلدات صور الأصول، مع اعتماد ‎displayOrder‎ من جديد لهذا المسار وجبرة المسار السابق بعد النقل بين المجلدات.
   */
  async placeProjectAssetImageFile(
    projectId: string,
    ctx: MvAccessContext,
    fileIdInput: string,
    targetFolderPathRaw: unknown,
    insertBeforeFileIdRaw: unknown,
    targetPicAssetFolderIdRaw?: unknown,
  ) {
    const fileIdTrim = typeof fileIdInput === "string" ? fileIdInput.trim() : "";
    const oidMoving = tryParseObjectId(fileIdTrim);
    if (!oidMoving) throw new BadRequestException("معرف الملف مطلوب وصالح.");

    const insertBeforeTrim =
      typeof insertBeforeFileIdRaw === "string" ? insertBeforeFileIdRaw.trim() : "";

    const targetFolderNormalized = normalizeMvAssetFolderPath(
      typeof targetFolderPathRaw === "string" ? targetFolderPathRaw : "",
    );

    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const col = db.collection<{
      _id: ObjectId;
      metadata?: MvStoredFileMetadata;
      uploadDate?: Date;
    }>(MV_FILES_FILES_COLLECTION);

    const moveDoc = await col.findOne({
      _id: oidMoving,
      "metadata.projectId": pid,
      "metadata.scope": "asset-images",
    });
    if (!moveDoc?.metadata) {
      throw new NotFoundException("ملف صورة الأصول غير موجود.");
    }

    const oldRelativePath = String(
      moveDoc.metadata.relativePath || moveDoc.metadata.originalFileName || "file",
    ).replace(/\\/g, "/");
    const oldBasename = sanitizeUploadedFileName(oldRelativePath.split("/").pop() || "file");

    const sourceFolderNormalized = normalizeMvAssetFolderPath(
      String(
        moveDoc.metadata.folderPath ??
          folderPathFromRelativePath(moveDoc.metadata.relativePath || moveDoc.metadata.originalFileName || ""),
      ),
    );
    const sourcePicOid = moveDoc.metadata.picAssetId ?? null;

    const crossFolderMove = sourceFolderNormalized !== targetFolderNormalized;

    const targetPicTrim =
      typeof targetPicAssetFolderIdRaw === "string" ? targetPicAssetFolderIdRaw.trim() : "";
    const targetPicOid = targetPicTrim ? tryParseObjectId(targetPicTrim) : null;
    if (targetPicTrim && !targetPicOid) {
      throw new BadRequestException("معرف مجلد الأصل المستهدف غير صالح.");
    }

    const picAssetScopeFilter = (picOid: ObjectId | null) =>
      picOid
        ? { "metadata.picAssetId": picOid }
        : { "metadata.picAssetId": { $exists: false } };

    if (targetPicOid && !crossFolderMove) {
      const picFolder = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
        _id: targetPicOid,
        projectId: pid,
        ...MV_PHOTO_FOLDER_FILTER,
      });
      if (!picFolder) {
        throw new BadRequestException("Target asset folder not found.");
      }
      const photosRoot = await this.ensurePhotosRootFolder(db, pid);
      await this.assertPicAssetFolderCanReceiveImages(
        db,
        pid,
        photosRoot._id,
        picFolder as PicAssetMongoDoc,
      );
    }

    let insertBeforeOid: ObjectId | null = null;
    if (insertBeforeTrim) {
      insertBeforeOid = tryParseObjectId(insertBeforeTrim);
      if (!insertBeforeOid) {
        throw new BadRequestException("معرف موضع الإدراج غير صالح.");
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
        throw new BadRequestException("الصورة المرجعية لهذا الموضع غير موجودة.");
      }
      const anchorFp = normalizeMvAssetFolderPath(
        String(
          anchor.metadata.folderPath ??
            folderPathFromRelativePath(
              anchor.metadata.relativePath || anchor.metadata.originalFileName || "",
            ),
        ),
      );
      if (anchorFp !== targetFolderNormalized) {
        throw new BadRequestException("موضع الإدراج يجب أن يكون ضمن المجلد المستهدف.");
      }
      const anchorPicOid = anchor.metadata.picAssetId ?? null;
      if (
        (targetPicOid && !anchorPicOid?.equals(targetPicOid)) ||
        (!targetPicOid && anchorPicOid)
      ) {
        throw new BadRequestException("موضع الإدراج لا ينتمي لنفس مجلد صور الأصول.");
      }
    }

    const siblingDocsForFolder = async (folderNorm: string, picOid: ObjectId | null) =>
      col
        .find({
          "metadata.projectId": pid,
          "metadata.scope": "asset-images",
          ...picAssetScopeFilter(picOid),
          ...assetImageFolderMongoFilter(folderNorm),
          _id: { $ne: oidMoving },
        })
        .toArray();

    const siblingsSorted = (await siblingDocsForFolder(targetFolderNormalized, targetPicOid)).sort(compareAssetImageGridDocs);

    let idsOrdered: ObjectId[];
    if (insertBeforeOid) {
      const idxBefore = siblingsSorted.findIndex((d) => d._id.equals(insertBeforeOid));
      if (idxBefore < 0) {
        throw new BadRequestException("الصورة المرجعية ليست في المجلد المستهدف.");
      }
      idsOrdered = [
        ...siblingsSorted.slice(0, idxBefore).map((d) => d._id),
        oidMoving,
        ...siblingsSorted.slice(idxBefore).map((d) => d._id),
      ];
    } else {
      idsOrdered = [...siblingsSorted.map((d) => d._id), oidMoving];
    }

    const now = new Date();

    if (crossFolderMove) {
      const uniq = await this.uniqueRelativePathForAssetImageFolder(db, pid, oidMoving, {
        folderPathNorm: targetFolderNormalized,
        preferredBasename: oldBasename,
      });
      if (targetPicOid) {
        const picFolder = await db.collection<AssetDoc>(ASSETS_COLLECTION).findOne({
          _id: targetPicOid,
          projectId: pid,
          ...MV_PHOTO_FOLDER_FILTER,
        });
        if (!picFolder) {
          throw new BadRequestException("مجلد الأصل المستهدف غير موجود أو غير صالح.");
        }
        const photosRoot = await this.ensurePhotosRootFolder(db, pid);
        await this.assertPicAssetFolderCanReceiveImages(
          db,
          pid,
          photosRoot._id,
          picFolder as PicAssetMongoDoc,
        );
      }
      const setMeta: Record<string, unknown> = {
        "metadata.relativePath": uniq.relativePath,
        "metadata.folderPath": uniq.folderPath,
        "metadata.updatedAt": now,
      };
      const unsetMeta: Record<string, ""> = {};
      if (targetPicOid) {
        setMeta["metadata.picAssetId"] = targetPicOid;
      } else if (sourcePicOid) {
        unsetMeta["metadata.picAssetId"] = "";
      }
      const updatePayload: Record<string, unknown> = { $set: setMeta };
      if (Object.keys(unsetMeta).length > 0) updatePayload.$unset = unsetMeta;
      await col.updateOne(
        { _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" },
        updatePayload,
      );
    }

    if (!crossFolderMove && sourcePicOid?.toString() !== targetPicOid?.toString()) {
      const setMeta: Record<string, unknown> = { "metadata.updatedAt": now };
      const unsetMeta: Record<string, ""> = {};
      if (targetPicOid) {
        setMeta["metadata.picAssetId"] = targetPicOid;
      } else {
        unsetMeta["metadata.picAssetId"] = "";
      }
      const updatePayload: Record<string, unknown> = { $set: setMeta };
      if (Object.keys(unsetMeta).length > 0) updatePayload.$unset = unsetMeta;
      await col.updateOne(
        { _id: oidMoving, "metadata.projectId": pid, "metadata.scope": "asset-images" },
        updatePayload,
      );
    }

    /** لا نعدّل مصفوفة ‎images‎ في ‎assets‎ — الربط يتم عبر ‎metadata.picAssetId‎ في ‎GridFS‎ فقط ليتوافق مع أصول التطبيق. */

    await Promise.all(
      idsOrdered.map((fid, i) =>
        col.updateOne(
          { _id: fid, "metadata.projectId": pid, "metadata.scope": "asset-images" },
          {
            $set: {
              "metadata.displayOrder": i,
              "metadata.folderPath": targetFolderNormalized,
              "metadata.updatedAt": now,
            },
          },
        ),
      ),
    );

    if (crossFolderMove) {
      const restSource = (await siblingDocsForFolder(sourceFolderNormalized, sourcePicOid)).sort(compareAssetImageGridDocs);
      await Promise.all(
        restSource.map((d, i) =>
          col.updateOne(
            { _id: d._id },
            {
              $set: {
                "metadata.displayOrder": i,
                "metadata.folderPath": sourceFolderNormalized,
                "metadata.updatedAt": now,
              },
            },
          ),
        ),
      );
    }

    return this.listProjectAssetImageFiles(projectId, ctx);
  }

  async updateProjectAssetImageReportSelection(
    projectId: string,
    ctx: MvAccessContext,
    fileIdsInput: string[],
    includeInReport: boolean,
  ) {
    const fileIds = Array.from(
      new Set((Array.isArray(fileIdsInput) ? fileIdsInput : []).map((id) => String(id ?? "").trim()).filter(Boolean)),
    );
    if (fileIds.length === 0) {
      throw new BadRequestException("fileIds مطلوب.");
    }

    const ids: ObjectId[] = [];
    for (const id of fileIds) {
      const oid = tryParseObjectId(id);
      if (!oid) throw new BadRequestException("معرف ملف غير صالح.");
      ids.push(oid);
    }

    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);

    const col = db.collection<{ _id: ObjectId; metadata?: MvStoredFileMetadata }>(MV_FILES_FILES_COLLECTION);
    const now = new Date();
    const result = await col.updateMany(
      {
        _id: { $in: ids },
        "metadata.projectId": pid,
        "metadata.scope": "asset-images",
      },
      {
        $set: {
          "metadata.includeInReport": includeInReport,
          "metadata.updatedAt": now,
        },
      },
    );

    if (result.matchedCount !== ids.length) {
      throw new BadRequestException("بعض الصور غير موجودة أو لا تنتمي لهذا المشروع.");
    }

    return this.listProjectAssetImageFiles(projectId, ctx);
  }

  private async uniqueRelativePathForAssetImageFolder(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    pid: ObjectId,
    excludeFileId: ObjectId,
    params: { folderPathNorm: string; preferredBasename: string },
  ): Promise<{ relativePath: string; folderPath: string }> {
    const col = db.collection<{ _id: ObjectId; metadata?: MvStoredFileMetadata }>(MV_FILES_FILES_COLLECTION);
    const folderPathNorm = params.folderPathNorm;
    let base = sanitizeUploadedFileName(params.preferredBasename);

    for (let n = 0; n < 5000; n++) {
      const relativePathCandidate =
        sanitizeUploadedRelativePath(folderPathNorm ? `${folderPathNorm}/${base}` : base, base) || base;

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

    throw new BadRequestException("تعذّر إيجاد مسار ملف متاح.");
  }

  private async buildDisplayOrdersForIncomingAssetImages(
    db: Awaited<ReturnType<typeof getMongoDb>>,
    pid: ObjectId,
    files: Express.Multer.File[],
    options: MvUploadProjectFilesOptions,
  ): Promise<Map<number, number>> {
    const assignments = new Map<number, number>();
    const sequence: Array<{ idx: number; fp: string }> = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!file) continue;
      const fileName = sanitizeUploadedFileName(file.originalname);
      if (options.imageOnly && !isLikelyImageUpload(fileName, file.mimetype)) {
        continue;
      }
      const relativePath = sanitizeUploadedRelativePath(
        options.relativePaths?.[index] || file.originalname,
        fileName,
      );
      const folderPath = folderPathFromRelativePath(relativePath);
      sequence.push({ idx: index, fp: folderPath });
    }

    if (sequence.length === 0) return assignments;

    const allExisting = await db
      .collection<{ metadata?: MvStoredFileMetadata }>(MV_FILES_FILES_COLLECTION)
      .find({ "metadata.projectId": pid, "metadata.scope": "asset-images" })
      .project({ metadata: 1 })
      .toArray();

    const maxByFolder = new Map<string, number>();
    for (const doc of allExisting) {
      const fp = doc.metadata?.folderPath ?? "";
      const ord = doc.metadata?.displayOrder;
      if (typeof ord === "number") {
        maxByFolder.set(fp, Math.max(maxByFolder.get(fp) ?? Number.NEGATIVE_INFINITY, ord));
      }
    }

    const nextVal = new Map<string, number>();
    for (const { idx, fp } of sequence) {
      if (!nextVal.has(fp)) {
        nextVal.set(fp, (maxByFolder.get(fp) ?? -1) + 1);
      }
      const v = nextVal.get(fp)!;
      nextVal.set(fp, v + 1);
      assignments.set(idx, v);
    }

    return assignments;
  }

  async uploadProjectFiles(
    projectId: string,
    files: Express.Multer.File[],
    ctx: MvAccessContext,
    subProjectId?: string,
    options: MvUploadProjectFilesOptions = {},
  ) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException("At least one file is required");
    }

    const db = await getMongoDb();
    const pid = toId(projectId);
    const sid =
      subProjectId && subProjectId.trim().length > 0
        ? toId(subProjectId)
        : undefined;

    await this.assertSubProjectContext(db, pid, sid, ctx);
    const picAssetFolder = sid
      ? ((await db
          .collection<AssetDoc>(ASSETS_COLLECTION)
          .findOne({ _id: sid, projectId: pid, ...MV_PHOTO_FOLDER_FILTER })) as PicAssetMongoDoc | null)
      : null;
    const folderIsPicAsset = picAssetFolder != null;
    if (picAssetFolder) {
      if (options.scope !== "asset-images" || options.imageOnly !== true) {
        throw new BadRequestException("الأصل يقبل صور الأصول فقط.");
      }
      const photosRoot = await this.ensurePhotosRootFolder(db, pid);
      await this.assertPicAssetFolderCanReceiveImages(db, pid, photosRoot._id, picAssetFolder);
    }
    const bucket = this.getFilesBucket(db);
    const displayOrderByFileIndex =
      options.scope === "asset-images"
        ? await this.buildDisplayOrdersForIncomingAssetImages(db, pid, files, options)
        : new Map<number, number>();

    const tasks = files.map(
      (file, index): (() => Promise<ReturnType<typeof mapStoredFileDoc> | null>) =>
        async () => {
          if (!file) return null;

          let data: Buffer | undefined = file.buffer;
          if (!data || data.length === 0) {
            const diskPath = (file as Express.Multer.File & { path?: string }).path;
            if (diskPath) {
              try {
                data = await readFile(diskPath);
              } catch {
                data = undefined;
              }
            }
          }
          if (!data || data.length === 0) return null;

          const fileName = sanitizeUploadedFileName(file.originalname);
          if (options.imageOnly && !isLikelyImageUpload(fileName, file.mimetype)) {
            return null;
          }

          const relativePath = sanitizeUploadedRelativePath(
            options.relativePaths?.[index] || file.originalname,
            fileName,
          );
          const folderPath = folderPathFromRelativePath(relativePath);
          const assignedOrder = displayOrderByFileIndex.get(index);
          const now = new Date();
          const metadata: MvStoredFileMetadata = {
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

          const useSpaces =
            options.preferDigitalOcean === true &&
            !sid &&
            !folderIsPicAsset &&
            this.inspectorSpaces.isReady();

          if (useSpaces) {
            const fileId = new ObjectId();
            let uploaded: { key: string };
            try {
              uploaded = await this.inspectorSpaces.uploadInspectorFile({
                projectId,
                entryId: fileId.toString(),
                fileName,
                buffer: data,
                contentType: file.mimetype || "application/octet-stream",
              });
            } catch (err) {
              this.logger.error(
                `uploadProjectFiles Spaces (valuation): ${err instanceof Error ? err.message : String(err)}`,
              );
              throw new BadRequestException("فشل رفع الملف إلى DigitalOcean Spaces.");
            }
            const metadataDo: MvStoredFileMetadata = {
              ...metadata,
              storage: "digitalocean",
              spacesKey: uploaded.key,
            };
            await db.collection<{
              _id: ObjectId;
              filename?: string;
              length?: number;
              uploadDate?: Date;
              metadata?: MvStoredFileMetadata;
            }>(MV_FILES_FILES_COLLECTION).insertOne({
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

          const fileId = await new Promise<ObjectId>((resolve, reject) => {
            const uploadStream = bucket.openUploadStream(fileName, { metadata });
            uploadStream.on("error", reject);
            uploadStream.on("finish", () => resolve(uploadStream.id as ObjectId));
            uploadStream.end(data);
          });

          /** لا نُدرِج معرف ‎GridFS‎ داخل ‎assets.images‎ — يفسد هيكل كائنات الوسائط من التطبيق. */

          return mapStoredFileDoc({
            _id: fileId,
            filename: fileName,
            length: data.length,
            uploadDate: now,
            metadata,
          });
        },
    );

    const batch = await runWithConcurrency(
      tasks,
      MV_GRIDFS_PARALLEL_UPLOAD_LIMIT,
    );
    const uploaded = batch.filter(
      (row): row is NonNullable<(typeof batch)[number]> => row != null,
    );

    if (uploaded.length === 0) {
      throw new BadRequestException(
        "At least one non-empty file is required",
      );
    }

    return uploaded;
  }

  async getProjectFileDownload(projectId: string, fileId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
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
      } catch {
        throw new NotFoundException("File not found");
      }
    }

    return {
      file: mapStoredFileDoc(file),
      stream: this.getFilesBucket(db).openDownloadStream(fid),
    };
  }

  async deleteProjectFile(projectId: string, fileId: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const fid = toId(fileId);
    const file = await this.getStoredFileDoc(db, pid, fid);
    if (file.metadata?.storage === "digitalocean" && file.metadata.spacesKey?.trim()) {
      try {
        await this.inspectorSpaces.deleteObject(file.metadata.spacesKey.trim());
      } catch (err) {
        this.logger.warn(
          `deleteProjectFile Spaces: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await db.collection(MV_FILES_FILES_COLLECTION).deleteOne({ _id: fid, "metadata.projectId": pid });
    } else {
      await this.getFilesBucket(db).delete(fid);
    }
    await db.collection<AssetDoc>(ASSETS_COLLECTION).updateMany(
      { projectId: pid, ...MV_PHOTO_FOLDER_FILTER },
      {
        $pull: { images: { $in: [fid, fid.toString()] } },
        $set: { updatedAt: new Date() },
      },
    );
    return { ok: true };
  }

  async listSheets(projectId: string, ctx: MvAccessContext, subProjectId?: string) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const filter: Record<string, unknown> = { projectId: pid };
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
        spreadsheetMeta?: MvSpreadsheetMeta;
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
      rows: [] as Record<string, string | number | null>[],
      rowCount: s.rowCount,
      sourceType: s.sourceType,
      sourceFileName: s.sourceFileName,
      spreadsheetMeta: s.spreadsheetMeta,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));
  }

  async getSheet(id: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(id);
    const s = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({ _id });
    if (!s) throw new NotFoundException("Sheet not found");
    await this.loadProjectForAccess(db, s.projectId, ctx);

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
      spreadsheetMeta: s.spreadsheetMeta,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  async createSheet(
    body: {
      projectId: string;
      subProjectId?: string;
      name: string;
      headers: string[];
      rows: Record<string, string | number | null>[];
      sourceType: "file-import" | "manual";
      sourceFileName?: string;
      spreadsheetMeta?: MvSpreadsheetMeta;
    },
    ctx: MvAccessContext,
  ) {
    if (!body.name?.trim()) throw new BadRequestException("Sheet name required");
    const db = await getMongoDb();
    const projectOid = toId(body.projectId);
    await this.loadProjectForAccess(db, projectOid, ctx);
    const now = new Date();
    const headers = body.headers || [];
    const rowValues = recordsToRowValues(headers, body.rows || []);
    const spreadsheetMeta = sanitizeSpreadsheetMeta(
      body.spreadsheetMeta,
      rowValues.length,
      headers.length,
    );
    const doc: Omit<MvSheetDoc, "_id"> = {
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
      spreadsheetMeta: doc.spreadsheetMeta,
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
      spreadsheetMeta?: MvSpreadsheetMeta;
    },
    ctx: MvAccessContext,
  ) {
    const db = await getMongoDb();
    const _id = toId(id);
    const existingSheet = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({ _id });
    if (!existingSheet) throw new NotFoundException("Sheet not found");
    await this.loadProjectForAccess(db, existingSheet.projectId, ctx);
    const now = new Date();
    const $set: Record<string, unknown> = { updatedAt: now };
    const $unset: Record<string, "" | 1> = {};
    if (body.name) $set.name = body.name.trim();
    if (body.headers) $set.headers = body.headers;
    if (body.rows && body.headers) {
      $set.rowValues = recordsToRowValues(body.headers, body.rows);
      $unset.rows = "";
    } else if (body.rows && !body.headers) {
      const h = existingSheet.headers;
      $set.rowValues = recordsToRowValues(h, body.rows);
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
      const spreadsheetMeta = sanitizeSpreadsheetMeta(
        body.spreadsheetMeta,
        rowCount,
        headerCount,
      );
      if (spreadsheetMeta) $set.spreadsheetMeta = spreadsheetMeta;
      else $unset.spreadsheetMeta = "";
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
      spreadsheetMeta: updated.spreadsheetMeta,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteSheet(id: string, ctx: MvAccessContext) {
    const db = await getMongoDb();
    const _id = toId(id);
    const sheet = await db.collection<MvSheetDoc>(MV_SHEETS_COLLECTION).findOne({ _id });
    if (!sheet) throw new NotFoundException("Sheet not found");
    await this.loadProjectForAccess(db, sheet.projectId, ctx);
    const del = await db.collection(MV_SHEETS_COLLECTION).deleteOne({ _id });
    if (del.deletedCount === 0) throw new NotFoundException("Sheet not found");
    return { ok: true };
  }

  /** Delete every sheet for the project (root) or for one sub-project when subProjectId is set */
  async deleteAllSheets(projectId: string, ctx: MvAccessContext, subProjectId?: string) {
    const db = await getMongoDb();
    const pid = toId(projectId);
    await this.loadProjectForAccess(db, pid, ctx);
    const filter: Record<string, unknown> = { projectId: pid };
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
