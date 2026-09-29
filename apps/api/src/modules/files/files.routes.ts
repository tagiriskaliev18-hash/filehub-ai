import { Router } from "express";
import multer from "multer";
import { createFolderSchema, renameSchema, moveSchema } from "@filehub/shared";
import { asyncHandler, HttpError } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { writeAudit } from "../../lib/audit.js";
import { storage } from "../storage/storage.adapter.js";
import { toFileDto, toFolderDto, toFileVersionDto } from "./dto.js";
import * as filesService from "./files.service.js";
import * as shareService from "./share.service.js";

export const filesRouter = Router();
filesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// multer/busboy decode multipart filename fields as Latin-1 regardless of the
// actual bytes sent, even though every modern browser sends non-ASCII
// filenames as UTF-8 — a long-standing busboy quirk, not a bug on the client
// side. Re-interpreting the mis-decoded string as raw Latin-1 bytes and
// re-decoding as UTF-8 recovers the original name (e.g. Cyrillic filenames).
export function fixUploadFilename(name: string): string {
  return Buffer.from(name, "latin1").toString("utf8");
}

filesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const folderId = (req.query.folderId as string) || null;
    const { folders, files } = await filesService.listFolderContents(req.user!.id, folderId);
    res.json({ folders: folders.map(toFolderDto), files: files.map(toFileDto) });
  }),
);

filesRouter.get(
  "/trash",
  asyncHandler(async (req, res) => {
    const files = await filesService.listTrash(req.user!.id);
    res.json({ files: files.map(toFileDto) });
  }),
);

// Must stay before `filesRouter.delete("/:id", ...)` below — otherwise
// Express would match "trash" as an :id and hit the single-file handler.
filesRouter.delete(
  "/trash",
  asyncHandler(async (req, res) => {
    const count = await filesService.emptyTrash(req.user!.id);
    await writeAudit({ userId: req.user!.id, action: "file.empty_trash", targetType: "File", meta: { count } });
    res.json({ deletedCount: count });
  }),
);

filesRouter.get(
  "/all",
  asyncHandler(async (req, res) => {
    const files = await filesService.listAllFiles(req.user!.id);
    res.json({ files: files.map(toFileDto) });
  }),
);

filesRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) ?? "";
    if (!q.trim()) return res.json({ files: [] });
    const files = await filesService.searchFiles(req.user!.id, q.trim());
    res.json({ files: files.map(toFileDto) });
  }),
);

filesRouter.post(
  "/folders",
  asyncHandler(async (req, res) => {
    const input = createFolderSchema.parse(req.body);
    const folder = await filesService.createFolder(req.user!.id, input.name, input.parentId ?? null);
    await writeAudit({ userId: req.user!.id, action: "folder.create", targetType: "Folder", targetId: folder.id });
    res.status(201).json(toFolderDto(folder));
  }),
);

filesRouter.patch(
  "/folders/:id",
  asyncHandler(async (req, res) => {
    const input = renameSchema.parse(req.body);
    const folder = await filesService.renameFolder(req.user!.id, req.params.id, input.name);
    await writeAudit({ userId: req.user!.id, action: "folder.rename", targetType: "Folder", targetId: folder.id });
    res.json(toFolderDto(folder));
  }),
);

filesRouter.delete(
  "/folders/:id",
  asyncHandler(async (req, res) => {
    await filesService.deleteFolder(req.user!.id, req.params.id);
    await writeAudit({ userId: req.user!.id, action: "folder.delete", targetType: "Folder", targetId: req.params.id });
    res.status(204).end();
  }),
);

filesRouter.post(
  "/upload",
  upload.array("files", 20),
  asyncHandler(async (req, res) => {
    const folderId = (req.body.folderId as string) || null;
    const uploaded = (req.files as Express.Multer.File[]) ?? [];
    if (uploaded.length === 0) throw new HttpError(400, "Файлы не переданы");

    const created = [];
    for (const f of uploaded) {
      const file = await filesService.uploadFile({
        ownerId: req.user!.id,
        folderId,
        originalName: fixUploadFilename(f.originalname),
        mimeType: f.mimetype || "application/octet-stream",
        data: f.buffer,
      });
      await writeAudit({
        userId: req.user!.id,
        action: "file.upload",
        targetType: "File",
        targetId: file.id,
        meta: { name: file.name, sizeBytes: file.sizeBytes },
      });
      created.push(toFileDto(file));
    }
    res.status(201).json({ files: created });
  }),
);

filesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const file = await filesService.getOwnedFile(req.params.id, req.user!.id);
    res.json(toFileDto(file));
  }),
);

