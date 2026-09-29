import { prisma } from "../../prisma.js";
import type { User } from "@prisma/client";
import type { UserDto, UserRole } from "@filehub/shared";

export async function computeStorageUsed(userId: string): Promise<number> {
  const result = await prisma.file.aggregate({
    where: { ownerId: userId, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0;
}

export async function toUserDto(user: User): Promise<UserDto> {
  const used = await computeStorageUsed(user.id);
  return {
    id: user.id,
    email: user.email,
    role: user.role as UserRole,
    storageQuotaBytes: Number(user.storageQuotaBytes),
    storageUsedBytes: used,
    isBlocked: user.isBlocked,
    createdAt: user.createdAt.toISOString(),
  };
}
