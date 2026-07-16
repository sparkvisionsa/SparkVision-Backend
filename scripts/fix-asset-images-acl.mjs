import { config as loadEnv } from "dotenv";
import { ListObjectsV2Command, PutObjectAclCommand, S3Client } from "@aws-sdk/client-s3";

loadEnv();

const APPLY = process.argv.includes("--apply");
const bucketName = process.env.DO_SPACES_BUCKET || process.env.DO_SPACES_BUCKET_NAME;
const accessKeyId = process.env.DO_SPACES_ACCESS_KEY_ID;
const secretAccessKey = process.env.DO_SPACES_SECRET_ACCESS_KEY || process.env.DO_SPACES_SECRET_KEY;
const configuredEndpoint = String(process.env.DO_SPACES_ENDPOINT || "").replace(/\/?$/, "");
const originEndpoint = String(process.env.DO_SPACES_ORIGIN_ENDPOINT || "").replace(/\/?$/, "");
const prefix = String(process.env.DO_SPACES_ASSET_IMAGES_PREFIX || "mv-asset-images").trim();

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

async function main() {
  const endpoint = endpointForClient();
  const missing = [
    !bucketName && "DO_SPACES_BUCKET",
    !accessKeyId && "DO_SPACES_ACCESS_KEY_ID",
    !secretAccessKey && "DO_SPACES_SECRET_ACCESS_KEY",
    !endpoint && "DO_SPACES_ENDPOINT",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);

  const spaces = new S3Client({
    region: process.env.DO_SPACES_REGION || regionForEndpoint(endpoint),
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  let continuationToken;
  let scanned = 0;
  let fixed = 0;
  let failed = 0;
  do {
    const page = await spaces.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: `${prefix}/`,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    const keys = (page.Contents || []).map((o) => o.Key).filter(Boolean);
    scanned += keys.length;
    for (const key of keys) {
      if (!APPLY) continue;
      try {
        await spaces.send(new PutObjectAclCommand({ Bucket: bucketName, Key: key, ACL: "public-read" }));
        fixed += 1;
      } catch (error) {
        failed += 1;
        console.warn(`Failed to fix ACL for ${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    console.log(`Scanned ${scanned} objects so far (fixed ${fixed}, failed ${failed})...`);
  } while (continuationToken);

  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", scanned, fixed, failed }, null, 2));
  if (!APPLY) console.log("Run again with --apply to actually set ACL public-read.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