filesRouter.get(
  "/:id/download",
  asyncHandler(async (req, res) => {
    const file = await filesService.getOwnedFile(req.params.id, req.user!.id);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    storage.getStream(file.storageKey).pipe(res);
    await writeAudit({ userId: req.user!.id, action: "file.download", targetType: "File", targetId: file.id });
  }),
);

filesRouter.get(
  "/:id/preview",
  asyncHandler(async (req, res) => {
    const file = await filesService.getOwnedFile(req.params.id, req.user!.id);
    res.setHeader("Content-Type", file.mimeType);
    storage.getStream(file.storageKey).pipe(res);
  }),
);

filesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = req.body as { name?: string; folderId?: string | null };
    let file = await filesService.getOwnedFile(req.params.id, req.user!.id);
    if (body.name !== undefined) {
      const input = renameSchema.parse({ name: body.name });
      file = await filesService.renameFile(req.user!.id, file.id, input.name);
      await writeAudit({ userId: req.user!.id, action: "file.rename", targetType: "File", targetId: file.id });
    }
    if (body.folderId !== undefined) {
      const input = moveSchema.parse({ folderId: body.folderId });
      file = await filesService.moveFile(req.user!.id, file.id, input.folderId);
      await writeAudit({ userId: req.user!.id, action: "file.move", targetType: "File", targetId: file.id });
    }
    res.json(toFileDto(file));
  }),
);

filesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const hard = req.query.hard === "true";
    if (hard) {
      await filesService.hardDeleteFile(req.user!.id, req.params.id);
      await writeAudit({ userId: req.user!.id, action: "file.delete_permanent", targetType: "File", targetId: req.params.id });
    } else {
      await filesService.softDeleteFile(req.user!.id, req.params.id);
      await writeAudit({ userId: req.user!.id, action: "file.trash", targetType: "File", targetId: req.params.id });
    }
    res.status(204).end();
  }),
);

filesRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const file = await filesService.restoreFile(req.user!.id, req.params.id);
    await writeAudit({ userId: req.user!.id, action: "file.restore", targetType: "File", targetId: file.id });
    res.json(toFileDto(file));
  }),
);

filesRouter.get(
  "/:id/shares",
  asyncHandler(async (req, res) => {
    await filesService.getOwnedFile(req.params.id, req.user!.id);
    const shares = await shareService.listShares(req.params.id);
    res.json({ shares: shares.map(shareService.toShareDto) });
  }),
);

filesRouter.post(
  "/:id/shares",
  asyncHandler(async (req, res) => {
    await filesService.getOwnedFile(req.params.id, req.user!.id);
    const body = req.body as { allowAnyInOrg?: boolean; userIds?: string[]; expiresInDays?: number };
    const share = await shareService.createShare({
      fileId: req.params.id,
      createdById: req.user!.id,
      allowAnyInOrg: body.allowAnyInOrg ?? true,
      userIds: body.userIds,
      expiresInDays: body.expiresInDays,
    });
    await writeAudit({ userId: req.user!.id, action: "file.share_create", targetType: "File", targetId: req.params.id });
    res.status(201).json(shareService.toShareDto(share));
  }),
);

filesRouter.delete(
  "/:id/shares/:shareId",
  asyncHandler(async (req, res) => {
    await filesService.getOwnedFile(req.params.id, req.user!.id);
    await shareService.deleteShare(req.params.shareId);
    await writeAudit({ userId: req.user!.id, action: "file.share_revoke", targetType: "File", targetId: req.params.id });
    res.status(204).end();
  }),
);

filesRouter.get(
  "/:id/versions",
  asyncHandler(async (req, res) => {
    const versions = await filesService.listVersions(req.user!.id, req.params.id);
    res.json({ versions: versions.map(toFileVersionDto) });
  }),
);

filesRouter.post(
  "/:id/versions/:versionId/restore",
  asyncHandler(async (req, res) => {
    const file = await filesService.restoreVersion(req.user!.id, req.params.id, req.params.versionId);
    await writeAudit({
      userId: req.user!.id,
      action: "file.version_restore",
      targetType: "File",
      targetId: file.id,
      meta: { versionId: req.params.versionId },
    });
    res.json(toFileDto(file));
  }),
);

filesRouter.post(
  "/:id/undo",
  asyncHandler(async (req, res) => {
    const file = await filesService.undoLastChange(req.user!.id, req.params.id);
    await writeAudit({ userId: req.user!.id, action: "file.undo", targetType: "File", targetId: file.id });
    res.json(toFileDto(file));
  }),
);
