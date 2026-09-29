import { Router } from "express";
import { compressRequestSchema } from "@filehub/shared";
import { asyncHandler, HttpError } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getOwnedFile } from "../files/files.service.js";
import { createJob } from "../jobs/jobs.service.js";
import { toJobDto } from "../jobs/dto.js";
import { writeAudit } from "../../lib/audit.js";

export const compressionRouter = Router();
compressionRouter.use(requireAuth);

compressionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = compressRequestSchema.parse(req.body);
    for (const fileId of input.fileIds) {
      await getOwnedFile(fileId, req.user!.id); // throws 404 if not owned — validates before enqueueing
    }
    const job = await createJob(req.user!.id, "compress", input);
    await writeAudit({
      userId: req.user!.id,
      action: "compress.enqueue",
      targetType: "Job",
      targetId: job.id,
      meta: { fileIds: input.fileIds, targetValue: input.targetValue, targetUnit: input.targetUnit },
    });
    res.status(202).json(toJobDto(job));
  }),
);
