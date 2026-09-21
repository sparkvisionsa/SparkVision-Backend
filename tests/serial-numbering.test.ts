import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REFERENCE_NUMBER_PATTERN,
  formatReferenceNumber,
  resolveReferencePrefix,
  sanitizeReferenceNumberPattern,
} from "@/organization/serial-numbering";

const at = new Date(2026, 8, 19);

test("numeric serial pads from the left and starts at 1", () => {
  const pattern = { ...DEFAULT_REFERENCE_NUMBER_PATTERN, length: 6 };
  assert.equal(formatReferenceNumber(pattern, 1, at), "000001");
  assert.equal(formatReferenceNumber(pattern, 12, at), "000012");
});

test("letter prefix NX with 6 digits matches NX000001", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKind: "letters",
    prefixLetters: "nx",
  });
  assert.equal(formatReferenceNumber(pattern, 1, at), "NX000001");
});

test("year prefix uses the last two digits of the year", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKind: "year",
  });
  assert.equal(resolveReferencePrefix(pattern, at), "26");
  assert.equal(formatReferenceNumber(pattern, 1, at), "26000001");
});

test("month and day prefixes are zero-padded", () => {
  const month = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKind: "month",
  });
  const day = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKind: "day",
  });
  assert.equal(formatReferenceNumber(month, 1, at), "09000001");
  assert.equal(formatReferenceNumber(day, 1, at), "19000001");
});

test("letter serials stay unique when padded to a fixed width", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "letters",
    length: 6,
    hasPrefix: false,
  });
  assert.equal(formatReferenceNumber(pattern, 1, at), "AAAAAA");
  assert.equal(formatReferenceNumber(pattern, 2, at), "AAAAAB");
  assert.equal(formatReferenceNumber(pattern, 27, at), "AAAABA");
});

test("combined letter and year prefixes join without separators", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKinds: ["letters", "year"],
    prefixLetters: "NX",
  });
  assert.equal(formatReferenceNumber(pattern, 1, at), "NX26000001");
});

test("hyphen separator sits between prefix parts and the serial body", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "numbers",
    length: 6,
    hasPrefix: true,
    prefixKinds: ["letters", "year"],
    prefixLetters: "NX",
    separatePrefix: true,
  });
  assert.equal(formatReferenceNumber(pattern, 1, at), "NX-26-000001");
});

test("mixed serials use base36 padding", () => {
  const pattern = sanitizeReferenceNumberPattern({
    valueType: "mixed",
    length: 6,
    hasPrefix: false,
  });
  assert.equal(formatReferenceNumber(pattern, 1, at), "000001");
  assert.equal(formatReferenceNumber(pattern, 10, at), "00000A");
});
