import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  convertOfficeFileToPdfViaMicrosoftGraph,
  microsoftGraphPdfConfigurationMissing,
  resetMicrosoftGraphPdfCaches,
} from "../src/machine-valuation/microsoft-graph-pdf";

const GRAPH_ENVIRONMENT_KEYS = [
  "MS_GRAPH_TENANT_ID",
  "MS_GRAPH_CLIENT_ID",
  "MS_GRAPH_CLIENT_SECRET",
  "MS_GRAPH_SHAREPOINT_SITE_URL",
  "MS_GRAPH_CONVERSION_FOLDER",
  "MS_GRAPH_DRIVE_ID",
  "MS_GRAPH_PERMANENT_DELETE",
  "MS_GRAPH_UPLOAD_SESSION_THRESHOLD_MB",
] as const;

function configureGraphEnvironment() {
  process.env.MS_GRAPH_TENANT_ID = "test-tenant";
  process.env.MS_GRAPH_CLIENT_ID = "test-client";
  process.env.MS_GRAPH_CLIENT_SECRET = "test-secret";
  process.env.MS_GRAPH_SHAREPOINT_SITE_URL =
    "https://example.sharepoint.com/sites/OfficeConverter";
  process.env.MS_GRAPH_CONVERSION_FOLDER = "TempConversions";
  process.env.MS_GRAPH_PERMANENT_DELETE = "true";
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Graph converts DOCX and PPTX, caches metadata, and never sends its token to the download URL", async (t) => {
  const previousEnvironment = new Map(
    GRAPH_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
  );
  const originalFetch = globalThis.fetch;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-pdf-test-"));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMicrosoftGraphPdfCaches();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  configureGraphEnvironment();
  resetMicrosoftGraphPdfCaches();
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  let uploadNumber = 0;
  let conversionNumber = 0;
  let uploadWasThrottled = false;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ url, method, authorization: headers.get("authorization") });

    if (url.includes("login.microsoftonline.com")) {
      return responseJson({ access_token: "cached-access-token", expires_in: 3600 });
    }
    if (url.includes("/sites/example.sharepoint.com:/sites/OfficeConverter")) {
      return responseJson({ id: "site-id" });
    }
    if (url.includes("/sites/site-id/drive")) return responseJson({ id: "drive-id" });
    if (url.includes("/drives/drive-id/root:/TempConversions")) {
      return responseJson({ id: "folder-id", folder: { childCount: 0 } });
    }
    if (method === "PUT" && url.includes("/items/folder-id:/")) {
      if (!uploadWasThrottled) {
        uploadWasThrottled = true;
        return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
      }
      uploadNumber += 1;
      return responseJson({ id: `uploaded-${uploadNumber}` }, 201);
    }
    if (method === "GET" && url.includes("/content?format=pdf")) {
      conversionNumber += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `https://download.example.test/report-${conversionNumber}.pdf` },
      });
    }
    if (url.startsWith("https://download.example.test/")) {
      assert.equal(headers.has("authorization"), false);
      return new Response(Buffer.from(`%PDF-1.7\n${"valid-pdf-data".repeat(12)}`), {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    if (method === "POST" && url.endsWith("/permanentDelete")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const docxPath = path.join(workDir, "report.docx");
  const pptxPath = path.join(workDir, "slides.pptx");
  await fs.writeFile(docxPath, "mock docx");
  await fs.writeFile(pptxPath, "mock pptx");

  const docxPdf = await convertOfficeFileToPdfViaMicrosoftGraph(docxPath, workDir, {
    kind: "docx",
  });
  const pptxPdf = await convertOfficeFileToPdfViaMicrosoftGraph(pptxPath, workDir, {
    kind: "pptx",
  });

  assert.equal(path.basename(docxPdf), "report.pdf");
  assert.equal(path.basename(pptxPdf), "slides.pdf");
  assert.match(await fs.readFile(docxPdf, "utf8"), /^%PDF-/);
  assert.match(await fs.readFile(pptxPdf, "utf8"), /^%PDF-/);
  assert.equal(calls.filter((call) => call.url.includes("login.microsoftonline.com")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/sites/example.sharepoint.com:")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/sites/site-id/drive")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/root:/TempConversions")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/permanentDelete")).length, 2);
  assert.ok(
    calls
      .filter((call) => call.url.startsWith("https://graph.microsoft.com/"))
      .every((call) => call.authorization === "Bearer cached-access-token"),
  );
});

