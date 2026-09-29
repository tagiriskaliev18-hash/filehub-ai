import type { Job } from "@prisma/client";
import type { JobDto, JobStatus, JobType } from "@filehub/shared";

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    type: job.type as JobType,
    status: job.status as JobStatus,
    progress: job.progress,
    createdAt: job.createdAt.toISOString(),
    resultJson: job.resultJson,
    errorMessage: job.errorMessage,
  };
}
