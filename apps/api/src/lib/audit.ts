import { prisma } from "../prisma.js";

export async function writeAudit(params: {
  userId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      meta: params.meta ? JSON.stringify(params.meta) : null,
    },
  });
}
