import type { ObjectId } from "mongodb";

// ─── Collection names ────────────────────────────────────────────────────────

export const REGIONS_COLLECTION = "regions";
export const CITIES_COLLECTION = "cities";
export const NEIGHBORHOODS_COLLECTION = "neighborhoods";

// ─── MongoDB document types ──────────────────────────────────────────────────

export interface RegionDoc {
  _id: ObjectId;
  titleAr: string;
  titleEn: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CityDoc {
  _id: ObjectId;
  titleAr: string;
  titleEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  regionId: string; // stored as string ref to RegionDoc._id
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NeighborhoodDoc {
  _id: ObjectId;
  titleAr: string;
  titleEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  regionId: string;
  cityId: string; // stored as string ref to CityDoc._id
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
