import type { Collection, Db } from "mongodb";

export const SYARAH_COLLECTION = "syarah";

export interface SyarahDoc {
  [key: string]: unknown;
  _id: unknown;
  id?: number | string;
  post_id?: number | string;
  fetchedAt?: Date | string | number | null;
  title?: string;
  brand?: string;
  model?: string;
  trim?: string;
  year?: number | string;
  mileage_km?: number | string;
  city?: string;
  origin?: string;
  fuel_type?: string;
  transmission?: string;
  engine_size?: string | number;
  cylinders?: number | string;
  horse_power?: number | string;
  drivetrain?: string;
  engine_type?: string;
  fuel_tank_liters?: number | string;
  fuel_economy_kml?: number | string;
  seats?: number | string;
  price_cash?: number | string;
  price_monthly?: number | string;
  chassis_number?: string;
  plate_number?: string;
  body_is_clear?: boolean;
  images?: string[];
  featured_image?: string;
  share_link?: string;
  tags?: string[];
}

export function getSyarahCollection(db: Db): Collection<SyarahDoc> {
  return db.collection<SyarahDoc>(SYARAH_COLLECTION);
}
