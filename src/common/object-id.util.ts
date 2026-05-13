import { ObjectId } from "mongodb";

/** يحوّل معرفاً نصياً (24 hex) إلى ObjectId أو يرجع null إن كان غير صالح. */
export function tryParseObjectId(value: string | undefined | null): ObjectId | null {
  if (value === undefined || value === null) return null;
  const t = String(value).trim();
  if (!t || !ObjectId.isValid(t)) return null;
  return new ObjectId(t);
}

export function parseObjectId(value: string): ObjectId {
  const id = tryParseObjectId(value);
  if (!id) {
    throw new Error(`Invalid ObjectId: ${value}`);
  }
  return id;
}

/** لاستعادة userId من JSON/Redis حيث قد يكون نصاً. */
export function hydrateOptionalObjectId(value: unknown): ObjectId | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === "string" && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
}

/** قيمة من BSON/JSON قد تكون ObjectId أو نص hex طول 24 (مثل `users._id`). UUID لا يُحوَّل. */
export function tryCoerceToObjectId(value: unknown): ObjectId | null {
  if (value === undefined || value === null || value === "") return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === "string") return tryParseObjectId(value);
  return null;
}
