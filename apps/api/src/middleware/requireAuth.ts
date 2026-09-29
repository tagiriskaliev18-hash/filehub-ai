import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";
import { verifyToken } from "../modules/auth/auth.service.js";
import { prisma } from "../prisma.js";
import { HttpError } from "../lib/asyncHandler.js";
import type { User } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[env.sessionCookieName];
    if (!token) throw new HttpError(401, "Требуется вход в систему");
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new HttpError(401, "Требуется вход в систему");
    if (user.isBlocked) throw new HttpError(403, "Доступ заблокирован администратором");
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, "Сессия истекла, войдите снова"));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return next(new HttpError(403, "Требуются права администратора"));
  }
  next();
}
