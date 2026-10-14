import assert from "node:assert/strict";
import test from "node:test";
import { decodeUploadFilename } from "../src/machine-valuation/sheet-rows.util";

test("recovers Arabic UTF-8 filenames decoded by multipart as latin1", () => {
  const expected = "محضر معاينة معدات العميل.pdf";
  const multerName = Buffer.from(expected, "utf8").toString("latin1");
  assert.equal(decodeUploadFilename(multerName), expected);
});

test("keeps filenames that already contain correct Arabic Unicode", () => {
  const expected = "صور الآلات والمعدات ١٢.xlsx";
  assert.equal(decodeUploadFilename(expected), expected);
});

test("keeps ASCII and genuine latin1 filenames intact", () => {
  assert.equal(decodeUploadFilename("client-files.pdf"), "client-files.pdf");
  assert.equal(decodeUploadFilename("résumé.pdf"), "résumé.pdf");
});

test("normalizes decomposed Unicode without corrupting it", () => {
  assert.equal(decodeUploadFilename("cafe\u0301.pdf"), "café.pdf");
});
