import { Router } from "express";
import { aiEnabled } from "../env.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({ ok: true, aiEnabled });
});
