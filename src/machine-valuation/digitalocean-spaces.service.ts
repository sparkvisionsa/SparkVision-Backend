import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveEndpointFromOrigin(originEndpoint: string, bucket: string): string {
  if (!originEndpoint) return "";
  try {
    const url = new URL(originEndpoint);
    const bucketPrefix = `${bucket}.`;
    const host = url.hostname.startsWith(bucketPrefix)
      ? url.hostname.slice(bucketPrefix.length)
      : url.hostname;
    return `${url.protocol}//${host}`;
  } catch {
    return "";
  }
}

function deriveRegionFromEndpoint(endpoint: string): string {
  try {
    const host = new URL(endpoint).hostname;
    const first = host.split(".")[0] ?? "";
    return first || "us-east-1";
  } catch {
    return "us-east-1";
  }
}

function originFromEndpoint(endpoint: string, bucket: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${bucket}.${url.hostname}`;
  } catch {
    return "";
  }
}

function encodeSpacesKey(key: string): string {
  return key
    .split("/")
    .filter((part) => part.length > 0)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function sanitizeSpacesKeySegment(raw: unknown, fallback: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[\u0000-\u001f<>:"\\|?*]+/g, "-")
    .replace(/\//g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .trim();
  return (cleaned || fallback).slice(0, 180);
}

function toNodeReadable(body: unknown): NodeJS.ReadableStream {
  if (body instanceof Readable) return body;
  if (body && typeof (body as { pipe?: unknown }).pipe === "function") {
    return body as NodeJS.ReadableStream;
  }
  if (
    body &&
    typeof (body as { transformToWebStream?: unknown }).transformToWebStream === "function"
  ) {
    const webStream = (body as { transformToWebStream: () => WebReadableStream<Uint8Array> })
      .transformToWebStream();
    return Readable.fromWeb(webStream);
  }
  if (
    body &&
    typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function"
  ) {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new InternalServerErrorException("Invalid object stream from DigitalOcean Spaces.");
}

function totalBytesFromContentRange(contentRange: string | undefined, fallback: number): number {
  if (!contentRange) return fallback;
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) return fallback;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : fallback;
}

@Injectable()
export class DigitalOceanSpacesService {
  private readonly logger = new Logger(DigitalOceanSpacesService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly originEndpoint: string;
  private readonly prefix: string;

  constructor() {
    const accessKeyId = env("DO_SPACES_ACCESS_KEY_ID");
    const secretAccessKey =
      env("DO_SPACES_SECRET_ACCESS_KEY") || env("DO_SPACES_SECRET_KEY");
    this.bucket = env("DO_SPACES_BUCKET") || env("DO_SPACES_BUCKET_NAME");
    this.prefix = sanitizeSpacesKeySegment(
      env("DO_SPACES_INSPECTOR_PREFIX") || "mv-inspector",
      "mv-inspector",
    );

    const originEndpoint = trimTrailingSlash(env("DO_SPACES_ORIGIN_ENDPOINT"));
    const endpoint = trimTrailingSlash(
      env("DO_SPACES_ENDPOINT") || deriveEndpointFromOrigin(originEndpoint, this.bucket),
    );
    const region = env("DO_SPACES_REGION") || deriveRegionFromEndpoint(endpoint);
    this.originEndpoint =
      originEndpoint || (endpoint && this.bucket ? originFromEndpoint(endpoint, this.bucket) : "");

    if (!accessKeyId || !secretAccessKey || !this.bucket || !endpoint) {
      this.client = null;
      this.logger.warn(
        "DigitalOcean Spaces env is incomplete. Inspector file uploads are disabled.",
      );
      return;
    }

    this.client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  isReady(): boolean {
    return this.client != null && this.bucket.length > 0;
  }

  private requireClient(): S3Client {
    if (!this.client || !this.bucket) {
      throw new InternalServerErrorException("DigitalOcean Spaces is not configured.");
    }
    return this.client;
  }

  buildInspectorKey(projectId: string, entryId: string, fileName: string): string {
    const projectSegment = sanitizeSpacesKeySegment(projectId, "project");
    const entrySegment = sanitizeSpacesKeySegment(entryId, "file");
    const fileSegment = sanitizeSpacesKeySegment(fileName, "file");
    return [this.prefix, projectSegment, entrySegment, fileSegment].filter(Boolean).join("/");
  }

  publicUrlForKey(key: string): string {
    if (!this.originEndpoint) return "";
    return `${this.originEndpoint}/${encodeSpacesKey(key)}`;
  }

  async uploadInspectorFile(params: {
    projectId: string;
    entryId: string;
    fileName: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<{ key: string; url: string }> {
    const client = this.requireClient();
    const key = this.buildInspectorKey(params.projectId, params.entryId, params.fileName);
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType || "application/octet-stream",
        ContentLength: params.buffer.length,
      }),
    );
    return { key, url: this.publicUrlForKey(key) };
  }

  async deleteObject(key: string): Promise<void> {
    const normalizedKey = key.trim();
    if (!normalizedKey) return;
    const client = this.requireClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: normalizedKey }));
  }

  async getObjectStream(
    key: string,
    opts?: { rangeHeader?: string },
  ): Promise<{
    stream: NodeJS.ReadableStream;
    contentType: string;
    contentLength: number;
    totalBytes: number;
    httpStatus: 200 | 206;
    contentRange?: string;
  }> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new InternalServerErrorException("Missing DigitalOcean Spaces object key.");
    }
    const client = this.requireClient();
    const range = opts?.rangeHeader?.trim();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
        ...(range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {}),
      }),
    );
    const contentLength = Number(response.ContentLength ?? 0);
    const contentRange = response.ContentRange;
    return {
      stream: toNodeReadable(response.Body),
      contentType: response.ContentType || "application/octet-stream",
      contentLength: Number.isFinite(contentLength) ? contentLength : 0,
      totalBytes: totalBytesFromContentRange(contentRange, contentLength),
      httpStatus: response.$metadata.httpStatusCode === 206 ? 206 : 200,
      contentRange,
    };
  }
}
