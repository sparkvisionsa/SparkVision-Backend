import test from "node:test";
import assert from "node:assert/strict";
import { helperPdfScope } from "@/helper-tools/helper-pdfs.service";
import type { HelperActor } from "@/helper-tools/helper-tools.types";

function actor(overrides: Partial<HelperActor>): HelperActor {
  return {
    kind: "user",
    userId: "user-a",
    companyId: "company-a",
    sessionId: "session-a",
    displayName: "User",
    identityId: "identity-a",
    ...overrides,
  };
}

test("saved PDF numbering and visibility share one scope for all users in a company", () => {
  assert.equal(helperPdfScope(actor({ userId: "user-a" })), "company:company-a");
  assert.equal(helperPdfScope(actor({ userId: "user-b", sessionId: "session-b" })), "company:company-a");
});

test("users without a company and guests retain isolated PDF scopes", () => {
  assert.equal(helperPdfScope(actor({ companyId: null, userId: "user-a" })), "user:user-a");
  assert.equal(helperPdfScope(actor({ companyId: null, userId: "user-b" })), "user:user-b");
  assert.equal(helperPdfScope(actor({ kind: "guest", companyId: null, userId: null })), "guest:session-a");
});
