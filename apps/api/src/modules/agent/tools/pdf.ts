import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas } from "@napi-rs/canvas";
import { env } from "../../../env.js";

// PDF has no editable "document model" the way OOXML formats do — there are
// no write tools here on purpose. The agent can read/summarize/answer
// questions about a PDF's text, or build a brand new docx/pptx/xlsx from it
// via create_file_from_description, but it never proposes an in-place PDF
// edit.
//
// Uses pdfjs-dist (Mozilla's actively-maintained PDF.js) rather than the
// pdf-parse package: pdf-parse bundles a frozen 2018-era PDF.js build that
// throws "Invalid PDF structure" on any PDF using compressed cross-reference
// streams — a mainstream PDF 1.5+ feature that pdf-lib, and many real-world
// PDF writers, use by default. That made the tool fail on ordinary PDFs, not
// just edge cases.
export async function readPdfText(buffer: Buffer, maxChars = 20000): Promise<string> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  try {
    const pageTexts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pageTexts.push(pageText);
    }

    const text = pageTexts.join("\n\n").trim();
    if (!text) {
      return "(в PDF не найден текстовый слой — возможно, это скан без OCR; извлечь текст не удалось)";
    }
    const truncated = text.length > maxChars;
    return `Страниц: ${doc.numPages}\n\n${text.slice(0, maxChars)}${truncated ? "\n\n…(текст обрезан)" : ""}`;
  } finally {
    await doc.destroy();
  }
}

export interface PdfPageImage {
  pageNum: number;
  base64: string;
  mediaType: "image/jpeg";
}

// Fallback for scanned PDFs (no text layer): rasterize each page and let
// Claude's vision read it directly, rather than wiring up a separate OCR
// engine — vision already reads scanned text about as well as dedicated OCR
// and, unlike OCR, also describes any non-text content (photos, diagrams) on
// the page in the same pass.
// scale/quality are configurable (AGENT_PDF_IMAGE_SCALE/_QUALITY, see env.ts)
// since they're the other lever — alongside page count — on how much
// context a scan costs; JPEG over PNG because scanned pages are
// photographic-ish (noise, no flat colors) where JPEG compresses far
// smaller for the same visual quality.
export async function renderPdfPagesAsImages(
  buffer: Buffer,
  maxPages = env.agentPdfMaxPages,
  scale = env.agentPdfImageScale,
  jpegQuality = env.agentPdfImageQuality,
): Promise<{ images: PdfPageImage[]; totalPages: number }> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  try {
    const pageCount = Math.min(doc.numPages, maxPages);
    const images: PdfPageImage[] = [];
    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvasContext: context as any, viewport }).promise;
      const jpeg = canvas.toBuffer("image/jpeg", jpegQuality);
      images.push({ pageNum, base64: jpeg.toString("base64"), mediaType: "image/jpeg" });
    }
    return { images, totalPages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}
