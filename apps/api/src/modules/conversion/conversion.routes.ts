import { Router } from "express";
import { convertRequestSchema, categoryForMime } from "@filehub/shared";
import { asyncHandler, HttpError } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { getOwnedFile } from "../files/files.service.js";
import { createJob } from "../jobs/jobs.service.js";
import { toJobDto } from "../jobs/dto.js";
import { writeAudit } from "../../lib/audit.js";
import { detectLibreOffice } from "./libreoffice.js";
import { getEffectiveConversionMatrix } from "../admin/settings.service.js";

export const conversionRouter = Router();
conversionRouter.use(requireAuth);

conversionRouter.get(
  "/matrix",
  asyncHandler(async (_req, res) => {
    const libreOfficeAvailable = (await detectLibreOffice()) !== null;
    const matrix = await getEffectiveConversionMatrix();
    res.json({ matrix, libreOfficeAvailable });
  }),
);

conversionRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = convertRequestSchema.parse(req.body);
    const matrix = await getEffectiveConversionMatrix();
    const target = input.targetFormat.toLowerCase();
    for (const fileId of input.fileIds) {
      const file = await getOwnedFile(fileId, req.user!.id);
      const category = categoryForMime(file.mimeType);
      const allowed = category ? matrix[category] ?? [] : [];
      if (!allowed.includes(target)) {
        throw new HttpError(400, `Конвертация в "${input.targetFormat}" недоступна для файла "${file.name}"`);
      }
      // A category can list a format as a valid target for *other* formats
      // in that category (e.g. spreadsheet covers both xlsx and csv) without
      // that format being a real conversion for a file already in it —
      // converting a file to its own current format always fails downstream.
      const currentExt = file.name.split(".").pop()?.toLowerCase();
      if (currentExt === target) {
        throw new HttpError(400, `Файл "${file.name}" уже в формате "${input.targetFormat}"`);
      }
    }
    const job = await createJob(req.user!.id, "convert", input);
    await writeAudit({
      userId: req.user!.id,
      action: "convert.enqueue",
      targetType: "Job",
      targetId: job.id,
      meta: { fileIds: input.fileIds, targetFormat: input.targetFormat },
    });
    res.status(202).json(toJobDto(job));
  }),
);
