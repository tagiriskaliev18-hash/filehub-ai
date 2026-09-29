import JSZip from "jszip";
import sharp from "sharp";
import type { CompressResult } from "./image.js";

const IMAGE_EXT = /\.(jpe?g|png)$/i;

async function recompressMedia(zip: JSZip, quality: number): Promise<void> {
  const entries = Object.values(zip.files).filter((f) => !f.dir && /\/media\//i.test(f.name) && IMAGE_EXT.test(f.name));
  for (const entry of entries) {
    const original = await entry.async("nodebuffer");
    try {
      const isPng = /\.png$/i.test(entry.name);
      const recompressed = isPng
        ? await sharp(original).png({ quality, compressionLevel: 9, palette: quality < 70 }).toBuffer()
        : await sharp(original).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (recompressed.length < original.length) {
        zip.file(entry.name, recompressed);
      }
    } catch {
      // Unsupported/corrupt embedded image — leave it untouched rather than fail the whole job.
    }
  }
}

// Recompresses embedded raster images inside an Office Open XML package
// (docx/pptx/xlsx are zip archives) without touching document structure —
// satisfies ТЗ §5.4 "optimization of embedded images in office documents".
export async function compressOfficeZipToTarget(
  input: Buffer,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  if (input.length <= targetBytes) {
    onProgress?.(100);
    return { data: input, achievedBytes: input.length, targetMet: true };
  }

  const qualitySteps = [85, 70, 55, 40, 25, 15];
  let best: Buffer = input;
  let bestSize = input.length;

  for (let i = 0; i < qualitySteps.length; i++) {
    const zip = await JSZip.loadAsync(input);
    await recompressMedia(zip, qualitySteps[i]);
    const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    onProgress?.(Math.round(((i + 1) / qualitySteps.length) * 100));

    if (out.length < bestSize) {
      best = out;
      bestSize = out.length;
    }
    if (out.length <= targetBytes) {
      return { data: out, achievedBytes: out.length, targetMet: true };
    }
  }

  return { data: best, achievedBytes: bestSize, targetMet: false };
}

export async function recompressArchive(input: Buffer, targetBytes: number): Promise<CompressResult> {
  const zip = await JSZip.loadAsync(input);
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { data: out, achievedBytes: out.length, targetMet: out.length <= targetBytes };
}
