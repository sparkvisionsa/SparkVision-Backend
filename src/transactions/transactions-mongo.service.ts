import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";

import {
  TRANSACTIONS_COLLECTION,
  type TransactionDoc,
  type SavedFieldEntry,
  type EvalData,
  type AvailableServices,
  emptyEvalData,
  emptyAvailableServices,
} from "./transactions.model";

import {
  CLIENTS_COLLECTION,
  FORM_TEMPLATES_COLLECTION,
  type ClientDoc,
  type FormTemplateDoc,
} from "@/server/models/clientsModule";

// ─── serialiser ───────────────────────────────────────────────────────────────

function toTransactionJson(d: TransactionDoc) {
  const evalData: EvalData = { ...emptyEvalData(), ...(d.evalData ?? {}) };

  return {
    id: d._id.toString(),

    // core
    assignmentNumber: d.assignmentNumber,
    authorizationNumber: d.authorizationNumber,
    assignmentDate: d.assignmentDate,
    assignedInspectorIds: d.assignedInspectorIds ?? [],

    valuationPurpose: d.valuationPurpose,
    priority: d.priority ?? "normal",
    attachmentsCount: d.attachmentsCount ?? 0,
    imagesCount: d.imagesCount ?? 0,
    intendedUse: d.intendedUse,
    valuationBasis: d.valuationBasis,
    ownershipType: d.ownershipType,
    valuationHypothesis: d.valuationHypothesis,
    clientId: d.clientId,
    branch: d.branch,
    templateId: d.templateId,

    templateFieldValues: d.templateFieldValues ?? {},
    evalData,

    // ── add these two ──────────────────────────────────────────────────────
    isOpened: d.isOpened ?? false,
    isCompleted: d.isCompleted ?? false,
    // ──────────────────────────────────────────────────────────────────────

    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
// ─── helpers ──────────────────────────────────────────────────────────────────

function normalizeTransactionBody(body: Record<string, unknown>) {
  const str = (k: string) =>
    typeof body[k] === "string" ? (body[k] as string).trim() : "";

  const assignmentNumber = str("assignmentNumber");
  if (!assignmentNumber)
    throw new BadRequestException({ message: "رقم التكليف مطلوب" });

  const clientId = str("clientId");
  if (!clientId) throw new BadRequestException({ message: "العميل مطلوب" });

  const templateId =
    typeof body.templateId === "string" && body.templateId
      ? body.templateId
      : null;

  const rawFieldValues: Record<string, string> = {};
  const nested = body["templateFieldValues"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof v === "string") rawFieldValues[k] = v.trim();
    }
  }

  return {
    assignmentNumber,
    authorizationNumber: str("authorizationNumber"),
    assignmentDate: str("assignmentDate"),
    valuationPurpose: str("valuationPurpose"),
    intendedUse: str("intendedUse"),
    valuationBasis: str("valuationBasis"),
    ownershipType: str("ownershipType"),
    valuationHypothesis: str("valuationHypothesis"),
    clientId,
    branch: str("branch"),
    templateId,
    rawFieldValues,
  };
}

