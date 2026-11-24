import { ObjectId } from "mongodb";
import type { AssignmentNumberConfig } from "@/lib/assignment-number";

export const COMPANY_DEFAULTS_COLLECTION = "company_default_values";
export const DEFAULT_PRODUCT_ID = "real-estate-valuation";

/** Counter state for one incremental default. `next` is the value the NEXT transaction will get. */
export type CounterState = {
  periodKey: string; // "all" | "2026" | "2026-11" | "2026-11-10"
  next: number;
};

/**
 * One document per (companyId, productId).
 * To add a new default later, add a new optional field here (e.g. `valuationPurpose?: string`)
 * and, if it needs a counter, a key under `counters`.
 */
export type CompanyDefaultsDoc = {
  _id: ObjectId;
  companyId: string;
  productId: string;

  assignmentNumber?: AssignmentNumberConfig;
  values?: Record<string, unknown>;

  counters?: {
    assignmentNumber?: CounterState;
  };

  createdAt: Date;
  updatedAt: Date;
};
