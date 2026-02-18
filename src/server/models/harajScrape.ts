import type { Collection, Db } from "mongodb";

export const HARAJ_SCRAPE_COLLECTION = "harajScrape";
export const CARS_HARAJ_COLLECTION = "CarsHaraj";

export interface HarajScrapeDoc {
  [key: string]: unknown;
  _id: string;
  city?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  postDate?: number;
  postId?: string;
  title?: string;
  url?: string;
  phone?: string;
  priceNumeric?: number;
  hasPrice?: boolean | string;
  hasImage?: boolean;
  hasVideo?: boolean;
  imagesList?: string[];
  tags?: string[];
  commentsCount?: number;
  comments?: Array<Record<string, unknown>>;
  item?: {
    id?: number;
    title?: string;
    postDate?: number;
    updateDate?: number;
    authorUsername?: string;
    authorId?: number;
    URL?: string;
    bodyTEXT?: string;
    city?: string;
    geoCity?: string;
    geoNeighborhood?: string;
    tags?: string[];
    imagesList?: string[];
    hasImage?: boolean;
    hasVideo?: boolean;
    commentEnabled?: boolean;
    commentStatus?: number;
    commentCount?: number;
    status?: boolean;
    postType?: string;
    price?: {
      formattedPrice?: string;
      numeric?: number;
    };
    carInfo?: Record<string, unknown> | null;
    realEstateInfo?: Record<string, unknown> | null;
  };
  gql?: Record<string, unknown>;
}

export function getHarajScrapeCollection(db: Db): Collection<HarajScrapeDoc> {
  return db.collection<HarajScrapeDoc>(HARAJ_SCRAPE_COLLECTION);
}

export function getCarsHarajCollection(db: Db): Collection<HarajScrapeDoc> {
  return db.collection<HarajScrapeDoc>(CARS_HARAJ_COLLECTION);
}