// Extracts evalData from a PATCH body.
// The body is sent as application/json from the evaluation page so all values
// arrive already parsed — no FormData / JSON.parse juggling needed.
function extractEvalData(body: Record<string, unknown>): EvalData {
  const empty = emptyEvalData();
  const raw = (body.evalData as any) ?? {};
  const str = (k: keyof EvalData): string => {
    const v = (body.evalData as any)?.[k];
    return typeof v === "string" ? v.trim() : (empty[k] as string);
  };
  const arr = <T>(k: keyof EvalData): T[] => {
    const v = (body.evalData as any)?.[k];
    return Array.isArray(v) ? v : (empty[k] as T[]);
  };

  const extractAvailableServices = (): AvailableServices => {
    const src = raw["availableServices"];
    if (src && typeof src === "object" && !Array.isArray(src)) {
      const boolOrNull = (k: keyof AvailableServices): boolean | null => {
        const v = src[k];
        if (v === true || v === false) return v;
        return null;
      };
      const numOrNull = (k: keyof AvailableServices): number | null => {
        const v = src[k];
        if (typeof v === "number") return v;
        if (typeof v === "string" && v.trim() !== "") {
          const n = Number(v);
          return isNaN(n) ? null : n;
        }
        return null;
      };
      return {
        electricity: boolOrNull("electricity"),
        electricityUnits: numOrNull("electricityUnits"),
        sanitaryDrainage: boolOrNull("sanitaryDrainage"),
        telephoneLine: boolOrNull("telephoneLine"),
        waterMetersCount: numOrNull("waterMetersCount"),
        electricityMetersCount: numOrNull("electricityMetersCount"),
      };
    }
    return emptyAvailableServices();
  };

  return {
    status: str("status") || "new",
    regionId: str("regionId"),
    regionName: str("regionName"),
    opponentStatements: str("opponentStatements"),
    cityId: str("cityId"),
    cityName: str("cityName"),
    neighborhoodId: str("neighborhoodId"),
    neighborhoodName: str("neighborhoodName"),
    assetCategoryId: str("assetCategoryId"),
    propertyTypeId: str("propertyTypeId"),
    address: str("address"),
    inspector: str("inspector"),
    contactNo: str("contactNo"),
    reviewer: str("reviewer"),
    propertyCode: str("propertyCode"),
    deedNumber: str("deedNumber"),
    deedDate: str("deedDate"),
    ownerName: str("ownerName"),
    propertyType: str("propertyType"),
    landUse: str("landUse"),
    propertyArea: str("propertyArea"),
    clientName: str("clientName"),
    authorizedName: str("authorizedName"),
    authorizedLandCoverPct: str("authorizedLandCoverPct"),
    streetWidth: str("streetWidth"),
    streetFronts: str("streetFronts"),
    northBoundary: str("northBoundary"),
    northLength: str("northLength"),
    southBoundary: str("southBoundary"),
    southLength: str("southLength"),
    eastBoundary: str("eastBoundary"),
    eastLength: str("eastLength"),
    westBoundary: str("westBoundary"),
    westLength: str("westLength"),
    buildingCondition: (() => {
      const src = raw["buildingCondition"];
      if (src && typeof src === "object" && !Array.isArray(src)) {
        return {
          status: typeof src.status === "string" ? src.status.trim() : "",
          completionPct:
            typeof src.completionPct === "number"
              ? src.completionPct
              : src.completionPct !== null &&
                  src.completionPct !== undefined &&
                  src.completionPct !== ""
                ? parseFloat(src.completionPct)
                : null,
          otherText:
            typeof src.otherText === "string" ? src.otherText.trim() : "",
        };
      }
      return { status: "", completionPct: null, otherText: "" };
    })(),
    floorsCount: str("floorsCount"),
    propertyAge: str("propertyAge"),
    finishLevel: str("finishLevel"),
    buildQuality: str("buildQuality"),
    street: str("street"),
    availableServices: extractAvailableServices(),
    surroundingEnvironment: arr<string>("surroundingEnvironment"),
    coords: str("coords"),
    lat: str("lat"),
    lng: str("lng"),
    zoomMap: str("zoomMap"),
    zoomAerial: str("zoomAerial"),
    zoomComparisons: str("zoomComparisons"),
    evalDate: str("evalDate"),
    completedDate: str("completedDate"),
    reportDate: str("reportDate"),
    finalAssetValue: str("finalAssetValue"),
    appraiserDesc: str("appraiserDesc"),
    appraiserNotes: str("appraiserNotes"),
    marketMeterPrice: str("marketMeterPrice"),
    marketWeightPct: str("marketWeightPct"),
    marketMethodTotal: str("marketMethodTotal"),
    marketReason: str("marketReason"),
    landTitle: str("landTitle"),
    landSpace: str("landSpace"),
    propertyAreaMethod: str("propertyAreaMethod"),
    costNetBuildings: str("costNetBuildings"),
    costNetLandPrice: str("costNetLandPrice"),
    costLandBuildTotal: str("costLandBuildTotal"),
    costReason: str("costReason"),
    incomeTotal: str("incomeTotal"),
    incomeReason: str("incomeReason"),
    standards: str("standards"),
    scope: str("scope"),
    assumptions: str("assumptions"),
    risks: str("risks"),
    author1Id: str("author1Id"),
    author1Title: str("author1Title"),
    author2Id: str("author2Id"),
    author2Title: str("author2Title"),
    author3Id: str("author3Id"),
    author3Title: str("author3Title"),
    author4Id: str("author4Id"),
    author4Title: str("author4Title"),
    comparisonRows: arr("comparisonRows"),
    section1Rows: arr("section1Rows"),
    settlementRows: arr("settlementRows"),
    settlementBases: arr("settlementBases"),
    settlementWeights: arr<string>("settlementWeights"),
    replacementLines: arr("replacementLines"),
    meterPriceLand: str("meterPriceLand"),
    managementPct: str("managementPct"),
    professionalPct: str("professionalPct"),
    utilityNetworkPct: str("utilityNetworkPct"),
    emergencyPct: str("emergencyPct"),
    financePct: str("financePct"),
    yearDev: str("yearDev"),
    earningsRate: str("earningsRate"),
    buildAge: str("buildAge"),
    defaultAge: str("defaultAge"),
    depreciationPct: str("depreciationPct"),
    economicPct: str("economicPct"),
    careerPct: str("careerPct"),
    maintenancePrice: str("maintenancePrice"),
    finishesPrice: str("finishesPrice"),
    completionPct: str("completionPct"),
    maintenanceDesc: str("maintenanceDesc"),
    finishesDesc: str("finishesDesc"),
    replacementNotes: str("replacementNotes"),
    investmentEntries: arr("investmentEntries"),
    residualValueEntries: arr("residualValueEntries"),
    dcfEntries: arr("dcfEntries"),
    rentalValueEntries: arr("rentalValueEntries"),
    previousDeedNumber: str("previousDeedNumber"),
    previousDeedDate: str("previousDeedDate"),
    operationType: str("operationType"),
    propertyStatus: str("propertyStatus"),
    restrictions: str("restrictions"),
    ownerId: str("ownerId"),
    ownerNationality: str("ownerNationality"),
    ownershipPercentage: str("ownershipPercentage"),
    subDivisionRecordNumber: str("subDivisionRecordNumber"),
    otherUsers: str("otherUsers"),
    deedSource: str("deedSource"),
    buildingLicense: str("buildingLicense"),
    buildingLicenseDate: str("buildingLicenseDate"),
    elevation: str("elevation"),
    inspectionBoundaries: str("inspectionBoundaries"),
    propertyId: str("propertyId"),
    parcelNumber: str("parcelNumber"),
    blockNumber: str("blockNumber"),
    districtPart: str("districtPart"),
    propertyModel: str("propertyModel"),
    locationDescription: str("locationDescription"),
    planNumber: str("planNumber"),
  };
}

