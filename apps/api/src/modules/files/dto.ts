import type { File, FileVersion, Folder } from "@prisma/client";
import type { FileAuthor, FileDto, FileVersionDto, FolderDto } from "@filehub/shared";

export function toFileDto(file: File): FileDto {
  return {
    id: file.id,
    name: file.name,
    folderId: file.folderId,
    ownerId: file.ownerId,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    deletedAt: file.deletedAt ? file.deletedAt.toISOString() : null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    lastAuthor: file.lastAuthor as FileAuthor,
  };
}

export function toFolderDto(folder: Folder): FolderDto {
  return { id: folder.id, name: folder.name, parentId: folder.parentId };
}

export function toFileVersionDto(version: FileVersion): FileVersionDto {
  return {
    id: version.id,
    fileId: version.fileId,
    sizeBytes: version.sizeBytes,
    authoredBy: version.authoredBy as FileAuthor,
    createdAt: version.createdAt.toISOString(),
    note: version.note,
  };
}
