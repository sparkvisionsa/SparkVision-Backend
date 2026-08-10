import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

/**
 * Converts a .docx buffer to PDF using headless LibreOffice.
 * LibreOffice renders the document with the same layout engine used to
 * open it normally, so positions, images, tables, and pagination are
 * preserved exactly as they appear in Word/LibreOffice Writer.
 */
export async function convertDocxBufferToPdf(docxBuffer: Buffer): Promise<Buffer> {
  const workDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "docx2pdf-"),
  );
  const docxPath = path.join(workDir, `${randomUUID()}.docx`);
  const expectedPdfPath = docxPath.replace(/\.docx$/, ".pdf");

  try {
    await fs.promises.writeFile(docxPath, docxBuffer);

    await new Promise<void>((resolve, reject) => {
      // "soffice" is the LibreOffice CLI binary name on Linux/macOS.
      // On some distros it's "libreoffice". Adjust findSofficeBin() below
      // if needed for your deployment environment.
      const bin = findSofficeBin();
      const child = spawn(
        bin,
        [
          "--headless",
          "--norestore",
          "--convert-to",
          "pdf",
          "--outdir",
          workDir,
          docxPath,
        ],
        { timeout: 60_000 },
      );

      const errChunks: Buffer[] = [];
      child.stderr.on("data", (d: Buffer) => errChunks.push(d));

      child.on("error", (err) =>
        reject(new Error(`Failed to spawn LibreOffice: ${err.message}`)),
      );

      child.on("close", (code) => {
        if (code !== 0) {
          const stderr = Buffer.concat(errChunks).toString("utf8");
          reject(
            new Error(`LibreOffice conversion exited with code ${code}.\n${stderr}`),
          );
          return;
        }
        resolve();
      });
    });

    if (!fs.existsSync(expectedPdfPath)) {
      throw new Error("LibreOffice did not produce the expected PDF output.");
    }

    return await fs.promises.readFile(expectedPdfPath);
  } finally {
    // Best-effort cleanup — don't let cleanup failures mask the real result/error.
    fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function findSofficeBin(): string {
  const candidates = [
    "/usr/bin/soffice",
    "/usr/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // fall back to PATH lookup
  return "soffice";
}
