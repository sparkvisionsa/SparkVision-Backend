import { ObjectId, type Db } from "mongodb";
import type { UserDoc } from "../server/auth-tracking/types";

export function supportUsers(db: Db) {
  return db.collection<UserDoc & { _id: ObjectId | string }>("users");
}

export function supportUserIds(ids: string[]): (ObjectId | string)[] {
  return ids.flatMap(id => /^[a-f\d]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id]);
}

export function supportIdentifierVariants(value: string) {
  const raw = value.trim();
  const normalized = raw
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\s()-]/g, "");
  const variants = new Set([raw]);
  if (/^\+?\d+$/.test(normalized)) {
    variants.add(normalized);
    const local = normalized.replace(/^(?:\+966|00966|966|0)(?=5\d{8}$)/, "");
    if (/^5\d{8}$/.test(local)) {
      for (const prefix of ["", "0", "966", "+966", "00966"]) variants.add(`${prefix}${local}`);
    }
  }
  return [...variants];
}

export async function findSupportUser(db: Db, identifier: string) {
  const variants = supportIdentifierVariants(identifier);
  // Do not select an arbitrary account if legacy data contains duplicate phones.
  const users = await supportUsers(db).find({ $or: [
    { phone: { $in: variants } }, { username: { $in: variants } },
    { usernameLower: { $in: variants.map(value => value.toLowerCase()) } },
  ] }).limit(2).toArray();
  return users;
}
