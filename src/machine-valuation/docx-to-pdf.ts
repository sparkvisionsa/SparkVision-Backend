import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  convertOfficeFileToPdfViaMicrosoftGraph,
  isMicrosoftGraphPdfConfigured,
  microsoftGraphPdfConfigurationMissing,
} from "./microsoft-graph-pdf";

/** فلتر PDF في LibreOffice بدون تصغير دقة الصور المضمّنة. */
const LO_WRITER_PDF_FILTER =
  'pdf:writer_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"},"MaxImageResolution":{"type":"long","value":"600"},"UseTaggedPDF":{"type":"boolean","value":"false"},"ExportFormFields":{"type":"boolean","value":"false"}}';
const LO_IMPRESS_PDF_FILTER =
  'pdf:impress_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"},"MaxImageResolution":{"type":"long","value":"600"},"UseTaggedPDF":{"type":"boolean","value":"false"}}';

function whichCommand(cmd: string): string | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", [cmd], {
        encoding: "utf8",
        windowsHide: true,
      });
      return (
        out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? null
      );
    }
    const out = execFileSync("sh", ["-c", `command -v ${cmd}`], {
      encoding: "utf8",
    });
    const hit = out.trim();
    return hit || null;
  } catch {
    return null;
  }
}

function candidateSofficeBins(): string[] {
  const fromEnv = [process.env.LIBREOFFICE_PATH, process.env.SOFFICE_PATH].filter(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );

  const winRoots = [
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  ];

  const unixBins = [
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/usr/lib/libreoffice/program/soffice",
    "/usr/lib/libreoffice/program/soffice.bin",
    "/snap/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];

  return [
    ...fromEnv,
    ...(process.platform === "win32" ? winRoots : unixBins),
    "soffice",
    "libreoffice",
  ];
}

function officeProgramRoots(): string[] {
  const localAppData = process.env.LOCALAPPDATA || "";
  return [
    "C:\\Program Files\\Microsoft Office\\root\\Office16",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16",
    "C:\\Program Files\\Microsoft Office\\root\\Office15",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office15",
    "C:\\Program Files\\Microsoft Office\\Office16",
    "C:\\Program Files (x86)\\Microsoft Office\\Office16",
    "C:\\Program Files\\Microsoft Office\\Office15",
    "C:\\Program Files (x86)\\Microsoft Office\\Office15",
    localAppData ? path.join(localAppData, "Microsoft\\WindowsApps") : "",
  ].filter(Boolean);
}

function candidateWinWordBins(): string[] {
  return [
    process.env.WINWORD_PATH || "",
    ...officeProgramRoots().map((root) => path.join(root, "WINWORD.EXE")),
  ].filter((v) => v.trim().length > 0);
}

function candidatePowerPointBins(): string[] {
  return [
    process.env.POWERPNT_PATH || "",
    process.env.POWERPOINT_PATH || "",
    ...officeProgramRoots().map((root) => path.join(root, "POWERPNT.EXE")),
  ].filter((v) => v.trim().length > 0);
}

type PdfRenderer = "graph" | "office" | "libreoffice";

function preferredPdfRenderer(): PdfRenderer {
  const raw = (
    process.env.MV_PDF_RENDERER ??
    process.env.MV_WORD_PDF_RENDERER ??
    ""
  )
    .trim()
    .toLowerCase();
  if (["graph", "microsoft-graph", "microsoft_graph", "office365", "m365"].includes(raw)) {
    return "graph";
  }
  if (raw === "libreoffice" || raw === "lo") return "libreoffice";
  if (!raw && isMicrosoftGraphPdfConfigured()) return "graph";
  return "office";
}

function allowLocalFallbackAfterGraphFailure(): boolean {
  const raw = (
    process.env.MS_GRAPH_ALLOW_LOCAL_FALLBACK ??
    process.env.MV_PDF_ALLOW_LIBREOFFICE_FALLBACK ??
    "false"
  )
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function canCreateComObject(progId: string): boolean {
  if (process.platform !== "win32") return false;
  try {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `try { $app = New-Object -ComObject ${progId}; if ($app) { try { $app.Quit() } catch {}; exit 0 }; exit 1 } catch { exit 1 }`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 25_000 },
    );
    return true;
  } catch {
    return false;
  }
}

