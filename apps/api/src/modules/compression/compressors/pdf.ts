import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import sharp from "sharp";
import type { CompressResult } from "./image.js";

// Recompresses JPEG (DCTDecode) image XObjects embedded in a PDF. Raw
// (FlateDecode) pixel streams are left untouched — decoding/re-encoding those
// correctly needs full colorspace/bit-depth handling, out of scope for the MVP.
// Scanned-photo PDFs (the common "PDF is huge because of photos" case) are
// still handled since scanners/exports almost always embed JPEGs.
async function recompressJpegXObjects(doc: PDFDocument, quality: number): Promise<boolean> {
  let changedAny = false;
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    const filter = dict.get(PDFName.of("Filter"));
    const filterName = filter?.toString() ?? "";
    if (subtype?.toString() !== "/Image" || !filterName.includes("DCTDecode")) continue;

    try {
      const recompressed = await sharp(Buffer.from(obj.contents)).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (recompressed.length < obj.contents.length) {
        dict.set(PDFName.of("Length"), PDFNumber.of(recompressed.length));
        const newStream = PDFRawStream.of(dict, recompressed);
        doc.context.assign(ref, newStream);
        changedAny = true;
      }
    } catch {
      // Not a decodable JPEG stream (corrupt or unusual encoding) — skip it.
    }
  }
  return changedAny;
}

export async function compressPdfToTarget(
  input: Buffer,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  if (input.length <= targetBytes) {
    onProgress?.(100);
    return { data: input, achievedBytes: input.length, targetMet: true };
  }

  const qualitySteps = [80, 65, 50, 35, 20];
  let best: Buffer = input;
  let bestSize = input.length;

  for (let i = 0; i < qualitySteps.length; i++) {
    const doc = await PDFDocument.load(input, { updateMetadata: false });
    const changed = await recompressJpegXObjects(doc, qualitySteps[i]);
    if (!changed) break; // no JPEG images to recompress further — stop early

    const out = Buffer.from(await doc.save({ useObjectStreams: true }));
    onProgress?.(Math.round(((i + 1) / qualitySteps.length) * 100));
    if (out.length < bestSize) {
      best = out;
      bestSize = out.length;
    }
    if (out.length <= targetBytes) {
      return { data: out, achievedBytes: out.length, targetMet: true };
    }
  }

  return { data: best, achievedBytes: bestSize, targetMet: bestSize <= targetBytes };
}
