import JSZip from "jszip";
import { extractPlainText, replaceTextAcrossRuns, encodeXmlEntities, findBlockRanges } from "./xmlTextUtil.js";

const DOC_PATH = "word/document.xml";

export async function readDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file(DOC_PATH)?.async("string");
  if (!xml) throw new Error("Не удалось прочитать word/document.xml");
  // Paragraph breaks approximated at </w:p> boundaries for readability.
  return xml
    .split("</w:p>")
    .map((chunk) => extractPlainText(chunk, "w:t"))
    .filter((line) => line.length > 0)
    .join("\n");
}

export async function replaceDocxText(buffer: Buffer, find: string, replace: string): Promise<{ buffer: Buffer; occurrences: number }> {
  const zip = await JSZip.loadAsync(buffer);
  let xml = await zip.file(DOC_PATH)?.async("string");
  if (!xml) throw new Error("Не удалось прочитать word/document.xml");

  // Scoped per-paragraph (not document-wide): a document-wide flatten/
  // redistribute would merge every paragraph's text into the first run of the
  // first paragraph, destroying paragraph breaks. Each paragraph's own runs
  // are still flattened together so a phrase split across runs within one
  // paragraph (the common Word run-fragmentation case) is still matched.
  const blocks = findBlockRanges(xml, "w:p");
  let totalOccurrences = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const fragment = xml.slice(block.start, block.end);
    const result = replaceTextAcrossRuns(fragment, "w:t", find, replace);
    if (result.changed) {
      totalOccurrences += result.occurrences;
      xml = xml.slice(0, block.start) + result.xml + xml.slice(block.end);
    }
  }
  if (totalOccurrences === 0) return { buffer, occurrences: 0 };

  zip.file(DOC_PATH, xml);
  const out = await zip.generateAsync({ type: "nodebuffer" });
  return { buffer: out, occurrences: totalOccurrences };
}

export async function appendDocxParagraph(buffer: Buffer, text: string, heading?: boolean): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file(DOC_PATH)?.async("string");
  if (!xml) throw new Error("Не удалось прочитать word/document.xml");

  const pStyle = heading ? `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` : "";
  const newParagraph = `<w:p>${pStyle}<w:r><w:t xml:space="preserve">${encodeXmlEntities(text)}</w:t></w:r></w:p>`;

  // Insert right before the body's closing sectPr (or </w:body> if no sectPr) —
  // that's the standard "append at end of document" insertion point in OOXML.
  const sectPrIndex = xml.lastIndexOf("<w:sectPr");
  const insertAt = sectPrIndex !== -1 ? sectPrIndex : xml.lastIndexOf("</w:body>");
  if (insertAt === -1) throw new Error("Некорректная структура word/document.xml");

  const newXml = xml.slice(0, insertAt) + newParagraph + xml.slice(insertAt);
  zip.file(DOC_PATH, newXml);
  return zip.generateAsync({ type: "nodebuffer" });
}
