import { execFileSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** فلتر PDF في LibreOffice بدون تصغير دقة الصور المضمّنة. */
const LO_PDF_FILTER =
  'pdf:writer_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"},"MaxImageResolution":{"type":"long","value":"600"},"UseTaggedPDF":{"type":"boolean","value":"false"},"ExportFormFields":{"type":"boolean","value":"false"}}';

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
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ];

  return [
    ...fromEnv,
    ...(process.platform === "win32" ? winRoots : unixBins),
    "soffice",
    "libreoffice",
  ];
}

function candidateWinWordBins(): string[] {
  return [
    process.env.WINWORD_PATH || "",
    "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
    "C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE",
    "C:\\Program Files (x86)\\Microsoft Office\\Office16\\WINWORD.EXE",
  ].filter((v) => v.trim().length > 0);
}

let cachedSoffice: string | null | undefined;

/** يعيد مسار LibreOffice إن وُجد، وإلا null. */
export function resolveSofficeBinary(): string | null {
  if (cachedSoffice !== undefined) return cachedSoffice;

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

export function isMicrosoftWordAvailable(): boolean {
  if (process.platform !== "win32") return false;
  return candidateWinWordBins().some((p) => fs.existsSync(p));
}

function runCommand(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN || "svp",
      },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

async function convertViaLibreOffice(
  docxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const soffice = resolveSofficeBinary();
  if (!soffice) {
    throw new Error("LibreOffice غير متوفر");
  }

  await fs.promises.mkdir(outDir, { recursive: true });
  const timeoutMs = opts?.timeoutMs ?? 10 * 60_000;
  const absDocx = path.resolve(docxPath);
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
        LO_PDF_FILTER,
        "--outdir",
        absOut,
        absDocx,
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
        absDocx,
      ],
    ];

    let lastError = "تعذر تحويل Word إلى PDF عبر LibreOffice";
    for (const args of attempts) {
      try {
        const result = await runCommand(soffice, args, { cwd: absOut, timeoutMs });
        const expectedPdf = path.join(
          absOut,
          `${path.basename(absDocx, path.extname(absDocx))}.pdf`,
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
 * تحويل عبر Microsoft Word COM — أفضل مطابقة للملف الناتج على Windows.
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
  $doc = $word.Documents.Open($docx, $false, $true)
  # 17 = wdFormatPDF — SaveAs2 يحافظ على تقسيم الصفحات كما في Word
  $wdFormatPDF = 17
  try {
    $doc.SaveAs2($pdf, $wdFormatPDF)
  } catch {
    $doc.SaveAs([ref]$pdf, [ref]$wdFormatPDF)
  }
  if (-not (Test-Path -LiteralPath $pdf)) {
    # احتياطي: تصدير كل المستند (Range=0, Item=0) وليس وضع markup
    $doc.ExportAsFixedFormat($pdf, 17, $false, 0, 0, 0, 0, 0, $true, $true, 0, $true, $true, $false)
  }
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

/**
 * يحوّل DOCX إلى PDF بأعلى جودة متاحة:
 * 1) Microsoft Word COM على Windows (نفس محرّك Word → تطابق أفضل)
 * 2) LibreOffice إن وُجد
 */
export async function convertDocxToPdf(
  docxPath: string,
  outDir: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const errors: string[] = [];

  if (process.platform === "win32" && isMicrosoftWordAvailable()) {
    try {
      return await convertViaWordCom(docxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (resolveSofficeBinary()) {
    try {
      return await convertViaLibreOffice(docxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    errors.push("LibreOffice غير متوفر");
  }

  // محاولة أخيرة عبر COM حتى لو لم يُعثر على مسار WINWORD الثابت
  if (process.platform === "win32" && !isMicrosoftWordAvailable()) {
    try {
      return await convertViaWordCom(docxPath, outDir, opts);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  throw new Error(
    `تعذر تحويل Word إلى PDF. ${errors.filter(Boolean).join(" | ")}`.slice(0, 700),
  );
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
  return resolveSofficeBinary() != null || isMicrosoftWordAvailable();
}
