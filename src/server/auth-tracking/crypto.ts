import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { authTrackingConfig } from "./config";

function toBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function randomId() {
  return crypto.randomUUID();
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signatureFor(value: string) {
  return crypto
    .createHmac("sha256", authTrackingConfig.authSecret)
    .update(value)
    .digest("base64url");
}

export function signToken(payload: Record<string, unknown>) {
  const body = toBase64Url(JSON.stringify(payload));
  const sig = signatureFor(body);
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token?: string | null) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = signatureFor(body);
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }
  try {
    return JSON.parse(fromBase64Url(body)) as T;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function parseDateFromUnknown(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}
