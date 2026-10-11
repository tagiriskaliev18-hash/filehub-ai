import type { File, FileVersion, Folder } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toFileDto, toFileVersionDto, toFolderDto } from "./dto.js";

describe("file DTOs", () => {
  it("serialises dates and leaves a live file's deletedAt null", () => {
    const dto = toFileDto({
      id: "file-1",
      name: "a.docx",
      folderId: null,
      ownerId: "user-1",
      mimeType: "application/pdf",
      sizeBytes: 12,
      deletedAt: null,
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-02T03:04:05.000Z"),
      lastAuthor: "AGENT",
    } as File);
    expect(dto.deletedAt).toBeNull();
    expect(dto.createdAt).toBe("2026-04-01T00:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-04-02T03:04:05.000Z");
    expect(dto.lastAuthor).toBe("AGENT");

    const trashed = toFileDto({
      ...dto,
      deletedAt: new Date("2026-05-01T00:00:00.000Z"),
      createdAt: new Date(dto.createdAt),
      updatedAt: new Date(dto.updatedAt),
    } as unknown as File);
    expect(trashed.deletedAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("maps folders and versions", () => {
    expect(toFolderDto({ id: "folder-1", name: "Docs", parentId: null } as Folder)).toEqual({
      id: "folder-1",
      name: "Docs",
      parentId: null,
    });
    expect(
      toFileVersionDto({
        id: "ver-1",
        fileId: "file-1",
        sizeBytes: 4,
        authoredBy: "USER",
        createdAt: new Date("2026-04-03T00:00:00.000Z"),
        note: null,
      } as FileVersion),
    ).toEqual({
      id: "ver-1",
      fileId: "file-1",
      sizeBytes: 4,
      authoredBy: "USER",
      createdAt: "2026-04-03T00:00:00.000Z",
      note: null,
    });
  });
});
