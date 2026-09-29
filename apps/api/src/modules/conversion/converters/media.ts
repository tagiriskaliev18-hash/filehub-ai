import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

const MIME_BY_FORMAT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export async function convertMedia(
  input: Buffer,
  sourceExt: string,
  targetFormat: string,
  onProgress?: (pct: number) => void,
): Promise<{ data: Buffer; mimeType: string }> {
  const fmt = targetFormat.toLowerCase();
  if (!MIME_BY_FORMAT[fmt]) throw new Error(`Формат "${targetFormat}" не поддерживается`);

  const tmpDir = os.tmpdir();
  const inPath = path.join(tmpDir, `fh-conv-in-${nanoid()}.${sourceExt}`);
  const outPath = path.join(tmpDir, `fh-conv-out-${nanoid()}.${fmt}`);
  await fs.writeFile(inPath, input);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .toFormat(fmt)
        .on("progress", (p) => {
          if (typeof p.percent === "number") onProgress?.(Math.max(0, Math.min(100, Math.round(p.percent))));
        })
        .on("end", () => resolve())
        .on("error", reject)
        .save(outPath);
    });
    onProgress?.(100);
    const data = await fs.readFile(outPath);
    return { data, mimeType: MIME_BY_FORMAT[fmt] };
  } finally {
    await fs.rm(inPath, { force: true });
    await fs.rm(outPath, { force: true });
  }
}
