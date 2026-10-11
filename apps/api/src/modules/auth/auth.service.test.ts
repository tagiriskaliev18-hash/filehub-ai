import { describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../../prisma.js", () => ({
  prisma: {},
  sqliteReady: Promise.resolve(),
}));

import { issueToken, SESSION_MAX_AGE_MS, verifyToken } from "./auth.service.js";

describe("session tokens", () => {
  it("round-trips the subject and role and expires after 12 hours", () => {
    const token = issueToken({ sub: "user-1", role: "ADMIN" });
    expect(verifyToken(token)).toMatchObject({ sub: "user-1", role: "ADMIN" });

    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp - decoded.iat).toBe(60 * 60 * 12);
    expect(SESSION_MAX_AGE_MS).toBe(60 * 60 * 12 * 1000);
  });

  it("rejects a token signed with another secret or a damaged signature", () => {
    const foreign = jwt.sign({ sub: "user-1", role: "ADMIN" }, "some-other-secret");
    expect(() => verifyToken(foreign)).toThrow();

    const token = issueToken({ sub: "user-1", role: "USER" });
    const [header, payload, signature] = token.split(".");
    const flipped = signature.endsWith("a") ? "b" : "a";
    expect(() => verifyToken(`${header}.${payload}.${signature.slice(0, -1)}${flipped}`)).toThrow();
  });
});
