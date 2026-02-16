import type { Request } from "express";

export function parseNumber(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

export function parseBoolean(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function parseSources(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const sources = value
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean);
  return sources.length > 0 ? sources : undefined;
}

export function readQueryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof value === "string" ? value : undefined;
}
