import path from "node:path";
import type { CompressRequestInput } from "@filehub/shared";

export type CompressCategory = "image" | "video" | "audio" | "pdf" | "office" | "archive" | "unsupported";

const OFFICE_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function categorize(mime: string): CompressCategory {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (OFFICE_MIMES.has(mime)) return "office";
  if (mime === "application/zip") return "archive";
  return "unsupported";
}

export function resolveTargetBytes(unit: CompressRequestInput["targetUnit"], value: number, originalBytes: number): number {
  if (unit === "MB") return Math.round(value * 1024 * 1024);
  if (unit === "KB") return Math.round(value * 1024);
  return Math.round(originalBytes * (value / 100));
}

export function extOf(name: string): string {
  return path.extname(name).replace(".", "").toLowerCase();
}

export function stripExt(name: string): string {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

export function suffixName(name: string, suffix: string): string {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  return `${base}${suffix}${ext}`;
}
