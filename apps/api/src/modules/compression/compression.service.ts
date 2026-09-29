import path from "node:path";
import { prisma } from "../../prisma.js";
import { storage } from "../storage/storage.adapter.js";
import { createNewVersion, uploadFile } from "../files/files.service.js";
import { compressImageToTarget } from "./compressors/image.js";
import { compressMediaToTarget } from "./compressors/media.js";
import { compressPdfToTarget } from "./compressors/pdf.js";
import { compressOfficeZipToTarget, recompressArchive } from "./compressors/officeZip.js";
import type { CompressRequestInput } from "@filehub/shared";

type CompressCategory = "image" | "video" | "audio" | "pdf" | "office" | "archive" | "unsupported";

const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function categorize(mime: string): CompressCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (OFFICE_MIMES.has(mime)) return "office";
  if (mime === "application/zip") return "archive";
  return "unsupported";
}

function resolveTargetBytes(unit: CompressRequestInput["targetUnit"], value: number, originalBytes: number): number {
  if (unit === "MB") return Math.round(value * 1024 * 1024);
  if (unit === "KB") return Math.round(value * 1024);
  return Math.round(originalBytes * (value / 100));
}

export interface CompressFileResult {
  fileId: string;
  fileName: string;
  beforeBytes: number;
  afterBytes: number;
  targetBytes: number;
  targetMet: boolean;
  resultFileId: string;
  message: string;
}

export async function compressOneFile(
  fileId: string,
  input: Pick<CompressRequestInput, "targetValue" | "targetUnit" | "asNewFile">,
  onProgress?: (pct: number) => void,
): Promise<CompressFileResult> {
  const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
  const original = await storage.get(file.storageKey);
  const targetBytes = resolveTargetBytes(input.targetUnit, input.targetValue, original.length);
  const category = categorize(file.mimeType);

  // Each compressor reports 0-100 for its own work; that's rescaled to 0-90
  // here so the final 10% is visibly left for the upload/version-save step
  // that follows, rather than the bar sitting at 100% while still saving.
  const subProgress = (pct: number) => onProgress?.(Math.round(pct * 0.9));

  let result;
  switch (category) {
    case "image":
      result = await compressImageToTarget(original, file.mimeType, targetBytes, subProgress);
      break;
    case "video":
      result = await compressMediaToTarget(original, extOf(file.name) || "mp4", targetBytes, true, subProgress);
      break;
    case "audio":
      result = await compressMediaToTarget(original, extOf(file.name) || "mp3", targetBytes, false, subProgress);
      break;
    case "pdf":
      result = await compressPdfToTarget(original, targetBytes, subProgress);
      break;
    case "office":
      result = await compressOfficeZipToTarget(original, targetBytes, subProgress);
      break;
    case "archive":
      result = await recompressArchive(original, targetBytes);
      onProgress?.(90);
      break;
    default:
      throw new Error(`Сжатие для типа файла "${file.mimeType}" не поддерживается`);
  }

  const newName = result.newExtension ? `${stripExt(file.name)}.${result.newExtension}` : file.name;
  const newMime = result.newMimeType ?? file.mimeType;

  let resultFileId: string;
  if (input.asNewFile) {
    const created = await uploadFile({
      ownerId: file.ownerId,
      folderId: file.folderId,
      originalName: suffixName(newName, "-compressed"),
      mimeType: newMime,
      data: result.data,
    });
    resultFileId = created.id;
  } else {
    const updated = await createNewVersion({
      fileId: file.id,
      data: result.data,
      authoredBy: "USER",
      note: `Сжатие до ${input.targetValue} ${input.targetUnit}`,
      newMimeType: newMime,
      newName,
    });
    resultFileId = updated.id;
  }
  onProgress?.(100);

  return {
    fileId: file.id,
    fileName: file.name,
    beforeBytes: original.length,
    afterBytes: result.achievedBytes,
    targetBytes,
    targetMet: result.targetMet,
    resultFileId,
    message: result.targetMet
      ? "Целевой размер достигнут"
      : "Целевой размер недостижим без критической потери качества — сохранён минимально возможный размер",
  };
}

function extOf(name: string): string {
  return path.extname(name).replace(".", "").toLowerCase();
}
function stripExt(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}
function suffixName(name: string, suffix: string): string {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}${suffix}${ext}`;
}