test("Graph deletes the temporary source even when the converted response is not a PDF", async (t) => {
  const previousEnvironment = new Map(
    GRAPH_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
  );
  const originalFetch = globalThis.fetch;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-pdf-invalid-test-"));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMicrosoftGraphPdfCaches();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  configureGraphEnvironment();
  resetMicrosoftGraphPdfCaches();
  let deleted = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("login.microsoftonline.com")) {
      return responseJson({ access_token: "access-token", expires_in: 3600 });
    }
    if (url.includes("/sites/example.sharepoint.com:/sites/OfficeConverter")) {
      return responseJson({ id: "site-id" });
    }
    if (url.includes("/sites/site-id/drive")) return responseJson({ id: "drive-id" });
    if (url.includes("/root:/TempConversions")) {
      return responseJson({ id: "folder-id", folder: {} });
    }
    if (method === "PUT") return responseJson({ id: "uploaded-id" }, 201);
    if (method === "GET" && url.includes("format=pdf")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://download.example.test/not-a-pdf" },
      });
    }
    if (url === "https://download.example.test/not-a-pdf") {
      return new Response("not a PDF", { status: 200 });
    }
    if (method === "POST" && url.endsWith("/permanentDelete")) {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const sourcePath = path.join(workDir, "report.docx");
  await fs.writeFile(sourcePath, "mock docx");
  await assert.rejects(
    convertOfficeFileToPdfViaMicrosoftGraph(sourcePath, workDir, { kind: "docx" }),
    /invalid or empty PDF|not a PDF file/,
  );
  assert.equal(deleted, true);
  await assert.rejects(fs.stat(path.join(workDir, "report.pdf")), { code: "ENOENT" });
});

test("Graph uses a resumable upload without a bearer token for larger Office files", async (t) => {
  const previousEnvironment = new Map(
    GRAPH_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
  );
  const originalFetch = globalThis.fetch;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-pdf-large-test-"));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMicrosoftGraphPdfCaches();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  configureGraphEnvironment();
  process.env.MS_GRAPH_UPLOAD_SESSION_THRESHOLD_MB = "1";
  resetMicrosoftGraphPdfCaches();
  let uploadSessionCreated = false;
  let chunkUploaded = false;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (url.includes("login.microsoftonline.com")) {
      return responseJson({ access_token: "access-token", expires_in: 3600 });
    }
    if (url.includes("/sites/example.sharepoint.com:/sites/OfficeConverter")) {
      return responseJson({ id: "site-id" });
    }
    if (url.includes("/sites/site-id/drive")) return responseJson({ id: "drive-id" });
    if (url.includes("/root:/TempConversions")) {
      return responseJson({ id: "folder-id", folder: {} });
    }
    if (method === "POST" && url.endsWith("/createUploadSession")) {
      uploadSessionCreated = true;
      return responseJson({ uploadUrl: "https://upload.example.test/session-token" }, 200);
    }
    if (method === "PUT" && url === "https://upload.example.test/session-token") {
      chunkUploaded = true;
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.get("content-range"), "bytes 0-1048576/1048577");
      return responseJson({ id: "large-upload-id" }, 201);
    }
    if (method === "GET" && url.includes("format=pdf")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "https://download.example.test/large.pdf" },
      });
    }
    if (url === "https://download.example.test/large.pdf") {
      return new Response(Buffer.from(`%PDF-1.7\n${"large-pdf-data".repeat(12)}`));
    }
    if (method === "POST" && url.endsWith("/permanentDelete")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const sourcePath = path.join(workDir, "large.pptx");
  await fs.writeFile(sourcePath, Buffer.alloc(1024 * 1024 + 1, 1));
  const output = await convertOfficeFileToPdfViaMicrosoftGraph(sourcePath, workDir, {
    kind: "pptx",
  });
  assert.equal(uploadSessionCreated, true);
  assert.equal(chunkUploaded, true);
  assert.match(await fs.readFile(output, "utf8"), /^%PDF-/);
});

test("Graph configuration reports missing secret values without exposing any value", () => {
  const previousEnvironment = new Map(
    GRAPH_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]] as const),
  );
  try {
    for (const key of GRAPH_ENVIRONMENT_KEYS) delete process.env[key];
    assert.deepEqual(microsoftGraphPdfConfigurationMissing(), [
      "MS_GRAPH_TENANT_ID",
      "MS_GRAPH_CLIENT_ID",
      "MS_GRAPH_CLIENT_SECRET",
      "MS_GRAPH_SHAREPOINT_SITE_URL",
    ]);
  } finally {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetMicrosoftGraphPdfCaches();
  }
});
