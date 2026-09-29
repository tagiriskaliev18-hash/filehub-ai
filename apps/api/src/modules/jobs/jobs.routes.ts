import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import * as jobsService from "./jobs.service.js";
import { toJobDto } from "./dto.js";

export const jobsRouter = Router();
jobsRouter.use(requireAuth);

jobsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const jobs = await jobsService.listRecentJobs(req.user!.id);
    res.json({ jobs: jobs.map(toJobDto) });
  }),
);

jobsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const job = await jobsService.getOwnedJob(req.params.id, req.user!.id);
    res.json(toJobDto(job));
  }),
);
