require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const {
  S3Client,
  GetBucketAclCommand,
  PutBucketAclCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
} = require("@aws-sdk/client-s3");

const bucket = process.env.DO_SPACES_BUCKET?.trim();
const endpoint = process.env.DO_SPACES_ENDPOINT?.trim();
const region = process.env.DO_SPACES_REGION?.trim();
const accessKeyId = process.env.DO_SPACES_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.DO_SPACES_SECRET_ACCESS_KEY?.trim();
const prefix = (process.env.DO_SPACES_RECORDINGS_PREFIX || "helper-recordings").replace(/^\/+|\/+$/g, "");
const origins = [...new Set((process.env.CORS_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean))];
const apply = process.argv.includes("--apply");

if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey || !origins.length) {
  throw new Error("Spaces credentials, endpoint, bucket, region and CORS_ORIGINS must be configured in .env.");
}
for (const origin of origins) {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== "https:" && url.hostname !== "localhost")) {
    throw new Error(`Invalid CORS origin: ${origin}`);
  }
}

const client = new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey } });
const isMissing = (error) => ["NoSuchCORSConfiguration", "NoSuchLifecycleConfiguration", "NoSuchBucketPolicy"].includes(error?.name);
const getOptional = async (command) => {
  try { return await client.send(command); }
  catch (error) { if (isMissing(error)) return null; throw error; }
};

async function main() {
  const [acl, cors, lifecycle, policy] = await Promise.all([
    client.send(new GetBucketAclCommand({ Bucket: bucket })),
    getOptional(new GetBucketCorsCommand({ Bucket: bucket })),
    getOptional(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
    getOptional(new GetBucketPolicyCommand({ Bucket: bucket })),
  ]);
  const publicBucketListing = (acl.Grants || []).some((grant) =>
    grant.Grantee?.URI?.endsWith("/AllUsers") && ["READ", "FULL_CONTROL"].includes(grant.Permission));
  const statements = policy?.Policy ? JSON.parse(policy.Policy).Statement || [] : [];
  const publicReadPolicy = statements.some((statement) => {
    const actions = [statement.Action].flat().filter(Boolean);
    const resources = [statement.Resource].flat().filter(Boolean);
    return statement.Effect === "Allow" && (statement.Principal === "*" || statement.Principal?.AWS === "*")
      && actions.some((action) => ["s3:*", "s3:GetObject"].includes(action))
      && resources.some((resource) => resource === `arn:aws:s3:::${bucket}/*` || resource.startsWith(`arn:aws:s3:::${bucket}/${prefix}/`));
  });
  if (publicReadPolicy) throw new Error("A public bucket policy covers recording objects; review that policy before changing bucket settings.");

  const corsRule = {
    ID: "screen-recording-direct-upload",
    AllowedOrigins: origins,
    AllowedMethods: ["GET", "HEAD", "PUT"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    MaxAgeSeconds: 3600,
  };
  const corsRules = [corsRule, ...(cors?.CORSRules || []).filter((rule) => rule.ID !== corsRule.ID)];
  const lifecycleRule = {
    ID: "abort-incomplete-screen-recordings",
    Filter: { Prefix: `${prefix}/` },
    Status: "Enabled",
    AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
  };
  const lifecycleRules = [...(lifecycle?.Rules || []).filter((rule) => rule.ID !== lifecycleRule.ID), lifecycleRule];
  console.log(JSON.stringify({ bucket, origins, publicBucketListing, existingCorsRules: cors?.CORSRules?.length || 0,
    existingLifecycleRules: lifecycle?.Rules?.length || 0, apply }));
  if (!apply) return;
  if (publicBucketListing) await client.send(new PutBucketAclCommand({ Bucket: bucket, ACL: "private" }));
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: corsRules } }));
  await client.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucket, LifecycleConfiguration: { Rules: lifecycleRules } }));
  const [verifiedAcl, verifiedCors, verifiedLifecycle] = await Promise.all([
    client.send(new GetBucketAclCommand({ Bucket: bucket })),
    client.send(new GetBucketCorsCommand({ Bucket: bucket })),
    client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })),
  ]);
  const stillPublic = (verifiedAcl.Grants || []).some((grant) =>
    grant.Grantee?.URI?.endsWith("/AllUsers") && ["READ", "FULL_CONTROL"].includes(grant.Permission));
  if (stillPublic || !verifiedCors.CORSRules?.some((rule) => rule.ID === corsRule.ID)
    || !verifiedLifecycle.Rules?.some((rule) => rule.ID === lifecycleRule.ID)) {
    throw new Error("Spaces configuration verification failed.");
  }
  console.log("Spaces bucket listing is private; recording CORS and incomplete upload lifecycle are configured.");
}

main().catch((error) => { console.error(`${error.name || "Error"}: ${error.message}`); process.exitCode = 1; });
