import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";

// Bare names rely on PATH, which is the common case on Linux/macOS servers.
// On Windows, installers update the registry's PATH but already-running
// processes (and anything spawned from them) keep their stale copy until a
// full session restart — so a freshly-installed LibreOffice can be genuinely
// present and still invisible to `spawn("soffice", ...)` for a while. The
// absolute default install paths sidestep that entirely.
const CANDIDATE_BINARIES = [
  "soffice",
  "soffice.exe",
  "libreoffice",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

let cachedBinary: string | null | undefined; // undefined = not checked yet

function tryRun(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

export async function detectLibreOffice(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  for (const bin of CANDIDATE_BINARIES) {
    if (await tryRun(bin)) {
      cachedBinary = bin;
      return bin;
    }
  }
  cachedBinary = null;
  return null;
}

// office/pdf conversion, gated by LibreOffice being installed (ТЗ §5.5) —
// see README for the optional `winget install TheDocumentFoundation.LibreOffice`.
//
// PDF is a special case: LibreOffice opens a PDF into Draw by default
// (treating each page as a fixed drawing), which has no export filter to
// Writer/Calc/Impress formats at all — hence "--convert-to docx" alone
// fails outright on a PDF input with "no export filter found". Getting PDF
// content into an *editable* docx requires explicitly routing the import
// through Writer's own PDF-import filter instead. There is no equivalent
// import filter for Calc or Impress, so PDF->xlsx/pptx reconstruction isn't
// something LibreOffice can do this way — only PDF->docx and PDF->image
// (the latter via Draw's native page-export, no special filter needed).
export async function convertViaLibreOffice(
  input: Buffer,
  sourceExt: string,
  targetFormat: string,
  infilter?: string,
): Promise<Buffer> {
  const bin = await detectLibreOffice();
  if (!bin) {
    throw new Error(
      `Конвертация "${sourceExt}" → "${targetFormat}" требует LibreOffice, который не установлен на сервере. ` +
        "Установите его (winget install TheDocumentFoundation.LibreOffice) и повторите попытку.",
    );
  }

  const tmpDir = path.join(os.tmpdir(), `fh-lo-${nanoid()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  const inPath = path.join(tmpDir, `input.${sourceExt}`);
  await fs.writeFile(inPath, input);

  const args = ["--headless"];
  if (infilter) args.push(`--infilter=${infilter}`);
  args.push("--convert-to", targetFormat, "--outdir", tmpDir, inPath);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args);
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`LibreOffice завершился с ошибкой: ${stderr}`))));
  });

  const outPath = path.join(tmpDir, `input.${targetFormat}`);
  const out = await fs.readFile(outPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return out;
}
