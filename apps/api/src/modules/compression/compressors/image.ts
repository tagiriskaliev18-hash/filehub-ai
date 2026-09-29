import sharp from "sharp";

export interface CompressResult {
  data: Buffer;
  achievedBytes: number;
  targetMet: boolean;
  newMimeType?: string;
  newExtension?: string;
}

const FORMAT_BY_MIME: Record<string, "jpeg" | "png" | "webp" | "avif" | "tiff"> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/tiff": "tiff",
};

async function encodeAt(buf: Buffer, format: string, quality: number, scale: number): Promise<Buffer> {
  let pipeline = sharp(buf);
  if (scale < 1) {
    const meta = await sharp(buf).metadata();
    if (meta.width) pipeline = pipeline.resize({ width: Math.max(1, Math.round(meta.width * scale)) });
  }
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    case "webp":
      return pipeline.webp({ quality }).toBuffer();
    case "avif":
      return pipeline.avif({ quality }).toBuffer();
    case "png":
      return pipeline.png({ quality, compressionLevel: 9, palette: quality < 80 }).toBuffer();
    case "tiff":
      return pipeline.tiff({ quality }).toBuffer();
    default:
      return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  }
}

export async function compressImageToTarget(
  input: Buffer,
  mimeType: string,
  targetBytes: number,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  const format = FORMAT_BY_MIME[mimeType] ?? "jpeg";

  if (input.length <= targetBytes) {
    onProgress?.(100);
    return { data: input, achievedBytes: input.length, targetMet: true };
  }

  let best: Buffer = input;
  let bestSize = input.length;

  const qualitySteps = [90, 80, 70, 60, 50, 40, 30, 20, 12];
  const scaleSteps = [1, 0.85, 0.7, 0.55, 0.4];
  const totalAttempts = qualitySteps.length * scaleSteps.length;
  let attempt = 0;

  for (const scale of scaleSteps) {
    for (const quality of qualitySteps) {
      const out = await encodeAt(input, format, quality, scale);
      attempt++;
      onProgress?.(Math.round((attempt / totalAttempts) * 100));
      if (out.length < bestSize) {
        best = out;
        bestSize = out.length;
      }
      if (out.length <= targetBytes) {
        onProgress?.(100);
        return { data: out, achievedBytes: out.length, targetMet: true };
      }
    }
  }

  return { data: best, achievedBytes: bestSize, targetMet: false };
}
