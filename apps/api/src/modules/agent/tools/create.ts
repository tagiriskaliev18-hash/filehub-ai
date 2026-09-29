import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import pptxgenjs from "pptxgenjs";
import ExcelJS from "exceljs";

// pptxgenjs's CJS type declarations don't expose a construct signature under
// NodeNext/ESM interop — the runtime export is a plain class, so this cast is
// a type-only workaround, not a behavior change.
const PptxGenJSCtor: new () => any = pptxgenjs as any;

export interface DocxOutline {
  title?: string;
  sections: { heading?: string; text: string }[];
}

// Times New Roman 14pt is the conventional default for official/corporate
// documents (ГОСТ Р 7.0.97-2016 and similar internal standards) — applied
// document-wide here rather than left to docx.js's own default (Calibri 11)
// so every agent-generated file follows the same standard look, independent
// of whatever font the source it was built from happened to use.
const STANDARD_FONT = "Times New Roman";
const BODY_SIZE = 28; // half-points: 14pt
const HEADING1_SIZE = 32; // 16pt
const TITLE_SIZE = 36; // 18pt

export async function createDocxFromOutline(outline: DocxOutline): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (outline.title) {
    children.push(new Paragraph({ text: outline.title, heading: HeadingLevel.TITLE }));
  }
  for (const section of outline.sections) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    }
    for (const line of section.text.split("\n")) {
      children.push(new Paragraph(line));
    }
  }
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: STANDARD_FONT, size: BODY_SIZE } },
        title: { run: { font: STANDARD_FONT, size: TITLE_SIZE, bold: true } },
        heading1: { run: { font: STANDARD_FONT, size: HEADING1_SIZE, bold: true } },
      },
    },
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

export interface PptxOutline {
  slides: { title: string; bullets: string[] }[];
}

export async function createPptxFromOutline(outline: PptxOutline): Promise<Buffer> {
  const pres = new PptxGenJSCtor();
  for (const slide of outline.slides) {
    const s = pres.addSlide();
    s.addText(slide.title, { x: 0.5, y: 0.4, w: "90%", h: 1, fontSize: 28, bold: true });
    if (slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.6, w: "85%", h: 4, fontSize: 18 },
      );
    }
  }
  const out = await pres.write({ outputType: "nodebuffer" });
  return out as Buffer;
}

export interface XlsxOutline {
  sheetName: string;
  rows: (string | number)[][];
}

export async function createXlsxFromOutline(outline: XlsxOutline): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(outline.sheetName || "Sheet1");
  for (const row of outline.rows) sheet.addRow(row);
  if (outline.rows.length > 0) {
    sheet.getRow(1).font = { bold: true };
  }
  sheet.columns.forEach((col) => (col.width = 18));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
