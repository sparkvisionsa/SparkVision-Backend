import type { Collection, Db } from "mongodb";

export const YALLA_MOTOR_LEGACY_COLLECTION = "yallamotortest";
export const YALLA_MOTOR_USED_COLLECTION = "YallaUsed";
export const YALLA_MOTOR_NEW_CARS_COLLECTION = "yallaMotorNewCars";

export interface YallaMotorDoc {
  [key: string]: unknown;
  _id: unknown;
  adId?: string;
  breadcrumbs?: string[];
  description?: string;
  features?: string[] | null;
  highlights?: Record<string, string> | null;
  images?: string[];
  location?: string;
  monthly?: string;
  phone?: string;
  price?: string;
  priceComparison?: {
    ok?: boolean;
    marketMinText?: string | number | null;
    marketMaxText?: string | number | null;
    markerPriceText?: string | number | null;
    marketMin?: number | null;
    marketMax?: number | null;
    markerPrice?: number | null;
    reason?: string;
    [key: string]: unknown;
  } | null;
  scrapedAt?: Date | string;
  title?: string;
  cardPriceText?: string;
  cardTitle?: string;
  fetchedAt?: Date;
  lastSeenAt?: Date;
  listPageUrl?: string;
  pageNo?: number;
  sectionLabel?: string;
  source?: string;
  type?: string;
  url?: string;
  detail?: {
    url?: string;
    breadcrumb?: string[];
    overview?: {
      h1?: string;
      h4?: string;
    };
    priceBox?: Record<string, unknown> | null;
    images?: string[];
    importantSpecs?: Record<string, string> | null;
    features?: string[] | null;
    description?: string;
    priceCompare?: {
      min?: string | number | null;
      max?: string | number | null;
      current?: string | number | null;
      [key: string]: unknown;
    } | null;
  };
  detailScrapedAt?: Date;
}

export function getYallaMotorCollection(db: Db): Collection<YallaMotorDoc> {
  return db.collection<YallaMotorDoc>(YALLA_MOTOR_LEGACY_COLLECTION);
}

export function getYallaUsedCollection(db: Db): Collection<YallaMotorDoc> {
  return db.collection<YallaMotorDoc>(YALLA_MOTOR_USED_COLLECTION);
}

export function getYallaNewCarsCollection(db: Db): Collection<YallaMotorDoc> {
  return db.collection<YallaMotorDoc>(YALLA_MOTOR_NEW_CARS_COLLECTION);
}
