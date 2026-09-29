import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middleware/requireAuth.js";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { writeAudit } from "../../lib/audit.js";
import * as adminService from "./admin.service.js";
import * as settingsService from "./settings.service.js";
import { CONVERSION_MATRIX } from "@filehub/shared";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    res.json({ users: await adminService.listUsers() });
  }),
);

adminRouter.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const user = await adminService.updateUser(req.params.id, req.body);
    await writeAudit({ userId: req.user!.id, action: "admin.user_update", targetType: "User", targetId: req.params.id, meta: req.body });
    res.json(user);
  }),
);

adminRouter.get(
  "/audit-log",
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    res.json({ entries: await adminService.getAuditLog(limit) });
  }),
);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    res.json(await adminService.getStats());
  }),
);

adminRouter.get(
  "/conversion-settings",
  asyncHandler(async (_req, res) => {
    res.json({ fullMatrix: CONVERSION_MATRIX, disabled: await settingsService.getDisabledConversions() });
  }),
);

adminRouter.put(
  "/conversion-settings",
  asyncHandler(async (req, res) => {
    const disabled = (req.body.disabled as string[]) ?? [];
    await settingsService.setDisabledConversions(disabled);
    await writeAudit({ userId: req.user!.id, action: "admin.conversion_settings_update", targetType: "Settings", meta: { disabled } });
    res.status(204).end();
  }),
);
