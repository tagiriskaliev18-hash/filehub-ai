import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const TRACKED = ["NODE_ENV", "JWT_SECRET", "ALLOWED_CIDRS"] as const;
const snapshot: Record<string, string | undefined> = {};
for (const key of TRACKED) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of TRACKED) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  vi.resetModules();
});

async function loadAllowlist(cidrs: string) {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  delete process.env.JWT_SECRET;
  process.env.ALLOWED_CIDRS = cidrs;
  const mod = await import("./cidrAllowlist.js");
  return mod.cidrAllowlist;
}

function run(middleware: (req: Request, res: Response, next: NextFunction) => void, ip: string | undefined) {
  const req = { ip } as Request;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  middleware(req, res as unknown as Response, next);
  return { res, next };
}

describe("cidrAllowlist", () => {
  it("allows every address when no ranges are configured", async () => {
    const middleware = await loadAllowlist("");
    const { next, res } = run(middleware, undefined);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("matches IPv4 ranges, mapped IPv6, and /0, and rejects everyone else", async () => {
    const middleware = await loadAllowlist("10.0.0.0/8, 192.168.1.0/24");

    expect(run(middleware, "10.1.2.3").next).toHaveBeenCalledOnce();
    expect(run(middleware, "::ffff:192.168.1.50").next).toHaveBeenCalledOnce();
    expect(run(middleware, "192.168.1.255").next).toHaveBeenCalledOnce();

    const denied = run(middleware, "11.0.0.1");
    expect(denied.next).not.toHaveBeenCalled();
    expect(denied.res.statusCode).toBe(403);
    expect(denied.res.body).toEqual({
      error: "Доступ разрешён только с устройств корпоративной сети организации.",
    });

    expect(run(middleware, "192.168.2.1").next).not.toHaveBeenCalled();
    expect(run(middleware, undefined).res.statusCode).toBe(403);
    expect(run(middleware, "::1").res.statusCode).toBe(403);
    expect(run(middleware, "not-an-ip").res.statusCode).toBe(403);

    const open = await loadAllowlist("0.0.0.0/0");
    expect(run(open, "8.8.8.8").next).toHaveBeenCalledOnce();
    expect(run(open, "not-an-ip").res.statusCode).toBe(403);

    const exact = await loadAllowlist("10.0.0.5");
    expect(run(exact, "10.0.0.5").next).toHaveBeenCalledOnce();
    expect(run(exact, "10.0.0.6").res.statusCode).toBe(403);
  });
});
