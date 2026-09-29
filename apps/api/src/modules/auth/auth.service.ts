import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { HttpError } from "../../lib/asyncHandler.js";

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12h idle session, per ТЗ §6.5 auto-logout requirement

export interface SessionPayload {
  sub: string;
  // Authorization always re-reads the current role from the DB (see
  // requireAuth/requireAdmin) — this is carried for convenience/debugging
  // only, never trusted for access decisions, so it stays a plain string.
  role: string;
}

export async function registerUser(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new HttpError(409, "Пользователь с таким email уже существует");

  const passwordHash = await bcrypt.hash(password, 12);
  const isFirstUser = (await prisma.user.count()) === 0;
  const user = await prisma.user.create({
    data: { email, passwordHash, role: isFirstUser ? "ADMIN" : "USER" },
  });
  return user;
}

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(401, "Неверный email или пароль");
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, "Неверный email или пароль");
  return user;
}

export function issueToken(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
}

export function verifyToken(token: string): SessionPayload {
  return jwt.verify(token, env.jwtSecret) as SessionPayload;
}

export const SESSION_MAX_AGE_MS = TOKEN_TTL_SECONDS * 1000;
