import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";

export function assetUploadImageId(projectId: string, assetId: string, userId: string, key: string) {
  return new ObjectId(createHash("sha256").update(JSON.stringify([projectId, assetId, userId, key])).digest("hex").slice(0, 24));
}

/** Supports both legacy arrays and the inspector application's categorized media. */
export function mongoAssetMediaArray(field = "$images"): Record<string, unknown> {
  return { $cond: [
    { $isArray: field }, field,
    { $cond: [
      { $eq: [{ $type: field }, "object"] },
      { $reduce: { input: { $objectToArray: field }, initialValue: [], in: {
        $concatArrays: ["$$value", { $cond: [
          { $isArray: "$$this.v" }, "$$this.v",
          { $cond: [{ $eq: [{ $type: "$$this.v" }, "object"] }, ["$$this.v"], []] },
        ] }],
      } } }, []
    ] },
  ] };
}

export function mongoAssetHasImage(id: ObjectId) {
  return { $in: [id, { $map: { input: mongoAssetMediaArray(), as: "image", in: "$$image._id" } }] };
}

export function mongoAssetPhotos() {
  const text = (field: string) => ({ $convert: { input: field, to: "string", onError: "", onNull: "" } });
  return { $filter: { input: mongoAssetMediaArray(), as: "image", cond: { $not: [{ $or: [
    { $eq: [{ $toLower: text("$$image.mediaType") }, "video"] },
    { $regexMatch: { input: text("$$image.mimeType"), regex: "^video/", options: "i" } },
    { $regexMatch: { input: text("$$image.url"), regex: "\\.(mp4|webm|mov|m4v|ogv|mkv)(\\?|#|$)", options: "i" } },
  ] }] } } };
}
