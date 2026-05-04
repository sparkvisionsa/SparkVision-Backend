import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ObjectId } from "mongodb";
import { getMongoDb } from "@/server/mongodb";
import {
  CITIES_COLLECTION,
  NEIGHBORHOODS_COLLECTION,
  REGIONS_COLLECTION,
  type CityDoc,
  type NeighborhoodDoc,
  type RegionDoc,
} from "@/server/models/locationsModule";

// ─── Serializers ─────────────────────────────────────────────────────────────

function toRegionJson(d: RegionDoc) {
  return {
    id: d._id.toString(),
    titleAr: d.titleAr,
    titleEn: d.titleEn,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toCityJson(d: CityDoc) {
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

function toNeighborhoodJson(d: NeighborhoodDoc) {
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

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class LocationsService {
  // ── Regions ──────────────────────────────────────────────────────────────

  async listRegions() {
    const db = await getMongoDb();
    const rows = await db
      .collection<RegionDoc>(REGIONS_COLLECTION)
      .find({})
      .sort({ titleEn: 1 })
      .toArray();
    return rows.map(toRegionJson);
  }

  async createRegion(body: { titleAr?: string; titleEn?: string }) {
    const titleAr = (body.titleAr ?? "").trim();
    const titleEn = (body.titleEn ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });

    const db = await getMongoDb();
    const now = new Date();
    const doc: Omit<RegionDoc, "_id"> = {
      titleAr,
      titleEn,
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await db
      .collection(REGIONS_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<RegionDoc>(REGIONS_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toRegionJson(row);
  }

  async updateRegion(id: string, body: { titleAr?: string; titleEn?: string }) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المنطقة غير موجودة" });
    const titleAr = (body.titleAr ?? "").trim();
    const titleEn = (body.titleEn ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });

    const db = await getMongoDb();
    const row = await db
      .collection<RegionDoc>(REGIONS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { titleAr, titleEn, updatedAt: new Date() } },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "المنطقة غير موجودة" });
    return toRegionJson(row);
  }

  async deleteRegion(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المنطقة غير موجودة" });
    const db = await getMongoDb();
    const del = await db
      .collection(REGIONS_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "المنطقة غير موجودة" });
    return { ok: true };
  }

  // ── Cities ────────────────────────────────────────────────────────────────

  async listCities(regionId?: string) {
    const db = await getMongoDb();
    const filter = regionId ? { regionId } : {};
    const rows = await db
      .collection<CityDoc>(CITIES_COLLECTION)
      .find(filter)
      .sort({ titleEn: 1 })
      .toArray();
    return rows.map(toCityJson);
  }

  async createCity(body: {
    titleAr?: string;
    titleEn?: string;
    descriptionAr?: string;
    descriptionEn?: string;
    regionId?: string;
    active?: boolean;
  }) {
    const titleAr = (body.titleAr ?? "").trim();
    const titleEn = (body.titleEn ?? "").trim();
    const regionId = (body.regionId ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });
    if (!regionId) throw new BadRequestException({ message: "regionId مطلوب" });
    if (!ObjectId.isValid(regionId))
      throw new BadRequestException({ message: "regionId غير صالح" });

    const db = await getMongoDb();
    const regionOk = await db
      .collection(REGIONS_COLLECTION)
      .findOne({ _id: new ObjectId(regionId) });
    if (!regionOk)
      throw new BadRequestException({ message: "المنطقة غير موجودة" });

    const now = new Date();
    const doc: Omit<CityDoc, "_id"> = {
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
      .collection(CITIES_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<CityDoc>(CITIES_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toCityJson(row);
  }

  async updateCity(
    id: string,
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      active?: boolean;
    },
  ) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المدينة غير موجودة" });
    const titleAr = (body.titleAr ?? "").trim();
    const titleEn = (body.titleEn ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });

    const db = await getMongoDb();
    const row = await db
      .collection<CityDoc>(CITIES_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            titleAr,
            titleEn,
            descriptionAr: (body.descriptionAr ?? "").trim(),
            descriptionEn: (body.descriptionEn ?? "").trim(),
            ...(body.regionId ? { regionId: body.regionId } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "المدينة غير موجودة" });
    return toCityJson(row);
  }

  async deleteCity(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "المدينة غير موجودة" });
    const db = await getMongoDb();
    const del = await db
      .collection(CITIES_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "المدينة غير موجودة" });
    return { ok: true };
  }

  // ── Neighborhoods ─────────────────────────────────────────────────────────

  async listNeighborhoods(regionId?: string, cityId?: string) {
    const db = await getMongoDb();
    const filter: Record<string, unknown> = {};
    if (regionId) filter.regionId = regionId;
    if (cityId) filter.cityId = cityId;
    const rows = await db
      .collection<NeighborhoodDoc>(NEIGHBORHOODS_COLLECTION)
      .find(filter)
      .sort({ titleEn: 1 })
      .toArray();
    return rows.map(toNeighborhoodJson);
  }

  async createNeighborhood(body: {
    titleAr?: string;
    titleEn?: string;
    descriptionAr?: string;
    descriptionEn?: string;
    regionId?: string;
    cityId?: string;
    active?: boolean;
  }) {
    const titleAr = (body.titleAr ?? "").trim();
    const titleEn = (body.titleEn ?? "").trim();
    const regionId = (body.regionId ?? "").trim();
    const cityId = (body.cityId ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });
    if (!regionId) throw new BadRequestException({ message: "regionId مطلوب" });
    if (!cityId) throw new BadRequestException({ message: "cityId مطلوب" });

    const db = await getMongoDb();
    const now = new Date();
    const doc: Omit<NeighborhoodDoc, "_id"> = {
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
      .collection(NEIGHBORHOODS_COLLECTION)
      .insertOne(doc);
    const row = await db
      .collection<NeighborhoodDoc>(NEIGHBORHOODS_COLLECTION)
      .findOne({ _id: insertedId });
    if (!row) throw new NotFoundException();
    return toNeighborhoodJson(row);
  }

  async updateNeighborhood(
    id: string,
    body: {
      titleAr?: string;
      titleEn?: string;
      descriptionAr?: string;
      descriptionEn?: string;
      regionId?: string;
      cityId?: string;
      active?: boolean;
    },
  ) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "الحي غير موجود" });
    const titleAr = (body.titleAr ?? "").trim();
    if (!titleAr) throw new BadRequestException({ message: "titleAr مطلوب" });

    const db = await getMongoDb();
    const row = await db
      .collection<NeighborhoodDoc>(NEIGHBORHOODS_COLLECTION)
      .findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
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
        },
        { returnDocument: "after" },
      );
    if (!row) throw new NotFoundException({ message: "الحي غير موجود" });
    return toNeighborhoodJson(row);
  }

  async deleteNeighborhood(id: string) {
    if (!ObjectId.isValid(id))
      throw new NotFoundException({ message: "الحي غير موجود" });
    const db = await getMongoDb();
    const del = await db
      .collection(NEIGHBORHOODS_COLLECTION)
      .deleteOne({ _id: new ObjectId(id) });
    if (del.deletedCount === 0)
      throw new NotFoundException({ message: "الحي غير موجود" });
    return { ok: true };
  }

  // ── Bulk seed (called from migration/seed script) ─────────────────────────

  async bulkSeedRegions(items: Array<{ titleAr: string; titleEn: string }>) {
    const db = await getMongoDb();
    const now = new Date();
    const docs = items.map((r) => ({ ...r, createdAt: now, updatedAt: now }));
    if (docs.length === 0) return { inserted: 0 };
    const result = await db.collection(REGIONS_COLLECTION).insertMany(docs);
    return { inserted: result.insertedCount };
  }

  async bulkSeedCities(
    items: Array<{
      titleAr: string;
      titleEn: string;
      regionId: string;
      active: boolean;
    }>,
  ) {
    const db = await getMongoDb();
    const now = new Date();
    const docs = items.map((c) => ({
      ...c,
      descriptionAr: "",
      descriptionEn: "",
      createdAt: now,
      updatedAt: now,
    }));
    if (docs.length === 0) return { inserted: 0 };
    const result = await db.collection(CITIES_COLLECTION).insertMany(docs);
    return { inserted: result.insertedCount };
  }

  async bulkSeedNeighborhoods(
    items: Array<{
      titleAr: string;
      titleEn: string;
      regionId: string;
      cityId: string;
      active: boolean;
    }>,
  ) {
    const db = await getMongoDb();
    const now = new Date();
    const docs = items.map((n) => ({
      ...n,
      descriptionAr: "",
      descriptionEn: "",
      createdAt: now,
      updatedAt: now,
    }));
    if (docs.length === 0) return { inserted: 0 };
    const result = await db
      .collection(NEIGHBORHOODS_COLLECTION)
      .insertMany(docs);
    return { inserted: result.insertedCount };
  }
}
