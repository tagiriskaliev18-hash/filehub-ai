import { prisma } from "../../prisma.js";
import { HttpError } from "../../lib/asyncHandler.js";
import { toUserDto } from "../users/users.service.js";

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(users.map(toUserDto));
}

export async function updateUser(
  userId: string,
  patch: { role?: "USER" | "ADMIN"; storageQuotaBytes?: number; aiRequestQuota?: number; isBlocked?: boolean },
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "Пользователь не найден");
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      role: patch.role,
      storageQuotaBytes: patch.storageQuotaBytes !== undefined ? BigInt(patch.storageQuotaBytes) : undefined,
      aiRequestQuota: patch.aiRequestQuota,
      isBlocked: patch.isBlocked,
    },
  });
  return toUserDto(updated);
}

export async function getAuditLog(limit = 100) {
  const rows = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: true },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.user?.email ?? null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    meta: r.meta,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getStats() {
  const [userCount, fileAgg, jobCounts] = await Promise.all([
    prisma.user.count(),
    prisma.file.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true }, _count: true }),
    prisma.job.groupBy({ by: ["type", "status"], _count: true }),
  ]);
  return {
    userCount,
    fileCount: fileAgg._count,
    totalStorageBytes: fileAgg._sum.sizeBytes ?? 0,
    jobCounts: jobCounts.map((j) => ({ type: j.type, status: j.status, count: j._count })),
  };
}
