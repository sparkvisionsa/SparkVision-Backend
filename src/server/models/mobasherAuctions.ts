import type { Collection, Db } from "mongodb";

export const MOBASHER_AUCTIONS_COLLECTION = "mobasherAuctions";

export type MobasherAuctionDoc = {
  [key: string]: unknown;
  _id: string;
  itemId?: string;
  auctionCode?: string;
  title?: string;
  auctionTitle?: string;
  auctionName?: string;
  address?: string;
  url?: string;
  auctionUrl?: string;
  description?: string | Record<string, string>;
  productNotes?: Record<string, string>;
  fees?: {
    items?: Array<{ fee?: string; value?: string }>;
    totalNumber?: string;
    totalWords?: string;
  };
  scrapedAt?: Date | string;
  images?: string[];
  breadcrumbs?: string[];
  bidHistory?: Array<Record<string, unknown>>;
  highestOnlineBid?: {
    raw?: string;
    number?: number | null;
  };
  productData?: Record<string, string>;
  auctionDetails?: Record<string, string>;
};

export function getMobasherAuctionsCollection(db: Db): Collection<MobasherAuctionDoc> {
  return db.collection<MobasherAuctionDoc>(MOBASHER_AUCTIONS_COLLECTION);
}
