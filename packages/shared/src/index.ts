import { z } from "zod";

// ---------- Enums ----------
export const UserRole = { USER: "USER", ADMIN: "ADMIN" } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const JobType = { COMPRESS: "compress", CONVERT: "convert" } as const;
export type JobType = (typeof JobType)[keyof typeof JobType];

export const JobStatus = {
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const AgentMessageStatus = {
  PENDING: "pending",
  APPLIED: "applied",
  REJECTED: "rejected",
  NONE: "none",
} as const;
export type AgentMessageStatus = (typeof AgentMessageStatus)[keyof typeof AgentMessageStatus];

export const FileAuthor = { USER: "USER", AGENT: "AGENT" } as const;
export type FileAuthor = (typeof FileAuthor)[keyof typeof FileAuthor];

// ---------- DTOs ----------
export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  isBlocked: boolean;
  createdAt: string;
}

export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FileDto {
  id: string;
  name: string;
  folderId: string | null;
  ownerId: string;
  mimeType: string;
  sizeBytes: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastAuthor: FileAuthor;
}

export interface FileVersionDto {
  id: string;
  fileId: string;
  sizeBytes: number;
  authoredBy: FileAuthor;
  createdAt: string;
  note: string | null;
}

export interface JobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  createdAt: string;
  resultJson: string | null;
  errorMessage: string | null;
}

export interface AgentMessageDto {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  proposedDiff: AgentDiff | null;
  status: AgentMessageStatus;
  createdAt: string;
}

export interface AgentDiff {
  summary: string;
  before: string;
  after: string;
  targetFileId: string;
  targetFileName: string;
}

export interface AuditLogDto {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  meta: string | null;
  createdAt: string;
}

// ---------- Request schemas (zod, shared client/server validation) ----------
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.string().nullable().optional(),
});

export const renameSchema = z.object({
  name: z.string().min(1).max(255),
});

export const moveSchema = z.object({
  folderId: z.string().nullable(),
});

export const compressRequestSchema = z.object({
  fileIds: z.array(z.string()).min(1),
  targetValue: z.number().positive(),
  targetUnit: z.enum(["MB", "KB", "PERCENT"]),
  asNewFile: z.boolean().optional(),
});
export type CompressRequestInput = z.infer<typeof compressRequestSchema>;

export const convertRequestSchema = z.object({
  fileIds: z.array(z.string()).min(1),
  targetFormat: z.string().min(1),
});
export type ConvertRequestInput = z.infer<typeof convertRequestSchema>;

export const agentMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});
export type AgentMessageInput = z.infer<typeof agentMessageSchema>;

// Format conversion matrix: category -> supported target formats.
// Every pair that touches PDF (as source or target) requires LibreOffice on
// the server (auto-detected; disabled with a clear message if absent).
// PDF->docx and PDF->image are real (Writer's PDF-import filter, and Draw's
// native page export, respectively) — PDF->pptx/xlsx are deliberately not
// offered: LibreOffice opens a PDF as a fixed drawing with no import path
// into Calc or Impress, so there's no reliable way to reconstruct a slide
// deck or spreadsheet from one this way.
export const CONVERSION_MATRIX: Record<string, string[]> = {
  image: ["jpg", "png", "webp", "avif", "tiff", "pdf"],
  audio: ["mp3", "wav", "aac", "ogg"],
  video: ["mp4", "webm"],
  spreadsheet: ["xlsx", "csv", "pdf"],
  document: ["pdf"],
  presentation: ["pdf"],
  pdf: ["docx", "jpg", "png"],
  archive: ["zip"],
};

export function categoryForMime(mime: string): string | null {
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "text/csv"
  )
    return "spreadsheet";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "document";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "presentation";
  if (mime === "application/zip") return "archive";
  return null;
}