let cachedSoffice: string | null | undefined;

type CommandResult = {
  code: number | null;
  stderr: string;
  stdout: string;
  timedOut?: boolean;
};

/** يعيد مسار LibreOffice إن وُجد، وإلا null. */
export function resolveSofficeBinary(): string | null {
  if (cachedSoffice && fs.existsSync(cachedSoffice)) return cachedSoffice;
  cachedSoffice = undefined;

  for (const candidate of candidateSofficeBins()) {
    if (candidate.includes("/") || candidate.includes("\\")) {
      if (fs.existsSync(candidate)) {
        cachedSoffice = candidate;
        return cachedSoffice;
      }
      continue;
    }
    const fromPath = whichCommand(candidate);
    if (fromPath) {
      cachedSoffice = fromPath;
      return cachedSoffice;
    }
  }

  cachedSoffice = null;
  return null;
}

let cachedWordAvailable: boolean | undefined;
let cachedPowerPointAvailable: boolean | undefined;

export function isMicrosoftWordAvailable(): boolean {
  if (process.platform !== "win32") return false;
  if (cachedWordAvailable !== undefined) return cachedWordAvailable;
  cachedWordAvailable =
    candidateWinWordBins().some((p) => fs.existsSync(p)) || canCreateComObject("Word.Application");
  return cachedWordAvailable;
}

export function isMicrosoftPowerPointAvailable(): boolean {
  if (process.platform !== "win32") return false;
  if (cachedPowerPointAvailable !== undefined) return cachedPowerPointAvailable;
  cachedPowerPointAvailable =
    candidatePowerPointBins().some((p) => fs.existsSync(p)) ||
    canCreateComObject("PowerPoint.Application");
  return cachedPowerPointAvailable;
}

function runCommand(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN || "svp",
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      callback();
    };

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (error) => settle(() => reject(error)));
    child.on("close", (code) => {
      settle(() =>
        resolve({
          code,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
    timeoutHandle = setTimeout(() => {
      try {
        child.kill();
        if (process.platform === "win32" && child.pid) {
          const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.on("error", () => undefined);
        }
      } finally {
        settle(() =>
          resolve({
            code: null,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr:
              Buffer.concat(err).toString("utf8") +
              "\nCommand timed out after " +
              opts.timeoutMs +
              "ms.",
            timedOut: true,
          }),
        );
      }
    }, opts.timeoutMs);
  });
}

async function convertViaLibreOffice(
  sourcePath: string,
  outDir: string,
  opts: { timeoutMs?: number; pdfFilter: string; sourceLabel: string },
): Promise<string> {
  const soffice = resolveSofficeBinary();
  if (!soffice) {
    throw new Error("LibreOffice غير متوفر");
  }

  await fs.promises.mkdir(outDir, { recursive: true });
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const absSource = path.resolve(sourcePath);
  const absOut = path.resolve(outDir);

  const userProfile = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lo-profile-"));
  try {
    const profileUri = `file:///${userProfile.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1:")}`;
    const attempts: string[][] = [
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${profileUri}`,
        "--convert-to",
        opts.pdfFilter,
        "--outdir",
        absOut,
        absSource,
      ],
      [
        "--headless",
        "--nologo",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${profileUri}`,
        "--convert-to",
        "pdf",
        "--outdir",
        absOut,
        absSource,
      ],
    ];

    let lastError = "تعذر تحويل " + opts.sourceLabel + " إلى PDF عبر LibreOffice";
    for (const args of attempts) {
      try {
        const result = await runCommand(soffice, args, { cwd: absOut, timeoutMs });
        const expectedPdf = path.join(
          absOut,
          `${path.basename(absSource, path.extname(absSource))}.pdf`,
        );
        if (fs.existsSync(expectedPdf) && fs.statSync(expectedPdf).size > 100) {
          return expectedPdf;
        }
        const pdfs = (await fs.promises.readdir(absOut))
          .filter((name) => name.toLowerCase().endsWith(".pdf"))
          .map((name) => path.join(absOut, name));
        const newest = pdfs
          .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs, size: fs.statSync(p).size }))
          .filter((row) => row.size > 100)
          .sort((a, b) => b.mtime - a.mtime)[0];
        if (newest) return newest.p;

        if (result.timedOut) {
          lastError = `LibreOffice timed out after ${timeoutMs}ms`;
          break;
        }

        lastError =
          result.stderr.trim() ||
          result.stdout.trim() ||
          `LibreOffice exited ${result.code} without producing a PDF`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (/ENOENT/i.test(lastError)) {
          cachedSoffice = null;
          throw new Error("LibreOffice غير متوفر");
        }
      }
    }
    throw new Error(lastError.slice(0, 500));
  } finally {
    fs.rm(userProfile, { recursive: true, force: true }, () => undefined);
  }
}

