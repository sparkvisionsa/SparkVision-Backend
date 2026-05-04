"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsMongoService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const transactions_model_1 = require("./transactions.model");
const clientsModule_1 = require("../server/models/clientsModule");
function toTransactionJson(d) {
    const evalData = { ...(0, transactions_model_1.emptyEvalData)(), ...(d.evalData ?? {}) };
    return {
        id: d._id.toString(),
        assignmentNumber: d.assignmentNumber,
        authorizationNumber: d.authorizationNumber,
        assignmentDate: d.assignmentDate,
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
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
function normalizeTransactionBody(body) {
    const str = (k) => typeof body[k] === "string" ? body[k].trim() : "";
    const assignmentNumber = str("assignmentNumber");
    if (!assignmentNumber)
        throw new common_1.BadRequestException({ message: "رقم التكليف مطلوب" });
    const clientId = str("clientId");
    if (!clientId)
        throw new common_1.BadRequestException({ message: "العميل مطلوب" });
    const templateId = typeof body.templateId === "string" && body.templateId
        ? body.templateId
        : null;
    const rawFieldValues = {};
    const nested = body["templateFieldValues"];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        for (const [k, v] of Object.entries(nested)) {
            if (typeof v === "string")
                rawFieldValues[k] = v.trim();
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
function extractEvalData(body) {
    const empty = (0, transactions_model_1.emptyEvalData)();
    const str = (k) => {
        const v = body.evalData?.[k];
        return typeof v === "string" ? v.trim() : empty[k];
    };
    const arr = (k) => {
        const v = body.evalData?.[k];
        return Array.isArray(v) ? v : empty[k];
    };
    return {
        status: str("status") || "new",
        regionId: str("regionId"),
        regionName: str("regionName"),
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
        northBoundary: str("northBoundary"),
        northLength: str("northLength"),
        southBoundary: str("southBoundary"),
        southLength: str("southLength"),
        eastBoundary: str("eastBoundary"),
        eastLength: str("eastLength"),
        westBoundary: str("westBoundary"),
        westLength: str("westLength"),
        buildingState: str("buildingState"),
        floorsCount: str("floorsCount"),
        propertyAge: str("propertyAge"),
        finishLevel: str("finishLevel"),
        buildQuality: str("buildQuality"),
        street: str("street"),
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
        settlementWeights: arr("settlementWeights"),
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
    };
}
function mergeFileFields(rawFieldValues, files) {
    const merged = { ...rawFieldValues };
    for (const file of files) {
        const fieldId = file.fieldname.replace(/^file__/, "");
        merged[fieldId] = `/uploads/${file.filename}`;
    }
    return merged;
}
async function buildEnrichedFieldValues(db, templateId, rawFieldValues) {
    if (!templateId)
        return {};
    if (!mongodb_1.ObjectId.isValid(templateId))
        throw new common_1.BadRequestException({ message: "النموذج غير صالح" });
    const tpl = await db
        .collection(clientsModule_1.FORM_TEMPLATES_COLLECTION)
        .findOne({ _id: new mongodb_1.ObjectId(templateId) });
    if (!tpl)
        throw new common_1.BadRequestException({ message: "النموذج غير موجود" });
    const result = {};
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
let TransactionsMongoService = class TransactionsMongoService {
    async listTransactions() {
        const db = await (0, mongodb_2.getMongoDb)();
        const rows = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .find({})
            .sort({ createdAt: -1 })
            .toArray();
        return rows.map(toTransactionJson);
    }
    async getTransaction(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(id) });
        if (!row)
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        return toTransactionJson(row);
    }
    async createTransaction(body, files) {
        const { rawFieldValues, templateId, ...normalized } = normalizeTransactionBody(body);
        const db = await (0, mongodb_2.getMongoDb)();
        if (!mongodb_1.ObjectId.isValid(normalized.clientId))
            throw new common_1.BadRequestException({ message: "العميل غير صالح" });
        const client = await db
            .collection(clientsModule_1.CLIENTS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(normalized.clientId) });
        if (!client)
            throw new common_1.BadRequestException({ message: "العميل غير موجود" });
        const mergedFieldValues = mergeFileFields(rawFieldValues, files);
        const templateFieldValues = await buildEnrichedFieldValues(db, templateId, mergedFieldValues);
        const now = new Date();
        const doc = {
            ...normalized,
            templateId,
            templateFieldValues,
            evalData: (0, transactions_model_1.emptyEvalData)(),
            createdAt: now,
            priority: body.priority ?? "normal",
            attachmentsCount: 0,
            imagesCount: 0,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toTransactionJson(row);
    }
    async updateTransaction(id, body, files) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        const db = await (0, mongodb_2.getMongoDb)();
        const evalData = extractEvalData(body);
        const now = new Date();
        const row = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, { $set: { evalData, updatedAt: now } }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        return toTransactionJson(row);
    }
    async deleteTransaction(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db
            .collection(transactions_model_1.TRANSACTIONS_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "المعاملة غير موجودة" });
        return { ok: true };
    }
};
exports.TransactionsMongoService = TransactionsMongoService;
exports.TransactionsMongoService = TransactionsMongoService = __decorate([
    (0, common_1.Injectable)()
], TransactionsMongoService);
