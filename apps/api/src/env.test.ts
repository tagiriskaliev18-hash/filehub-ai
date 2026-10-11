import { afterEach, describe, expect, it, vi } from "vitest";

const TRACKED = [
  "NODE_ENV",
  "JWT_SECRET",
  "PORT",
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "LOCALAI_BASE_URL",
  "LOCALAI_API_KEY",
  "LOCALAI_MODEL",
  "ALLOWED_CIDRS",
  "SESSION_COOKIE_NAME",
] as const;

const snapshot: Record<string, string | undefined> = {};
for (const key of TRACKED) snapshot[key] = process.env[key];

afterEach(() => {
  for (const key of TRACKED) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
  vi.resetModules();
});

async function loadEnv(overrides: Partial<Record<(typeof TRACKED)[number], string | undefined>>) {
  vi.resetModules();
  for (const key of TRACKED) {
    if (!(key in overrides)) continue;
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("./env.js");
}

describe("env", () => {
  it("uses the dev JWT fallback only outside production", async () => {
    const dev = await loadEnv({ NODE_ENV: "test", JWT_SECRET: undefined });
    expect(dev.env.jwtSecret).toBe("dev-only-insecure-secret-change-me");
    expect(dev.env.isDev).toBe(true);
    expect(dev.env.port).toBe(4000);
    expect(dev.env.sessionCookieName).toBe("fh_session");

    await expect(loadEnv({ NODE_ENV: "production", JWT_SECRET: undefined })).rejects.toThrow(/JWT_SECRET/);
    await expect(
      loadEnv({ NODE_ENV: "production", JWT_SECRET: "dev-only-insecure-secret-change-me" }),
    ).rejects.toThrow(/JWT_SECRET/);
    await expect(
      loadEnv({ NODE_ENV: "production", JWT_SECRET: "change-this-to-a-long-random-string" }),
    ).rejects.toThrow(/JWT_SECRET/);

    const prod = await loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "unit-test-production-jwt-secret-not-for-deploy",
    });
    expect(prod.env.jwtSecret).toBe("unit-test-production-jwt-secret-not-for-deploy");
    expect(prod.env.isDev).toBe(false);
  });

  it("enables the agent only when the selected provider is configured", async () => {
    const missing = await loadEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "   ", AI_PROVIDER: undefined });
    expect(missing.env.anthropicApiKey).toBeNull();
    expect(missing.aiEnabled).toBe(false);

    const anthropic = await loadEnv({ NODE_ENV: "test", ANTHROPIC_API_KEY: "test-key", AI_PROVIDER: "Anthropic" });
    expect(anthropic.env.aiProvider).toBe("anthropic");
    expect(anthropic.aiEnabled).toBe(true);

    const local = await loadEnv({
      NODE_ENV: "test",
      AI_PROVIDER: "LocalAI",
      LOCALAI_BASE_URL: "http://127.0.0.1:8080///",
      LOCALAI_MODEL: "unit-test-model",
      ANTHROPIC_API_KEY: undefined,
    });
    expect(local.env.aiProvider).toBe("localai");
    expect(local.env.localAiBaseUrl).toBe("http://127.0.0.1:8080");
    expect(local.aiEnabled).toBe(true);

    const incomplete = await loadEnv({
      NODE_ENV: "test",
      AI_PROVIDER: "localai",
      LOCALAI_BASE_URL: "http://127.0.0.1:8080",
      LOCALAI_MODEL: undefined,
    });
    expect(incomplete.aiEnabled).toBe(false);
  });

  it("parses the CIDR list and an explicit port", async () => {
    const mod = await loadEnv({
      NODE_ENV: "test",
      PORT: "4100",
      ALLOWED_CIDRS: " 10.0.0.0/8, , 192.168.1.0/24 ",
    });
    expect(mod.env.port).toBe(4100);
    expect(mod.env.allowedCidrs).toEqual(["10.0.0.0/8", "192.168.1.0/24"]);
  });
});
