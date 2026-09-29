import { Router } from "express";
import { registerSchema, loginSchema } from "@filehub/shared";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { registerUser, verifyCredentials, issueToken, SESSION_MAX_AGE_MS } from "./auth.service.js";
import { env } from "../../env.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { toUserDto } from "../users/users.service.js";
import { writeAudit } from "../../lib/audit.js";

export const authRouter = Router();

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(env.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !env.isDev,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await registerUser(input.email, input.password);
    const token = issueToken({ sub: user.id, role: user.role });
    setSessionCookie(res, token);
    await writeAudit({ userId: user.id, action: "user.register", targetType: "User", targetId: user.id });
    res.status(201).json(await toUserDto(user));
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await verifyCredentials(input.email, input.password);
    const token = issueToken({ sub: user.id, role: user.role });
    setSessionCookie(res, token);
    await writeAudit({ userId: user.id, action: "user.login", targetType: "User", targetId: user.id });
    res.json(await toUserDto(user));
  }),
);

authRouter.post("/logout", (req, res) => {
  res.clearCookie(env.sessionCookieName);
  res.status(204).end();
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await toUserDto(req.user!));
  }),
);
