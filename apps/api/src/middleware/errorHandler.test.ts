import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { loginSchema } from "@filehub/shared";
import { asyncHandler, HttpError } from "../lib/asyncHandler.js";
import { errorHandler } from "./errorHandler.js";

function mockRes() {
  return {
    statusCode: 0,
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
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("HttpError and asyncHandler", () => {
  it("carries an HTTP status", () => {
    const err = new HttpError(409, "conflict");
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
    expect(err.message).toBe("conflict");
  });

  it("forwards a rejected handler to next and ignores a resolved one", async () => {
    const err = new HttpError(404, "missing");
    const next = vi.fn();
    asyncHandler(async () => {
      throw err;
    })({} as Request, {} as Response, next as NextFunction);
    await flush();
    expect(next).toHaveBeenCalledWith(err);

    const okNext = vi.fn();
    const handler = vi.fn(async () => "ok");
    asyncHandler(handler)({} as Request, {} as Response, okNext as NextFunction);
    await flush();
    expect(handler).toHaveBeenCalledOnce();
    expect(okNext).not.toHaveBeenCalled();
  });
});

describe("errorHandler", () => {
  it("maps HttpError and ZodError and hides unexpected failures", () => {
    const httpRes = mockRes();
    errorHandler(new HttpError(403, "нет прав"), {} as Request, httpRes as unknown as Response, vi.fn());
    expect(httpRes.statusCode).toBe(403);
    expect(httpRes.body).toEqual({ error: "нет прав" });

    let zodError: unknown;
    try {
      loginSchema.parse({ email: "nope", password: "" });
    } catch (err) {
      zodError = err;
    }
    const zodRes = mockRes();
    errorHandler(zodError, {} as Request, zodRes as unknown as Response, vi.fn());
    expect(zodRes.statusCode).toBe(400);
    expect(zodRes.body).toMatchObject({ error: "Некорректные данные запроса" });
    expect((zodRes.body as { details: unknown[] }).details.length).toBeGreaterThan(0);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const generic = mockRes();
    errorHandler(new Error("disk full"), {} as Request, generic as unknown as Response, vi.fn());
    expect(generic.statusCode).toBe(500);
    expect(generic.body).toEqual({ error: "Внутренняя ошибка сервера" });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
