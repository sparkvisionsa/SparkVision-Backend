import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
} from "@/server/auth-tracking/crypto";
import { consumeRateLimit } from "@/server/auth-tracking/rate-limit";

test("signed tokens verify and detect tampering", () => {
  const token = signToken({ id: "identity-1", iat: Date.now() });
  const payload = verifyToken<{ id: string; iat: number }>(token);
  assert.ok(payload);
  assert.equal(payload?.id, "identity-1");

  const [body, signature] = token.split(".");
  const tampered = `${body}.${signature}tampered`;
  const tamperedPayload = verifyToken<{ id: string; iat: number }>(tampered);
  assert.equal(tamperedPayload, null);
});

test("password hashing uses secure comparison", async () => {
  const password = "StrongPass123!";
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("rate limiter blocks requests over the configured limit", () => {
  const key = `test-${Date.now()}`;
  const limit = 3;
  const windowMs = 1_000;
  const first = consumeRateLimit(key, { limit, windowMs });
  const second = consumeRateLimit(key, { limit, windowMs });
  const third = consumeRateLimit(key, { limit, windowMs });
  const blocked = consumeRateLimit(key, { limit, windowMs });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, true);
  assert.equal(blocked.allowed, false);
});

