import { Router } from "express";
import { requireAuth } from "../../middleware/requireAuth.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { storage } from "../storage/storage.adapter.js";
import { resolveShare } from "./share.service.js";
import { toFileDto } from "./dto.js";
import { writeAudit } from "../../lib/audit.js";

// Mounted at /s — internal "share by link within the organization" (ТЗ §5.2, §6.5).
// Still gated by requireAuth (org SSO in production) and the global CIDR allowlist
// applied in app.ts, so the link alone is never enough to reach a file from outside.
export const shareRouter = Router();
shareRouter.use(requireAuth);

shareRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const share = await resolveShare(req.params.token, req.user!.id);
    res.json(toFileDto(share.file));
  }),
);

shareRouter.get(
  "/:token/download",
  asyncHandler(async (req, res) => {
    const share = await resolveShare(req.params.token, req.user!.id);
    res.setHeader("Content-Type", share.file.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(share.file.name)}`);
    storage.getStream(share.file.storageKey).pipe(res);
    await writeAudit({
      userId: req.user!.id,
      action: "file.share_download",
      targetType: "File",
      targetId: share.file.id,
    });
  }),
);
