"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationsService = void 0;
const common_1 = require("@nestjs/common");
const mongodb_1 = require("mongodb");
const mongodb_2 = require("../server/mongodb");
const locationsModule_1 = require("../server/models/locationsModule");
function toRegionJson(d) {
    return {
        id: d._id.toString(),
        titleAr: d.titleAr,
        titleEn: d.titleEn,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
function toCityJson(d) {
    return {
        id: d._id.toString(),
        titleAr: d.titleAr,
        titleEn: d.titleEn,
        descriptionAr: d.descriptionAr ?? "",
        descriptionEn: d.descriptionEn ?? "",
        regionId: d.regionId,
        active: d.active,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
function toNeighborhoodJson(d) {
    return {
        id: d._id.toString(),
        titleAr: d.titleAr,
        titleEn: d.titleEn,
        descriptionAr: d.descriptionAr ?? "",
        descriptionEn: d.descriptionEn ?? "",
        regionId: d.regionId,
        cityId: d.cityId,
        active: d.active,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
    };
}
let LocationsService = class LocationsService {
    async listRegions() {
        const db = await (0, mongodb_2.getMongoDb)();
        const rows = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .find({})
            .sort({ titleEn: 1 })
            .toArray();
        return rows.map(toRegionJson);
    }
    async createRegion(body) {
        const titleAr = (body.titleAr ?? "").trim();
        const titleEn = (body.titleEn ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const doc = {
            titleAr,
            titleEn,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toRegionJson(row);
    }
    async updateRegion(id, body) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المنطقة غير موجودة" });
        const titleAr = (body.titleAr ?? "").trim();
        const titleEn = (body.titleEn ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, { $set: { titleAr, titleEn, updatedAt: new Date() } }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "المنطقة غير موجودة" });
        return toRegionJson(row);
    }
    async deleteRegion(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المنطقة غير موجودة" });
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "المنطقة غير موجودة" });
        return { ok: true };
    }
    async listCities(regionId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const filter = regionId ? { regionId } : {};
        const rows = await db
            .collection(locationsModule_1.CITIES_COLLECTION)
            .find(filter)
            .sort({ titleEn: 1 })
            .toArray();
        return rows.map(toCityJson);
    }
    async createCity(body) {
        const titleAr = (body.titleAr ?? "").trim();
        const titleEn = (body.titleEn ?? "").trim();
        const regionId = (body.regionId ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        if (!regionId)
            throw new common_1.BadRequestException({ message: "regionId مطلوب" });
        if (!mongodb_1.ObjectId.isValid(regionId))
            throw new common_1.BadRequestException({ message: "regionId غير صالح" });
        const db = await (0, mongodb_2.getMongoDb)();
        const regionOk = await db
            .collection(locationsModule_1.REGIONS_COLLECTION)
            .findOne({ _id: new mongodb_1.ObjectId(regionId) });
        if (!regionOk)
            throw new common_1.BadRequestException({ message: "المنطقة غير موجودة" });
        const now = new Date();
        const doc = {
            titleAr,
            titleEn,
            descriptionAr: (body.descriptionAr ?? "").trim(),
            descriptionEn: (body.descriptionEn ?? "").trim(),
            regionId,
            active: body.active !== false,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(locationsModule_1.CITIES_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(locationsModule_1.CITIES_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toCityJson(row);
    }
    async updateCity(id, body) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المدينة غير موجودة" });
        const titleAr = (body.titleAr ?? "").trim();
        const titleEn = (body.titleEn ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(locationsModule_1.CITIES_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, {
            $set: {
                titleAr,
                titleEn,
                descriptionAr: (body.descriptionAr ?? "").trim(),
                descriptionEn: (body.descriptionEn ?? "").trim(),
                ...(body.regionId ? { regionId: body.regionId } : {}),
                ...(body.active !== undefined ? { active: body.active } : {}),
                updatedAt: new Date(),
            },
        }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "المدينة غير موجودة" });
        return toCityJson(row);
    }
    async deleteCity(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "المدينة غير موجودة" });
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db
            .collection(locationsModule_1.CITIES_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "المدينة غير موجودة" });
        return { ok: true };
    }
    async listNeighborhoods(regionId, cityId) {
        const db = await (0, mongodb_2.getMongoDb)();
        const filter = {};
        if (regionId)
            filter.regionId = regionId;
        if (cityId)
            filter.cityId = cityId;
        const rows = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .find(filter)
            .sort({ titleEn: 1 })
            .toArray();
        return rows.map(toNeighborhoodJson);
    }
    async createNeighborhood(body) {
        const titleAr = (body.titleAr ?? "").trim();
        const titleEn = (body.titleEn ?? "").trim();
        const regionId = (body.regionId ?? "").trim();
        const cityId = (body.cityId ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        if (!regionId)
            throw new common_1.BadRequestException({ message: "regionId مطلوب" });
        if (!cityId)
            throw new common_1.BadRequestException({ message: "cityId مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const doc = {
            titleAr,
            titleEn,
            descriptionAr: (body.descriptionAr ?? "").trim(),
            descriptionEn: (body.descriptionEn ?? "").trim(),
            regionId,
            cityId,
            active: body.active !== false,
            createdAt: now,
            updatedAt: now,
        };
        const { insertedId } = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .insertOne(doc);
        const row = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .findOne({ _id: insertedId });
        if (!row)
            throw new common_1.NotFoundException();
        return toNeighborhoodJson(row);
    }
    async updateNeighborhood(id, body) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "الحي غير موجود" });
        const titleAr = (body.titleAr ?? "").trim();
        if (!titleAr)
            throw new common_1.BadRequestException({ message: "titleAr مطلوب" });
        const db = await (0, mongodb_2.getMongoDb)();
        const row = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .findOneAndUpdate({ _id: new mongodb_1.ObjectId(id) }, {
            $set: {
                titleAr,
                titleEn: (body.titleEn ?? "").trim(),
                descriptionAr: (body.descriptionAr ?? "").trim(),
                descriptionEn: (body.descriptionEn ?? "").trim(),
                ...(body.regionId ? { regionId: body.regionId } : {}),
                ...(body.cityId ? { cityId: body.cityId } : {}),
                ...(body.active !== undefined ? { active: body.active } : {}),
                updatedAt: new Date(),
            },
        }, { returnDocument: "after" });
        if (!row)
            throw new common_1.NotFoundException({ message: "الحي غير موجود" });
        return toNeighborhoodJson(row);
    }
    async deleteNeighborhood(id) {
        if (!mongodb_1.ObjectId.isValid(id))
            throw new common_1.NotFoundException({ message: "الحي غير موجود" });
        const db = await (0, mongodb_2.getMongoDb)();
        const del = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .deleteOne({ _id: new mongodb_1.ObjectId(id) });
        if (del.deletedCount === 0)
            throw new common_1.NotFoundException({ message: "الحي غير موجود" });
        return { ok: true };
    }
    async bulkSeedRegions(items) {
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const docs = items.map((r) => ({ ...r, createdAt: now, updatedAt: now }));
        if (docs.length === 0)
            return { inserted: 0 };
        const result = await db.collection(locationsModule_1.REGIONS_COLLECTION).insertMany(docs);
        return { inserted: result.insertedCount };
    }
    async bulkSeedCities(items) {
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const docs = items.map((c) => ({
            ...c,
            descriptionAr: "",
            descriptionEn: "",
            createdAt: now,
            updatedAt: now,
        }));
        if (docs.length === 0)
            return { inserted: 0 };
        const result = await db.collection(locationsModule_1.CITIES_COLLECTION).insertMany(docs);
        return { inserted: result.insertedCount };
    }
    async bulkSeedNeighborhoods(items) {
        const db = await (0, mongodb_2.getMongoDb)();
        const now = new Date();
        const docs = items.map((n) => ({
            ...n,
            descriptionAr: "",
            descriptionEn: "",
            createdAt: now,
            updatedAt: now,
        }));
        if (docs.length === 0)
            return { inserted: 0 };
        const result = await db
            .collection(locationsModule_1.NEIGHBORHOODS_COLLECTION)
            .insertMany(docs);
        return { inserted: result.insertedCount };
    }
};
exports.LocationsService = LocationsService;
exports.LocationsService = LocationsService = __decorate([
    (0, common_1.Injectable)()
], LocationsService);
