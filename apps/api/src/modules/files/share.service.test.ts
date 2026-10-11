import type { ShareLink } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../../prisma.js", () => ({
  prisma: { shareLink: db },
  sqliteReady: Promise.resolve(),
}));

import { HttpError } from "../../lib/asyncHandler.js";
import { createShare, resolveShare, toShareDto } from "./share.service.js";

function shareRow(overrides: Record<string, unknown> = {}) {
  return {
    token: "tok",
    expiresAt: null,
    allowAnyInOrg: false,
    sharedWithUserIds: JSON.stringify(["user-a"]),
    file: { deletedAt: null },
    ...overrides,
  };
}

describe("resolveShare", () => {
  beforeEach(() => {
    db.findUnique.mockReset();
  });

  it("rejects a missing, expired, deleted, or unauthorized link", async () => {
    db.findUnique.mockResolvedValue(null);
    await expect(resolveShare("missing", "user-a")).rejects.toMatchObject({
      status: 404,
      message: "Ссылка недействительна",
    });

    db.findUnique.mockResolvedValue(shareRow({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(resolveShare("tok", "user-a")).rejects.toMatchObject({
      status: 410,
      message: "Срок действия ссылки истёк",
    });

    db.findUnique.mockResolvedValue(shareRow({ file: { deletedAt: new Date() } }));
    await expect(resolveShare("tok", "user-a")).rejects.toMatchObject({ status: 404, message: "Файл удалён" });

    db.findUnique.mockResolvedValue(shareRow());
    await expect(resolveShare("tok", null)).rejects.toBeInstanceOf(HttpError);
    await expect(resolveShare("tok", "someone-else")).rejects.toMatchObject({ status: 403 });
  });

  it("allows the listed user, and anyone in the org when the link says so", async () => {
    db.findUnique.mockResolvedValue(shareRow());
    await expect(resolveShare("tok", "user-a")).resolves.toMatchObject({ token: "tok" });

    db.findUnique.mockResolvedValue(shareRow({ allowAnyInOrg: true, sharedWithUserIds: null }));
    await expect(resolveShare("tok", null)).resolves.toMatchObject({ allowAnyInOrg: true });
  });
});

describe("createShare", () => {
  it("stores a 24-char token, the recipient list, and an expiry when asked", async () => {
    db.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
    const before = Date.now();
    await createShare({
      fileId: "file-1",
      createdById: "owner",
      allowAnyInOrg: false,
      userIds: ["user-a"],
      expiresInDays: 2,
    });
    const data = db.create.mock.calls[0][0].data;
    expect(data.token).toHaveLength(24);
    expect(data.sharedWithUserIds).toBe(JSON.stringify(["user-a"]));
    expect(data.expiresAt).toBeInstanceOf(Date);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 24 * 60 * 60 * 1000 - 50);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 2 * 24 * 60 * 60 * 1000 + 50);

    await createShare({ fileId: "file-1", createdById: "owner", allowAnyInOrg: true });
    const open = db.create.mock.calls[1][0].data;
    expect(open.expiresAt).toBeNull();
    expect(open.sharedWithUserIds).toBeNull();
  });
});

describe("toShareDto", () => {
  it("parses recipients and serialises dates", () => {
    const dto = toShareDto({
      id: "share-1",
      token: "tok",
      allowAnyInOrg: false,
      sharedWithUserIds: JSON.stringify(["user-a", "user-b"]),
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    } as ShareLink);
    expect(dto).toEqual({
      id: "share-1",
      token: "tok",
      allowAnyInOrg: false,
      sharedWithUserIds: ["user-a", "user-b"],
      expiresAt: "2026-06-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const open = toShareDto({
      id: "share-2",
      token: "tok2",
      allowAnyInOrg: true,
      sharedWithUserIds: null,
      expiresAt: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    } as ShareLink);
    expect(open.sharedWithUserIds).toEqual([]);
    expect(open.expiresAt).toBeNull();
  });
});
