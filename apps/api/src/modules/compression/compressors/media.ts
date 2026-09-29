import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { nanoid } from "nanoid";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import ffprobePath from "@ffprobe-installer/ffprobe";
import type { CompressResult } from "./image.js";

ffmpeg.setFfmpegPath(ffmpegPath.path);
ffmpeg.setFfprobePath(ffprobePath.path);

function probeDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration ?? 0);
    });
  });
}

function transcode(
  filePath: string,
  outPath: string,
  isVideo: boolean,
  bitrateKbps: number,
  onFfmpegProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(filePath);
    if (isVideo) {
      cmd
        .videoBitrate(bitrateKbps)
        .audioBitrate(Math.min(128, Math.max(64, Math.round(bitrateKbps * 0.15))))
        .outputOptions(["-preset", "fast"]);
    } else {
      cmd.audioBitrate(bitrateKbps);
    }
    cmd
      .on("progress", (p) => {
        if (typeof p.percent === "number") onFfmpegProgress?.(Math.max(0, Math.min(100, p.percent)));
      })
      .on("end", () => resolve())
      .on("error", reject)
      .save(outPath);
  });
}

export async function compressMediaToTarget(
  input: Buffer,
  extHint: string,
  targetBytes: number,
  isVideo: boolean,
  onProgress?: (pct: number) => void,
): Promise<CompressResult> {
  if (input.length <= targetBytes) {
    onProgress?.(100);
    return { data: input, achievedBytes: input.length, targetMet: true };
  }

  const tmpDir = os.tmpdir();
  const inPath = path.join(tmpDir, `fh-in-${nanoid()}.${extHint}`);
  await fs.writeFile(inPath, input);

  try {
    const durationSeconds = Math.max(1, await probeDurationSeconds(inPath));
    const targetBits = targetBytes * 8;
    let bitrateKbps = Math.max(32, Math.floor(targetBits / durationSeconds / 1000) - 16);

    let best: Buffer = input;
    let bestSize = input.length;
    const outExt = isVideo ? "mp4" : "mp3";
    const newMimeType = isVideo ? "video/mp4" : "audio/mpeg";

    const MAX_ATTEMPTS = 4;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const outPath = path.join(tmpDir, `fh-out-${nanoid()}.${outExt}`);
      await transcode(inPath, outPath, isVideo, bitrateKbps, (ffmpegPercent) => {
        onProgress?.(Math.round(((attempt + ffmpegPercent / 100) / MAX_ATTEMPTS) * 100));
      });
      const out = await fs.readFile(outPath);
      await fs.rm(outPath, { force: true });

      if (out.length < bestSize) {
        best = out;
        bestSize = out.length;
      }
      if (out.length <= targetBytes) {
        onProgress?.(100);
        return { data: out, achievedBytes: out.length, targetMet: true, newMimeType, newExtension: outExt };
      }
      bitrateKbps = Math.max(16, Math.floor(bitrateKbps * 0.7));
    }

    return { data: best, achievedBytes: bestSize, targetMet: false, newMimeType, newExtension: outExt };
  } finally {
    await fs.rm(inPath, { force: true });
  }
}
