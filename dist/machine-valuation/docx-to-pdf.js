"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSofficeBinary = resolveSofficeBinary;
exports.isMicrosoftWordAvailable = isMicrosoftWordAvailable;
exports.convertDocxToPdf = convertDocxToPdf;
exports.convertDocxToPdfWithLibreOffice = convertDocxToPdfWithLibreOffice;
exports.isLibreOfficeAvailable = isLibreOfficeAvailable;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const LO_PDF_FILTER = 'pdf:writer_pdf_Export:{"ReduceImageResolution":{"type":"boolean","value":"false"},"Quality":{"type":"long","value":"100"},"MaxImageResolution":{"type":"long","value":"600"},"UseTaggedPDF":{"type":"boolean","value":"false"},"ExportFormFields":{"type":"boolean","value":"false"}}';
function whichCommand(cmd) {
    try {
        if (process.platform === "win32") {
            const out = (0, child_process_1.execFileSync)("where.exe", [cmd], {
                encoding: "utf8",
                windowsHide: true,
            });
            return (out
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line.length > 0) ?? null);
        }
        const out = (0, child_process_1.execFileSync)("sh", ["-c", `command -v ${cmd}`], {
            encoding: "utf8",
        });
        const hit = out.trim();
        return hit || null;
    }
    catch {
        return null;
    }
}
function candidateSofficeBins() {
    const fromEnv = [process.env.LIBREOFFICE_PATH, process.env.SOFFICE_PATH].filter((v) => typeof v === "string" && v.trim().length > 0);
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
function candidateWinWordBins() {
    return [
        process.env.WINWORD_PATH || "",
        "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
        "C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE",
        "C:\\Program Files\\Microsoft Office\\Office16\\WINWORD.EXE",
        "C:\\Program Files (x86)\\Microsoft Office\\Office16\\WINWORD.EXE",
    ].filter((v) => v.trim().length > 0);
}
let cachedSoffice;
function resolveSofficeBinary() {
    if (cachedSoffice !== undefined)
        return cachedSoffice;
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
function isMicrosoftWordAvailable() {
    if (process.platform !== "win32")
        return false;
    return candidateWinWordBins().some((p) => fs.existsSync(p));
}
function runCommand(bin, args, opts) {
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(bin, args, {
            cwd: opts.cwd,
            timeout: opts.timeoutMs,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            env: {
                ...process.env,
                SAL_USE_VCLPLUGIN: process.env.SAL_USE_VCLPLUGIN || "svp",
            },
        });
        const out = [];
        const err = [];
        child.stdout.on("data", (d) => out.push(d));
        child.stderr.on("data", (d) => err.push(d));
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
async function convertViaLibreOffice(docxPath, outDir, opts) {
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
        const attempts = [
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
                const expectedPdf = path.join(absOut, `${path.basename(absDocx, path.extname(absDocx))}.pdf`);
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
                if (newest)
                    return newest.p;
                lastError =
                    result.stderr.trim() ||
                        result.stdout.trim() ||
                        `LibreOffice exited ${result.code} without producing a PDF`;
            }
            catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
                if (/ENOENT/i.test(lastError)) {
                    cachedSoffice = null;
                    throw new Error("LibreOffice غير متوفر");
                }
            }
        }
        throw new Error(lastError.slice(0, 500));
    }
    finally {
        fs.rm(userProfile, { recursive: true, force: true }, () => undefined);
    }
}
async function convertViaWordCom(docxPath, outDir, opts) {
    if (process.platform !== "win32") {
        throw new Error("Microsoft Word COM متاح على Windows فقط");
    }
    await fs.promises.mkdir(outDir, { recursive: true });
    const absDocx = path.resolve(docxPath);
    const absPdf = path.join(path.resolve(outDir), `${path.basename(absDocx, path.extname(absDocx))}.pdf`);
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
        const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath], { cwd: outDir, timeoutMs: opts?.timeoutMs ?? 15 * 60_000 });
        if (!fs.existsSync(absPdf) || fs.statSync(absPdf).size < 200) {
            throw new Error((result.stderr || result.stdout || "Word COM PDF export failed").slice(0, 500));
        }
        return absPdf;
    }
    finally {
        fs.rm(scriptPath, { force: true }, () => undefined);
    }
}
async function convertDocxToPdf(docxPath, outDir, opts) {
    const errors = [];
    if (process.platform === "win32" && isMicrosoftWordAvailable()) {
        try {
            return await convertViaWordCom(docxPath, outDir, opts);
        }
        catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }
    }
    if (resolveSofficeBinary()) {
        try {
            return await convertViaLibreOffice(docxPath, outDir, opts);
        }
        catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }
    }
    else {
        errors.push("LibreOffice غير متوفر");
    }
    if (process.platform === "win32" && !isMicrosoftWordAvailable()) {
        try {
            return await convertViaWordCom(docxPath, outDir, opts);
        }
        catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
        }
    }
    throw new Error(`تعذر تحويل Word إلى PDF. ${errors.filter(Boolean).join(" | ")}`.slice(0, 700));
}
async function convertDocxToPdfWithLibreOffice(docxPath, outDir, opts) {
    return convertDocxToPdf(docxPath, outDir, opts);
}
function isLibreOfficeAvailable() {
    return resolveSofficeBinary() != null || isMicrosoftWordAvailable();
}
