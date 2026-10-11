import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("../prisma.js", () => ({
  prisma: { user: { findUnique } },
  sqliteReady: Promise.resolve(),
}));

import { env } from "../env.js";
import { HttpError } from "../lib/asyncHandler.js";
import { issueToken } from "../modules/auth/auth.service.js";
import { requireAdmin, requireAuth } from "./requireAuth.js";

function reqWith(token?: string): Request {
  return { cookies: token ? { [env.sessionCookieName]: token } : {} } as Request;
}

async function run(req: Request) {
  const next = vi.fn();
  await requireAuth(req, {} as Response, next as NextFunction);
  return next;
}

describe("requireAuth", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("rejects a missing cookie", async () => {
    const next = await run(reqWith());
    const err = next.mock.calls[0][0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("Требуется вход в систему");
  });

  it("attaches the current user for a valid session", async () => {
    const user = { id: "user-1", role: "USER", isBlocked: false };
    findUnique.mockResolvedValue(user);
    const req = reqWith(issueToken({ sub: "user-1", role: "USER" }));
    const next = await run(req);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "user-1" } });
    expect(req.user).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects an unknown user, a blocked user, and a bad token", async () => {
    findUnique.mockResolvedValue(null);
    const missing = await run(reqWith(issueToken({ sub: "gone", role: "USER" })));
    expect((missing.mock.calls[0][0] as HttpError).status).toBe(401);

    findUnique.mockResolvedValue({ id: "user-1", role: "USER", isBlocked: true });
    const blocked = await run(reqWith(issueToken({ sub: "user-1", role: "USER" })));
    const blockedErr = blocked.mock.calls[0][0] as HttpError;
    expect(blockedErr.status).toBe(403);
    expect(blockedErr.message).toBe("Доступ заблокирован администратором");

    const bad = await run(reqWith("not-a-jwt"));
    const badErr = bad.mock.calls[0][0] as HttpError;
    expect(badErr.status).toBe(401);
    expect(badErr.message).toBe("Сессия истекла, войдите снова");
  });
});

describe("requireAdmin", () => {
  it("allows only an authenticated admin", () => {
    const next = vi.fn();
    requireAdmin({ user: { role: "ADMIN" } } as Request, {} as Response, next as NextFunction);
    expect(next).toHaveBeenCalledWith();

    const denied = vi.fn();
    requireAdmin({ user: { role: "USER" } } as Request, {} as Response, denied as NextFunction);
    expect((denied.mock.calls[0][0] as HttpError).status).toBe(403);
    expect((denied.mock.calls[0][0] as HttpError).message).toBe("Требуются права администратора");

    const anonymous = vi.fn();
    requireAdmin({} as Request, {} as Response, anonymous as NextFunction);
    expect((anonymous.mock.calls[0][0] as HttpError).status).toBe(403);
  });
});
