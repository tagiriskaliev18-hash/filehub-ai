import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.js";
import { createLocalAiCompletion } from "./localAiClient.js";

const original = {
  localAiBaseUrl: env.localAiBaseUrl,
  localAiModel: env.localAiModel,
  localAiApiKey: env.localAiApiKey,
  localAiTimeoutMs: env.localAiTimeoutMs,
};

const tools = [
  {
    name: "list_attached_files",
    description: "list",
    input_schema: { type: "object" as const, properties: {} },
  },
] as Anthropic.Tool[];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

describe("createLocalAiCompletion", () => {
  beforeEach(() => {
    env.localAiBaseUrl = "http://127.0.0.1:8080";
    env.localAiModel = "unit-test-model";
    env.localAiApiKey = null;
    env.localAiTimeoutMs = 5 * 60_000;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    env.localAiBaseUrl = original.localAiBaseUrl;
    env.localAiModel = original.localAiModel;
    env.localAiApiKey = original.localAiApiKey;
    env.localAiTimeoutMs = original.localAiTimeoutMs;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("refuses to call the network until base URL and model are set", async () => {
    env.localAiBaseUrl = null;
    await expect(
      createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 50 }),
    ).rejects.toThrow(/LOCALAI_BASE_URL/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("translates tools, images, and finish reasons into the internal shape", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "looking",
              tool_calls: [{ id: "call_1", function: { name: "list_attached_files", arguments: "{}" } }],
            },
          },
        ],
      }),
    );

    const result = await createLocalAiCompletion({
      systemPrompt: "sys",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_prev",
              content: [
                { type: "text", text: "page" },
                { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aaaa" } },
              ],
            },
          ],
        },
      ],
      tools,
      maxTokens: 80,
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.headers).not.toHaveProperty("Authorization");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("unit-test-model");
    expect(body.max_tokens).toBe(80);
    expect(body.tools[0]).toMatchObject({ type: "function", function: { name: "list_attached_files" } });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages.find((message: { role: string }) => message.role === "tool").content).toBe("page");
    const imageMessage = body.messages.find(
      (message: { role: string; content: unknown }) => message.role === "user" && Array.isArray(message.content),
    );
    expect(imageMessage.content[0].image_url.url).toBe("data:image/jpeg;base64,aaaa");

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      { type: "text", text: "looking", citations: [] },
      { type: "tool_use", id: "call_1", name: "list_attached_files", input: {} },
    ]);
  });

  it("sends a bearer token only when one is configured", async () => {
    env.localAiApiKey = "unit-test-local-key";
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] }),
    );
    const result = await createLocalAiCompletion({
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      tools,
      maxTokens: 10,
    });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: "Bearer unit-test-local-key" });
    expect(result.stop_reason).toBe("end_turn");
  });

  it("turns a bad tool-call payload into an empty input instead of crashing", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            finish_reason: "length",
            message: {
              content: "",
              tool_calls: [{ id: "c1", function: { name: "set_cell", arguments: "{broken" } }],
            },
          },
        ],
      }),
    );
    const result = await createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 10 });
    expect(result.stop_reason).toBe("max_tokens");
    expect(result.content).toEqual([{ type: "tool_use", id: "c1", name: "set_cell", input: {} }]);
  });

  it("surfaces HTTP failures, dropped connections, and timeouts without the raw client error", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse("overloaded", 503));
    await expect(
      createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 10 }),
    ).rejects.toThrow(/503/);

    vi.mocked(fetch).mockRejectedValue(new Error("fetch failed"));
    await expect(
      createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 10 }),
    ).rejects.toThrow(/соединение оборвалось/);

    vi.useFakeTimers();
    env.localAiTimeoutMs = 1000;
    vi.mocked(fetch).mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const pending = createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 10 });
    const assertion = expect(pending).rejects.toThrow(/не ответила/);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("rejects a body with no choices", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [] }));
    await expect(
      createLocalAiCompletion({ systemPrompt: "sys", messages: [], tools, maxTokens: 10 }),
    ).rejects.toThrow(/choices/);
  });
});
