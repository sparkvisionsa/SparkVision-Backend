import type { ObjectId } from "mongodb";

export interface MvProjectDoc {
  _id: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  userId?: string;
}

export interface MvSubProjectDoc {
  _id: ObjectId;
  projectId: ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MvSheetDoc {
  _id: ObjectId;
  projectId: ObjectId;
  subProjectId?: ObjectId;
  name: string;
  headers: string[];
  /** Compact row storage (preferred; avoids duplicate header keys per cell in BSON) */
  rowValues?: (string | number | null)[][];
  /** Legacy documents only */
  rows?: Record<string, string | number | null>[];
  sourceType: "file-import" | "manual";
  sourceFileName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MvHeaderOptionDoc {
  _id: ObjectId;
  name: string;
  userId?: string;
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, string | number | null>[];
}

export interface ParsedFileResult {
  sheets: ParsedSheet[];
  sourceFileName: string;
}