/**
 * تحويل عبر Microsoft Word COM — يحافظ على تخطيط الصفحات والصور كما في Word.
 */
async function convertViaWordCom(
  docxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Microsoft Word COM متاح على Windows فقط");
  }
  await fs.promises.mkdir(outDir, { recursive: true });
  const absDocx = path.resolve(docxPath);
  const absPdf = path.join(
    path.resolve(outDir),
    `${path.basename(absDocx, path.extname(absDocx))}.pdf`,
  );
  if (fs.existsSync(absPdf)) {
    await fs.promises.unlink(absPdf).catch(() => undefined);
  }

  const script = `
$ErrorActionPreference = 'Stop'
$docx = ${JSON.stringify(absDocx)}
$pdf = ${JSON.stringify(absPdf)}
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  try { $word.ScreenUpdating = $false } catch {}
  # ConfirmConversions=false, ReadOnly=true, AddToRecent=false — لا نعدّل ملف الدمج
  $doc = $word.Documents.Open($docx, $false, $true, $false)
  try { $word.ActiveDocument.ActiveWindow.View.Type = 3 } catch {}
  try { $doc.ActiveWindow.View.Type = 3 } catch {}
  try { $doc.Repaginate() } catch {}
  try {
    for ($i = 1; $i -le $doc.TablesOfContents.Count; $i++) {
      $doc.TablesOfContents.Item($i).UpdatePageNumbers() | Out-Null
    }
  } catch {}

  # 17=wdExportFormatPDF, OptimizeFor=0 Print, Range=0 All, Item=0 Content,
  # IncludeDocProps=true, KeepIRM=true, CreateBookmarks=1 Heading,
  # DocStructureTags=true, BitmapMissingFonts=true
  $doc.ExportAsFixedFormat($pdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 1, $true, $true, $false)
  if (-not (Test-Path -LiteralPath $pdf)) { throw 'Word PDF export did not create a file' }
  $len = (Get-Item -LiteralPath $pdf).Length
  if ($len -lt 200) { throw "PDF too small ($len bytes)" }
  Write-Output 'OK'
} finally {
  if ($doc -ne $null) {
    try { $doc.Close([ref]$false) } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null } catch {}
  }
  if ($word -ne $null) {
    try { $word.Quit([ref]$false) } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`.trim();

  const scriptPath = path.join(outDir, `word-pdf-${Date.now()}.ps1`);
  await fs.promises.writeFile(scriptPath, `\uFEFF${script}`, "utf8");
  try {
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { cwd: outDir, timeoutMs: opts?.timeoutMs ?? 15 * 60_000 },
    );
    if (!fs.existsSync(absPdf) || fs.statSync(absPdf).size < 200) {
      throw new Error(
        (result.stderr || result.stdout || "Word COM PDF export failed").slice(0, 500),
      );
    }
    return absPdf;
  } finally {
    fs.rm(scriptPath, { force: true }, () => undefined);
  }
}

