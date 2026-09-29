import path from "node:path";
import { prisma } from "../../prisma.js";
import { storage } from "../storage/storage.adapter.js";
import { uploadFile } from "../files/files.service.js";
import { categoryForMime } from "@filehub/shared";
import { convertImage } from "./converters/image.js";
import { convertMedia } from "./converters/media.js";
import { convertSpreadsheet } from "./converters/spreadsheet.js";
import { wrapInZip } from "./converters/archive.js";
import { convertViaLibreOffice } from "./libreoffice.js";

export interface ConvertFileResult {
  fileId: string;
  fileName: string;
  targetFormat: string;
  resultFileId: string;
  resultFileName: string;
}

const PDF_MIME = "application/pdf";
const LIBREOFFICE_TARGET_MIME: Record<string, string> = {
  pdf: PDF_MIME,
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  png: "image/png",
};

export async function convertOneFile(
  fileId: string,
  targetFormat: string,
  onProgress?: (pct: number) => void,
): Promise<ConvertFileResult> {
  const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
  const original = await storage.get(file.storageKey);
  const category = categoryForMime(file.mimeType);
  const sourceExt = path.extname(file.name).replace(".", "").toLowerCase();
  const fmt = targetFormat.toLowerCase();

  // Rescaled to 0-90 so the tail end is visibly left for the upload step —
  // only audio/video conversion has real incremental progress (from ffmpeg);
  // everything else is a single fast pass, so it jumps straight to 90.
  const subProgress = (pct: number) => onProgress?.(Math.round(pct * 0.9));

  let converted: { data: Buffer; mimeType: string };

  // Anything that touches PDF as source or target — docx<->pdf and
  // image<->pdf — goes through LibreOffice, since none of our other
  // libraries (sharp, exceljs, pdf-lib) can read or write PDF page content.
  // LibreOffice opens a PDF into Draw by default (a fixed drawing, not
  // editable text), which has no export filter to Writer/Calc/Impress
  // formats at all. Getting *editable* text out requires routing the import
  // through Writer's dedicated PDF-import filter instead — there's no
  // equivalent filter for Calc/Impress, so PDF->xlsx/pptx reconstruction
  // isn't something LibreOffice can do this way (not offered in the
  // conversion matrix for that reason). PDF->image works via Draw's native
  // page export and needs no special filter; it only yields the first page.
  const isPdfInvolved = category === "pdf" || (category === "image" && fmt === "pdf");

  if (isPdfInvolved) {
    const infilter = category === "pdf" && fmt === "docx" ? "writer_pdf_import" : undefined;
    const data = await convertViaLibreOffice(original, sourceExt, fmt, infilter);
    converted = { data, mimeType: LIBREOFFICE_TARGET_MIME[fmt] ?? "application/octet-stream" };
    onProgress?.(90);
  } else if (category === "image") {
    converted = await convertImage(original, fmt);
    onProgress?.(90);
  } else if (category === "audio" || category === "video") {
    converted = await convertMedia(original, sourceExt, fmt, subProgress);
  } else if (category === "spreadsheet" && fmt !== "pdf") {
    converted = await convertSpreadsheet(original, sourceExt, fmt);
    onProgress?.(90);
  } else if (category === "spreadsheet" || category === "document" || category === "presentation") {
    // fmt === "pdf" here (the only target these categories offer besides
    // the spreadsheet-only branch above)
    const data = await convertViaLibreOffice(original, sourceExt, "pdf");
    converted = { data, mimeType: PDF_MIME };
    onProgress?.(90);
  } else if (fmt === "zip") {
    converted = await wrapInZip(original, file.name);
    onProgress?.(90);
  } else {
    throw new Error(`Конвертация "${file.mimeType}" → "${targetFormat}" не поддерживается`);
  }

  const resultName = `${stripExt(file.name)}.${fmt}`;
  const created = await uploadFile({
    ownerId: file.ownerId,
    folderId: file.folderId,
    originalName: resultName,
    mimeType: converted.mimeType,
    data: converted.data,
  });
  onProgress?.(100);

  return {
    fileId: file.id,
    fileName: file.name,
    targetFormat: fmt,
    resultFileId: created.id,
    resultFileName: created.name,
  };
}

function stripExt(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}
