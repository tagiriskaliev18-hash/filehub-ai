import { nanoid } from "nanoid";
import { prisma } from "../../prisma.js";
import { storage, newStorageKey } from "../storage/storage.adapter.js";
import { HttpError } from "../../lib/asyncHandler.js";
import type { FileAuthor } from "@filehub/shared";
import type { FileVersion } from "@prisma/client";

export async function getOwnedFile(fileId: string, ownerId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== ownerId) throw new HttpError(404, "Файл не найден");
  return file;
}

export async function getOwnedFolder(folderId: string, ownerId: string) {
  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder || folder.ownerId !== ownerId) throw new HttpError(404, "Папка не найдена");
  return folder;
}

export async function listFolderContents(ownerId: string, folderId: string | null) {
  const [folders, files] = await Promise.all([
    prisma.folder.findMany({ where: { ownerId, parentId: folderId }, orderBy: { name: "asc" } }),
    prisma.file.findMany({
      where: { ownerId, folderId, deletedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);
  return { folders, files };
}

// Flat listing across all folders — used by the AI-agent page's file picker,
// which doesn't care about folder structure, just "which file do I chat about".
export async function listAllFiles(ownerId: string) {
  return prisma.file.findMany({
    where: { ownerId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
}

export async function listTrash(ownerId: string) {
  return prisma.file.findMany({ where: { ownerId, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } });
}

export async function searchFiles(ownerId: string, query: string) {
  return prisma.file.findMany({
    where: { ownerId, deletedAt: null, name: { contains: query } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
}

export async function createFolder(ownerId: string, name: string, parentId: string | null) {
  if (parentId) await getOwnedFolder(parentId, ownerId);
  return prisma.folder.create({ data: { name, parentId, ownerId } });
}

export async function renameFolder(ownerId: string, folderId: string, name: string) {
  await getOwnedFolder(folderId, ownerId);
  return prisma.folder.update({ where: { id: folderId }, data: { name } });
}

export async function deleteFolder(ownerId: string, folderId: string) {
  await getOwnedFolder(folderId, ownerId);
  const [subfolders, subfiles] = await Promise.all([
    prisma.folder.count({ where: { parentId: folderId } }),
    prisma.file.count({ where: { folderId, deletedAt: null } }),
  ]);
  if (subfolders > 0 || subfiles > 0) {
    throw new HttpError(400, "Папка не пуста. Переместите или удалите содержимое сначала.");
  }
  await prisma.folder.delete({ where: { id: folderId } });
}

interface UploadInput {
  ownerId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  data: Buffer;
}

async function assertQuota(ownerId: string, addBytes: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
  const used = await prisma.file.aggregate({
    where: { ownerId, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  const currentUsed = used._sum.sizeBytes ?? 0;
  if (currentUsed + addBytes > Number(user.storageQuotaBytes)) {
    throw new HttpError(413, "Превышена квота хранилища. Обратитесь к администратору.");
  }
}

export async function uploadFile(input: UploadInput) {
  if (input.folderId) await getOwnedFolder(input.folderId, input.ownerId);
  await assertQuota(input.ownerId, input.data.length);

  const fileId = nanoid();
  const key = newStorageKey(input.ownerId, fileId, "v1");
  await storage.put(key, input.data);

  const file = await prisma.file.create({
    data: {
      id: fileId,
      name: input.originalName,
      folderId: input.folderId,
      ownerId: input.ownerId,
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      storageKey: key,
      lastAuthor: "USER",
    },
  });

  await prisma.fileVersion.create({
    data: { fileId: file.id, storageKey: key, sizeBytes: input.data.length, authoredBy: "USER" },
  });

  return file;
}

export async function renameFile(ownerId: string, fileId: string, name: string) {
  await getOwnedFile(fileId, ownerId);
  return prisma.file.update({ where: { id: fileId }, data: { name } });
}

export async function moveFile(ownerId: string, fileId: string, folderId: string | null) {
  await getOwnedFile(fileId, ownerId);
  if (folderId) await getOwnedFolder(folderId, ownerId);
  return prisma.file.update({ where: { id: fileId }, data: { folderId } });
}

export async function softDeleteFile(ownerId: string, fileId: string) {
  await getOwnedFile(fileId, ownerId);
  return prisma.file.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
}

export async function restoreFile(ownerId: string, fileId: string) {
  await getOwnedFile(fileId, ownerId);
  return prisma.file.update({ where: { id: fileId }, data: { deletedAt: null } });
}

export async function hardDeleteFile(ownerId: string, fileId: string) {
  const file = await getOwnedFile(fileId, ownerId);
  const versions = await prisma.fileVersion.findMany({ where: { fileId } });
  await Promise.all(versions.map((v: FileVersion) => storage.delete(v.storageKey)));
  await prisma.file.delete({ where: { id: fileId } });
  return file;
}

export async function emptyTrash(ownerId: string) {
  const files = await listTrash(ownerId);
  for (const file of files) {
    await hardDeleteFile(ownerId, file.id);
  }
  return files.length;
}

export async function listVersions(ownerId: string, fileId: string) {
  await getOwnedFile(fileId, ownerId);
  return prisma.fileVersion.findMany({ where: { fileId }, orderBy: { createdAt: "desc" } });
}

// Shared by upload, compression, conversion, and the AI agent — every module
// that mutates file bytes goes through this so versioning + lastAuthor stay consistent.
export async function createNewVersion(params: {
  fileId: string;
  data: Buffer;
  authoredBy: FileAuthor;
  note?: string;
  newMimeType?: string;
  newName?: string;
}) {
  const file = await prisma.file.findUniqueOrThrow({ where: { id: params.fileId } });
  const versionCount = await prisma.fileVersion.count({ where: { fileId: file.id } });
  const key = newStorageKey(file.ownerId, file.id, `v${versionCount + 1}`);
  await storage.put(key, params.data);

  await prisma.fileVersion.create({
    data: {
      fileId: file.id,
      storageKey: key,
      sizeBytes: params.data.length,
      authoredBy: params.authoredBy,
      note: params.note,
    },
  });

  return prisma.file.update({
    where: { id: file.id },
    data: {
      storageKey: key,
      sizeBytes: params.data.length,
      lastAuthor: params.authoredBy,
      mimeType: params.newMimeType ?? file.mimeType,
      name: params.newName ?? file.name,
    },
  });
}

export async function restoreVersion(ownerId: string, fileId: string, versionId: string) {
  const file = await getOwnedFile(fileId, ownerId);
  const version = await prisma.fileVersion.findUnique({ where: { id: versionId } });
  if (!version || version.fileId !== file.id) throw new HttpError(404, "Версия не найдена");
  const data = await storage.get(version.storageKey);
  return createNewVersion({
    fileId: file.id,
    data,
    authoredBy: version.authoredBy as FileAuthor,
    note: `Восстановлено из версии от ${version.createdAt.toISOString()}`,
  });
}

// One-click "undo the last change" — used right after an action (AI edit,
// in-place compression) completes, so reverting doesn't require opening the
// version history panel and picking a version manually.
export async function undoLastChange(ownerId: string, fileId: string) {
  await getOwnedFile(fileId, ownerId);
  const versions = await prisma.fileVersion.findMany({ where: { fileId }, orderBy: { createdAt: "desc" }, take: 2 });
  if (versions.length < 2) throw new HttpError(400, "Нет предыдущей версии для отмены");
  return restoreVersion(ownerId, fileId, versions[1].id);
}
