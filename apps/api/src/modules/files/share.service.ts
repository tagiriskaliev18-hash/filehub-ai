import { nanoid } from "nanoid";
import { prisma } from "../../prisma.js";
import { HttpError } from "../../lib/asyncHandler.js";
import type { ShareLink } from "@prisma/client";

export async function createShare(params: {
  fileId: string;
  createdById: string;
  allowAnyInOrg: boolean;
  userIds?: string[];
  expiresInDays?: number;
}) {
  return prisma.shareLink.create({
    data: {
      fileId: params.fileId,
      token: nanoid(24),
      allowAnyInOrg: params.allowAnyInOrg,
      sharedWithUserIds: params.userIds ? JSON.stringify(params.userIds) : null,
      createdById: params.createdById,
      expiresAt: params.expiresInDays
        ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
  });
}

export function listShares(fileId: string) {
  return prisma.shareLink.findMany({ where: { fileId }, orderBy: { createdAt: "desc" } });
}

export async function deleteShare(shareId: string) {
  await prisma.shareLink.delete({ where: { id: shareId } });
}

export async function resolveShare(token: string, requestingUserId: string | null) {
  const share = await prisma.shareLink.findUnique({ where: { token }, include: { file: true } });
  if (!share) throw new HttpError(404, "Ссылка недействительна");
  if (share.expiresAt && share.expiresAt < new Date()) throw new HttpError(410, "Срок действия ссылки истёк");
  if (!share.allowAnyInOrg) {
    const allowedIds: string[] = share.sharedWithUserIds ? JSON.parse(share.sharedWithUserIds) : [];
    if (!requestingUserId || !allowedIds.includes(requestingUserId)) {
      throw new HttpError(403, "У вас нет доступа к этому файлу по ссылке");
    }
  }
  if (share.file.deletedAt) throw new HttpError(404, "Файл удалён");
  return share;
}

export function toShareDto(share: ShareLink) {
  return {
    id: share.id,
    token: share.token,
    allowAnyInOrg: share.allowAnyInOrg,
    sharedWithUserIds: share.sharedWithUserIds ? (JSON.parse(share.sharedWithUserIds) as string[]) : [],
    expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
    createdAt: share.createdAt.toISOString(),
  };
}
