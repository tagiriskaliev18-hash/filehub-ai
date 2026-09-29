import type Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env.js";

// Talks to any OpenAI-compatible chat-completions endpoint (LocalAI, and
// similar self-hosted servers) using Anthropic's request/response shapes as
// the internal lingua franca, so the tool-use loop in agent.service.ts and
// the tool definitions in toolRegistry.ts don't need a second code path —
// only this file knows the OpenAI wire format exists. Deliberately a plain
// fetch client rather than the `openai` package: LocalAI's surface we use
// (chat completions + tool calling + image_url content) is a handful of
// fields, not worth a second heavyweight SDK dependency alongside
// @anthropic-ai/sdk.

interface LocalAiResult {
  content: Anthropic.ContentBlock[];
  stop_reason: string | null;
}

function toOpenAiTools(tools: Anthropic.Tool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function anthropicImageToOpenAi(block: Anthropic.ImageBlockParam) {
  const source = block.source as { type: "base64"; media_type: string; data: string };
  return { type: "image_url" as const, image_url: { url: `data:${source.media_type};base64,${source.data}` } };
}

// Anthropic interleaves tool_use/tool_result inside assistant/user message
// content arrays; OpenAI instead uses assistant.tool_calls plus separate
// role:"tool" messages. OpenAI's "tool" role also can't carry images (only
// "user" can), so any image content in a tool_result — the PDF scan-page
// vision fallback — gets split into a text-only tool ack followed by a
// synthetic user message carrying the images, right where the model expects
// to "see" the tool's output next.
function toOpenAiMessages(systemPrompt: string, messages: Anthropic.MessageParam[]) {
  const out: any[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === "assistant") {
      const textParts = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text);
      const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      out.push({
        role: "assistant",
        content: textParts.join("\n") || null,
        ...(toolUses.length > 0
          ? {
              tool_calls: toolUses.map((t) => ({
                id: t.id,
                type: "function",
                function: { name: t.name, arguments: JSON.stringify(t.input) },
              })),
            }
          : {}),
      });
      continue;
    }

    // role === "user": either plain content or a batch of tool_result blocks
    const pendingImages: { toolUseId: string; images: Anthropic.ImageBlockParam[] }[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_result") {
        const resultContent = block.content;
        if (typeof resultContent === "string" || resultContent === undefined) {
          out.push({ role: "tool", tool_call_id: block.tool_use_id, content: resultContent ?? "" });
        } else {
          const text = resultContent.filter((b): b is Anthropic.TextBlockParam => b.type === "text").map((b) => b.text).join("\n");
          const images = resultContent.filter((b): b is Anthropic.ImageBlockParam => b.type === "image");
          out.push({ role: "tool", tool_call_id: block.tool_use_id, content: text || "(см. изображения ниже)" });
          if (images.length > 0) pendingImages.push({ toolUseId: block.tool_use_id, images });
        }
      } else if (block.type === "text") {
        out.push({ role: "user", content: block.text });
      }
    }
    for (const { images } of pendingImages) {
      out.push({ role: "user", content: images.map(anthropicImageToOpenAi) });
    }
  }

  return out;
}

function fromOpenAiFinishReason(reason: string | null | undefined): string | null {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  if (reason === "stop") return "end_turn";
  return reason ?? null;
}

function fromOpenAiMessage(message: any): Anthropic.ContentBlock[] {
  const blocks: Anthropic.ContentBlock[] = [];
  if (message.content) {
    blocks.push({ type: "text", text: message.content, citations: [] } as Anthropic.TextBlock);
  }
  for (const call of message.tool_calls ?? []) {
    let input: any = {};
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      // A local model that emits malformed JSON for its tool arguments is a
      // real failure mode smaller models hit more often than Claude does —
      // surface it as an empty input rather than crashing the whole request,
      // so it shows up as a normal "tool got unexpected input" error instead.
    }
    blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input } as Anthropic.ToolUseBlock);
  }
  return blocks;
}

export async function createLocalAiCompletion(params: {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
}): Promise<LocalAiResult> {
  if (!env.localAiBaseUrl || !env.localAiModel) {
    throw new Error("LocalAI не настроен (LOCALAI_BASE_URL / LOCALAI_MODEL)");
  }

  let res: Response;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), env.localAiTimeoutMs);
  try {
    res = await fetch(`${env.localAiBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.localAiApiKey ? { Authorization: `Bearer ${env.localAiApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: env.localAiModel,
        messages: toOpenAiMessages(params.systemPrompt, params.messages),
        tools: toOpenAiTools(params.tools),
        max_tokens: params.maxTokens,
      }),
      signal: abortController.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // The model never answered at all within the budget — as opposed to a
      // clean HTTP error or a connection reset, this is a silent hang, which
      // without an explicit timeout would leave the fetch() promise (and the
      // whole request) stuck forever with no error and nothing written
      // anywhere, looking from the UI like the agent is frozen.
      const minutes = (env.localAiTimeoutMs / 60_000).toFixed(1);
      throw new Error(
        `Локальная модель не ответила за ${minutes} мин. — запрос, скорее всего, слишком большой или сложный для текущего контекстного окна модели. Попробуйте отправить меньше файлов за раз или задать более узкий вопрос.`,
      );
    }
    // Node's bare "fetch failed" (a connection reset with no HTTP response
    // at all) is what a request too large for the loaded model's context
    // window often looks like from here — the server drops the connection
    // instead of returning a clean error. Most likely trigger: several
    // attached files (especially scanned PDFs, each page sent as an image)
    // in one request. Give the user something actionable instead of a bare
    // "fetch failed".
    throw new Error(
      "Не удалось получить ответ от локальной модели — соединение оборвалось. Часто это означает, что запрос слишком большой для текущего контекстного окна модели (например, много файлов или страниц сканов сразу). Попробуйте отправить меньше файлов за раз или задать более узкий вопрос.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LocalAI ответил ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as any;
  const choice = json.choices?.[0];
  if (!choice) throw new Error("LocalAI вернул ответ без choices");

  return {
    content: fromOpenAiMessage(choice.message),
    stop_reason: fromOpenAiFinishReason(choice.finish_reason),
  };
}
