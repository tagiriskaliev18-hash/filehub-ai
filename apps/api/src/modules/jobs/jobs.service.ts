import { prisma } from "../../prisma.js";
import { HttpError } from "../../lib/asyncHandler.js";
import type { JobType } from "@filehub/shared";

export async function createJob(createdById: string, type: JobType, payload: unknown) {
  return prisma.job.create({
    data: { type, payloadJson: JSON.stringify(payload), createdById },
  });
}

export async function getOwnedJob(jobId: string, ownerId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job || job.createdById !== ownerId) throw new HttpError(404, "Задача не найдена");
  return job;
}

// Internal use by the worker loop only — no ownership check (the worker
// processes any user's queued job).
export async function getOwnedJobUnsafe(jobId: string) {
  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

export function listRecentJobs(ownerId: string) {
  return prisma.job.findMany({ where: { createdById: ownerId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function claimNextQueuedJob() {
  const job = await prisma.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
  if (!job) return null;
  return prisma.job.update({ where: { id: job.id }, data: { status: "running" } });
}

export async function updateJobProgress(jobId: string, progress: number) {
  await prisma.job.update({ where: { id: jobId }, data: { progress } });
}

export async function completeJob(jobId: string, resultJson: unknown) {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: "done", progress: 100, resultJson: JSON.stringify(resultJson) },
  });
}

export async function failJob(jobId: string, message: string) {
  await prisma.job.update({ where: { id: jobId }, data: { status: "failed", errorMessage: message } });
}
