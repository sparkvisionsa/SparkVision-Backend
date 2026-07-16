import { config as loadEnv } from "dotenv";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

loadEnv();

const APPLY = process.argv.includes("--apply");
const DELETE_GRIDFS = process.argv.includes("--delete-gridfs");
const mongoUrl = process.env.MONGO_URL_SCRAPPING;
const dbName = process.env.MONGO_DBNAME_SCRAPPING;
const bucketName = process.env.DO_SPACES_BUCKET || process.env.DO_SPACES_BUCKET_NAME;
const accessKeyId = process.env.DO_SPACES_ACCESS_KEY_ID;
const secretAccessKey = process.env.DO_SPACES_SECRET_ACCESS_KEY || process.env.DO_SPACES_SECRET_KEY;
const originEndpoint = String(process.env.DO_SPACES_ORIGIN_ENDPOINT || "").replace(/\/+$/, "");
const configuredEndpoint = String(process.env.DO_SPACES_ENDPOINT || "").replace(/\/+$/, "");
const prefix = cleanSegment(process.env.DO_SPACES_ASSET_IMAGES_PREFIX || "mv-asset-images", "mv-asset-images");

function cleanSegment(value, fallback) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

function endpointForClient() {
  if (configuredEndpoint) return configuredEndpoint;
  if (!originEndpoint || !bucketName) return "";
  const url = new URL(originEndpoint);
  const prefixToRemove = `${bucketName}.`;
  const host = url.hostname.startsWith(prefixToRemove)
    ? url.hostname.slice(prefixToRemove.length)
    : url.hostname;
  return `${url.protocol}//${host}`;
}

function regionForEndpoint(endpoint) {
  try {
    return new URL(endpoint).hostname.split(".")[0] || "us-east-1";
  } catch {
    return "us-east-1";
  }
}

function publicOrigin(endpoint) {
  if (originEndpoint) return originEndpoint;
  const url = new URL(endpoint);
  return `${url.protocol}//${bucketName}.${url.hostname}`;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function assetImageKey(projectId, assetId, fileId, fileName) {
  return [
    prefix,
    cleanSegment(projectId, "project"),
    cleanSegment(assetId, "asset"),
    cleanSegment(fileId, "image"),
    cleanSegment(fileName, "image"),
  ].join("/");
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function imageEntry(file, key, url) {
  return {
    _id: file._id,
    url,
    publicId: key,
    createdAt: file.uploadDate instanceof Date ? file.uploadDate : new Date(),
    mediaType: "image",
    mimeType: file.metadata?.mimeType || "application/octet-stream",
    includeInReport: file.metadata?.includeInReport !== false,
  };
}

function replaceOrAppendImage(images, fileId, nextImage) {
  const id = fileId.toString();
  let replaced = false;
  const next = (Array.isArray(images) ? images : []).map((image) => {
    const legacyId =
      image instanceof ObjectId ? image.toString()
      : typeof image === "string" && ObjectId.isValid(image) ? image
      : image && typeof image === "object" && image._id instanceof ObjectId ? image._id.toString()
      : image && typeof image === "object" && typeof image._id === "string" ? image._id
      : "";
    if (legacyId !== id) return image;
    replaced = true;
    return nextImage;
  });
  if (!replaced) next.push(nextImage);
  return next;
}

async function main() {
  const endpoint = endpointForClient();
  const missing = [
    !mongoUrl && "MONGO_URL_SCRAPPING",
    !dbName && "MONGO_DBNAME_SCRAPPING",
    !bucketName && "DO_SPACES_BUCKET",
    !accessKeyId && "DO_SPACES_ACCESS_KEY_ID",
    !secretAccessKey && "DO_SPACES_SECRET_ACCESS_KEY",
    !endpoint && "DO_SPACES_ENDPOINT",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const mongo = new MongoClient(mongoUrl);
  const spaces = new S3Client({
    region: process.env.DO_SPACES_REGION || regionForEndpoint(endpoint),
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  await mongo.connect();
  try {
    const db = mongo.db(dbName);
    const assets = db.collection("assets");
    const files = db.collection("mv_files.files");
    const grid = new GridFSBucket(db, { bucketName: "mv_files" });
    const sourceFiles = await files.find({
      "metadata.scope": "asset-images",
      "metadata.storage": { $ne: "digitalocean" },
    }).toArray();

    let migrated = 0;
    let skipped = 0;
    let unmatched = 0;
    for (const file of sourceFiles) {
      const rawAssetId = file.metadata?.picAssetId;
      const assetId =
        rawAssetId instanceof ObjectId
          ? rawAssetId
          : typeof rawAssetId === "string" && ObjectId.isValid(rawAssetId)
            ? new ObjectId(rawAssetId)
            : null;
      if (!assetId) {
        unmatched += 1;
        console.warn(`Skipping ${file._id}: missing metadata.picAssetId`);
        continue;
      }
      const asset = await assets.findOne({ _id: assetId, isAssetFolder: true });
      if (!asset) {
        unmatched += 1;
        console.warn(`Skipping ${file._id}: linked asset ${assetId} was not found`);
        continue;
      }

      const projectId = asset.projectId?.toString();
      if (!projectId) {
        unmatched += 1;
        console.warn(`Skipping ${file._id}: linked asset has no projectId`);
        continue;
      }
      const fileName = cleanSegment(file.filename || file.metadata?.originalFileName || "image", "image");
      const key = assetImageKey(projectId, asset._id.toString(), file._id.toString(), fileName);
      const url = `${publicOrigin(endpoint)}/${encodeKey(key)}`;
      const existing = (Array.isArray(asset.images) ? asset.images : []).some(
        (image) => image && typeof image === "object" && image.publicId === key && image.url === url,
      );
      if (existing) {
        skipped += 1;
        continue;
      }

      if (!APPLY) {
        console.log(`[dry-run] ${file._id} -> assets/${asset._id}.images (${key})`);
        migrated += 1;
        continue;
      }

      const data = await streamToBuffer(grid.openDownloadStream(file._id));
      await spaces.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: data,
        ContentType: file.metadata?.mimeType || "application/octet-stream",
        ContentLength: data.length,
        ACL: "public-read",
      }));

      const nextImages = replaceOrAppendImage(asset.images, file._id, imageEntry(file, key, url));
      await assets.updateOne(
        { _id: asset._id },
        { $set: { images: nextImages, updatedAt: new Date() } },
      );
      if (DELETE_GRIDFS) await grid.delete(file._id);
      migrated += 1;
      console.log(`Migrated ${file._id} -> ${asset._id}`);
    }

    console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", migrated, skipped, unmatched }, null, 2));
    if (!APPLY) console.log("Run again with --apply after reviewing this output.");
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
