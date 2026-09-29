import sharp from "sharp";

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  tiff: "image/tiff",
};

export async function convertImage(input: Buffer, targetFormat: string): Promise<{ data: Buffer; mimeType: string }> {
  const fmt = targetFormat.toLowerCase();
  let pipeline = sharp(input);
  switch (fmt) {
    case "jpg":
    case "jpeg":
      pipeline = pipeline.jpeg({ quality: 90 });
      break;
    case "png":
      pipeline = pipeline.png();
      break;
    case "webp":
      pipeline = pipeline.webp({ quality: 90 });
      break;
    case "avif":
      pipeline = pipeline.avif({ quality: 90 });
      break;
    case "tiff":
      pipeline = pipeline.tiff();
      break;
    default:
      throw new Error(`Формат изображения "${targetFormat}" не поддерживается`);
  }
  const data = await pipeline.toBuffer();
  return { data, mimeType: MIME_BY_FORMAT[fmt] ?? "application/octet-stream" };
}