function mergeFileFields(
  rawFieldValues: Record<string, string>,
  files: Express.Multer.File[],
): Record<string, string> {
  const merged = { ...rawFieldValues };
  for (const file of files) {
    const fieldId = file.fieldname.replace(/^file__/, "");
    merged[fieldId] = `/uploads/${file.filename}`;
  }
  return merged;
}

async function buildEnrichedFieldValues(
  db: Awaited<ReturnType<typeof getMongoDb>>,
  templateId: string | null,
  rawFieldValues: Record<string, string>,
): Promise<Record<string, SavedFieldEntry>> {
  if (!templateId) return {};
  if (!ObjectId.isValid(templateId))
    throw new BadRequestException({ message: "النموذج غير صالح" });

  const tpl = await db
    .collection<FormTemplateDoc>(FORM_TEMPLATES_COLLECTION)
    .findOne({ _id: new ObjectId(templateId) });
  if (!tpl) throw new BadRequestException({ message: "النموذج غير موجود" });

  const result: Record<string, SavedFieldEntry> = {};
  for (const field of tpl.fields) {
    if (field.id in rawFieldValues) {
      result[field.id] = {
        label: field.label,
        value: rawFieldValues[field.id],
      };
    }
  }
  return result;
}

// ─── service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TransactionsMongoService {
  async listTransactions(
    companyId?: string | null,
    inspectorId?: string | null,
  ) {
    const db = await getMongoDb();

    const filter: Record<string, unknown> = {};
    if (companyId) filter.companyId = companyId;
    if (inspectorId) filter.assignedInspectorIds = inspectorId;
    // ↑ MongoDB's $elemMatch isn't needed for a simple string array —
    //   { assignedInspectorIds: "someId" } already matches docs where
    //   the array contains that value.

    const rows = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    return rows.map(toTransactionJson);
  }

  async listFreelanceInspectors() {
    const db = await getMongoDb();
    // Import your users collection name — adjust if different
    const users = await db
      .collection("users")
      .find({ role: "Freelance Inspector", isBlocked: { $ne: true } })
      .project({
        _id: 1,
        name: 1,
        phone: 1,
        serviceCities: 1,
        isPhoneVerified: 1,
      })
      .sort({ createdAt: -1 })
      .toArray();

    return users.map((u) => ({
      id: u._id.toString(),
      name: u.name ?? "",
      phone: u.phone ?? "",
      serviceCities: Array.isArray(u.serviceCities) ? u.serviceCities : [],
      isPhoneVerified: u.isPhoneVerified ?? false,
    }));
  }

  async setCompleted(id: string, isCompleted: boolean) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المعاملة غير موجودة" });
    const db = await getMongoDb();
    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { isCompleted, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return toTransactionJson(row);
  }

  async assignInspectors(id: string, inspectorIds: string[]) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المعاملة غير موجودة" });
    const db = await getMongoDb();
    const now = new Date();
    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { assignedInspectorIds: inspectorIds, updatedAt: now } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return toTransactionJson(row);
  }

  async getTransaction(id: string, markOpened = false) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المعاملة غير موجودة" });
    const db = await getMongoDb();

    if (markOpened) {
      await db
        .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
        .updateOne(
          { _id: new ObjectId(id), isOpened: { $ne: true } },
          { $set: { isOpened: true, updatedAt: new Date() } },
        );
    }

    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOne({ _id: new ObjectId(id) });
    if (!row) throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return toTransactionJson(row);
  }

  async createTransaction(
    body: Record<string, string>,
    files: Express.Multer.File[],
    meta: { createdByUserId?: string | null; companyId?: string | null } = {},
  ) {
    const { rawFieldValues, templateId, ...normalized } =
      normalizeTransactionBody(body);
    const db = await getMongoDb();

    if (!ObjectId.isValid(normalized.clientId))
      throw new BadRequestException({ message: "العميل غير صالح" });
    const client = await db
      .collection<ClientDoc>(CLIENTS_COLLECTION)
      .findOne({ _id: new ObjectId(normalized.clientId) });
    if (!client) throw new BadRequestException({ message: "العميل غير موجود" });

    const mergedFieldValues = mergeFileFields(rawFieldValues, files);
    const templateFieldValues = await buildEnrichedFieldValues(
      db,
      templateId,
      mergedFieldValues,
    );

    const now = new Date();
    const doc: Omit<TransactionDoc, "_id"> = {
      ...normalized,
      templateId,
      templateFieldValues,
      evalData: {
        ...emptyEvalData(),
        opponentStatements: body.opponentStatements?.trim() ?? "",
      },
      createdByUserId: meta.createdByUserId ?? null,
      companyId: meta.companyId ?? null,
      createdAt: now,
      priority: (body as any).priority ?? "normal",
      attachmentsCount: 0,
      imagesCount: 0,
      updatedAt: now,
    };

    const { insertedId } = await db
      .collection(TRANSACTIONS_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toTransactionJson(row);
  }

  // PATCH — only evalData is updated; templateFieldValues is never touched
  async updateTransaction(
    id: string,
    body: Record<string, unknown>,
    files: Express.Multer.File[],
  ) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المعاملة غير موجودة" });

    const db = await getMongoDb();
    const evalData = extractEvalData(body);

    const now = new Date();
    const row = await db
      .collection<TransactionDoc>(TRANSACTIONS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { evalData, updatedAt: now } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return toTransactionJson(row);
  }

  async deleteTransaction(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المعاملة غير موجودة" });
    const db = await getMongoDb();
    const del = await db
      .collection(TRANSACTIONS_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "المعاملة غير موجودة" });
    return { ok: true };
  }
}