export async function convertDocxToPdf(
  docxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const errors: string[] = [];
  const renderer = preferredPdfRenderer();

  if (renderer === "graph") {
    if (isMicrosoftGraphPdfConfigured()) {
      try {
        return await convertOfficeFileToPdfViaMicrosoftGraph(docxPath, outDir, {
          kind: "docx",
          timeoutMs: opts?.timeoutMs,
        });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    } else {
      errors.push(
        `Microsoft Graph غير مكتمل الإعداد: ${microsoftGraphPdfConfigurationMissing().join(", ")}`,
      );
    }

    if (!allowLocalFallbackAfterGraphFailure()) {
      throw new Error(
        `تعذر تحويل Word إلى PDF عبر Microsoft 365. ${errors.filter(Boolean).join(" | ")}`.slice(
          0,
          700,
        ),
      );
    }
  }

  const preferOffice = renderer !== "libreoffice";

  if (preferOffice && isMicrosoftWordAvailable()) {
    try {
      return await convertViaWordCom(docxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const allowLibreOfficeFallback = !preferOffice || process.platform !== "win32";
  if (allowLibreOfficeFallback && resolveSofficeBinary()) {
    try {
      return await convertViaLibreOffice(docxPath, outDir, {
        timeoutMs: opts?.timeoutMs,
        pdfFilter: LO_WRITER_PDF_FILTER,
        sourceLabel: "Word",
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else if (!preferOffice) {
    errors.push(
      process.platform === "win32"
        ? "LibreOffice غير متوفر"
        : "LibreOffice غير متوفر على الخادم — ثبّته بـ: bash scripts/install-pdf-deps.sh ثم أعد تشغيل Nest",
    );
  }

  if (!preferOffice && isMicrosoftWordAvailable()) {
    try {
      return await convertViaWordCom(docxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (process.platform === "win32" && !isMicrosoftWordAvailable()) {
    errors.push("Microsoft Word غير متوفر على هذا الجهاز. ثبّت Microsoft Office ثم أعد تشغيل الخادم.");
  }

  throw new Error(
    `تعذر تحويل Word إلى PDF. ${errors.filter(Boolean).join(" | ")}`.slice(0, 700),
  );
}

async function convertViaPowerPointCom(
  pptxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  if (process.platform !== "win32") {
    throw new Error("Microsoft PowerPoint COM is available on Windows only");
  }

  await fs.promises.mkdir(outDir, { recursive: true });
  const absPptx = path.resolve(pptxPath);
  const absPdf = path.join(
    path.resolve(outDir),
    path.basename(absPptx, path.extname(absPptx)) + ".pdf",
  );
  if (fs.existsSync(absPdf)) {
    await fs.promises.unlink(absPdf).catch(() => undefined);
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$pptx = " + JSON.stringify(absPptx),
    "$pdf = " + JSON.stringify(absPdf),
    "$powerPoint = $null",
    "$presentation = $null",
    "try {",
    "  $powerPoint = New-Object -ComObject PowerPoint.Application",
    "  try { $powerPoint.DisplayAlerts = 1 } catch {}",
    "  $presentation = $powerPoint.Presentations.Open($pptx, $true, $false, $false)",
    "  try {",
    "    # 2=ppFixedFormatTypePDF, 2=ppFixedFormatIntentPrint",
    "    $presentation.ExportAsFixedFormat($pdf, 2, 2, $false, 1, 1, $false, $null, 1, '', $true, $true, $true, $true, $false, $null)",
    "  } catch {",
    "    $presentation.SaveAs($pdf, 32)",
    "  }",
    "  if (-not (Test-Path -LiteralPath $pdf)) { throw 'PowerPoint PDF export did not create a file' }",
    '  $len = (Get-Item -LiteralPath $pdf).Length',
    '  if ($len -lt 200) { throw "PDF too small ($len bytes)" }',
    "  Write-Output 'OK'",
    "} finally {",
    "  if ($presentation -ne $null) {",
    "    try { $presentation.Close() } catch {}",
    "    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null } catch {}",
    "  }",
    "  if ($powerPoint -ne $null) {",
    "    try { $powerPoint.Quit() } catch {}",
    "    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null } catch {}",
    "  }",
    "  [GC]::Collect()",
    "  [GC]::WaitForPendingFinalizers()",
    "}",
  ].join("\r\n");

  const scriptPath = path.join(outDir, "pptx-pdf-" + Date.now() + ".ps1");
  await fs.promises.writeFile(scriptPath, "\uFEFF" + script, "utf8");
  try {
    const result = await runCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { cwd: outDir, timeoutMs: opts?.timeoutMs ?? 10 * 60_000 },
    );
    if (!fs.existsSync(absPdf) || fs.statSync(absPdf).size < 200) {
      throw new Error(
        (result.stderr || result.stdout || "PowerPoint COM PDF export failed").slice(0, 500),
      );
    }
    return absPdf;
  } finally {
    fs.rm(scriptPath, { force: true }, () => undefined);
  }
}

export async function convertPptxToPdf(
  pptxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const errors: string[] = [];
  const renderer = preferredPdfRenderer();

  if (renderer === "graph") {
    if (isMicrosoftGraphPdfConfigured()) {
      try {
        return await convertOfficeFileToPdfViaMicrosoftGraph(pptxPath, outDir, {
          kind: "pptx",
          timeoutMs: opts?.timeoutMs,
        });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    } else {
      errors.push(
        `Microsoft Graph غير مكتمل الإعداد: ${microsoftGraphPdfConfigurationMissing().join(", ")}`,
      );
    }

    if (!allowLocalFallbackAfterGraphFailure()) {
      throw new Error(
        (
          "تعذر تحويل PowerPoint إلى PDF عبر Microsoft 365. " +
          errors.filter(Boolean).join(" | ")
        ).slice(0, 700),
      );
    }
  }

  const preferOffice = renderer !== "libreoffice";

  if (preferOffice && isMicrosoftPowerPointAvailable()) {
    try {
      return await convertViaPowerPointCom(pptxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const allowLibreOfficeFallback = !preferOffice || process.platform !== "win32";
  if (allowLibreOfficeFallback && resolveSofficeBinary()) {
    try {
      return await convertViaLibreOffice(pptxPath, outDir, {
        timeoutMs: opts?.timeoutMs,
        pdfFilter: LO_IMPRESS_PDF_FILTER,
        sourceLabel: "PowerPoint",
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!preferOffice && isMicrosoftPowerPointAvailable()) {
    try {
      return await convertViaPowerPointCom(pptxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (process.platform === "win32" && !isMicrosoftPowerPointAvailable()) {
    errors.push("Microsoft PowerPoint غير متوفر على هذا الجهاز. ثبّت Microsoft Office ثم أعد تشغيل الخادم.");
  }

  throw new Error(
    ("تعذر تحويل PowerPoint إلى PDF. " + errors.filter(Boolean).join(" | ")).slice(0, 700),
  );
}

export function isDocxPdfConversionAvailable(): boolean {
  if (preferredPdfRenderer() === "graph") {
    return (
      isMicrosoftGraphPdfConfigured() ||
      (allowLocalFallbackAfterGraphFailure() &&
        (resolveSofficeBinary() != null || isMicrosoftWordAvailable()))
    );
  }
  return resolveSofficeBinary() != null || isMicrosoftWordAvailable();
}

export function isPptxPdfConversionAvailable(): boolean {
  if (preferredPdfRenderer() === "graph") {
    return (
      isMicrosoftGraphPdfConfigured() ||
      (allowLocalFallbackAfterGraphFailure() &&
        (resolveSofficeBinary() != null || isMicrosoftPowerPointAvailable()))
    );
  }
  return resolveSofficeBinary() != null || isMicrosoftPowerPointAvailable();
}

export function machineValuationPdfTimeoutMs(imageCount: number): number {
  const normalizedImageCount = Math.max(0, Math.floor(imageCount));
  return Math.min(15 * 60_000, Math.max(180_000, 60_000 + normalizedImageCount * 1500));
}

/** توافق مع الاستدعاءات السابقة */
export async function convertDocxToPdfWithLibreOffice(
  docxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  return convertDocxToPdf(docxPath, outDir, opts);
}

export function isLibreOfficeAvailable(): boolean {
  return isDocxPdfConversionAvailable();
}
