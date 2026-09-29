import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me",
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? "fh_session",
  storageRoot: path.resolve(__dirname, "..", process.env.STORAGE_ROOT ?? "../../storage"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
  // Alternative to Anthropic: any OpenAI-compatible chat-completions endpoint
  // (e.g. a self-hosted LocalAI instance) — keeps document content on
  // internal infrastructure instead of an external API. Set AI_PROVIDER to
  // "localai" to use it; the rest of agent.service.ts is unaffected either
  // way, since responses are normalized to the same internal shape.
  aiProvider: (process.env.AI_PROVIDER?.trim().toLowerCase() || "anthropic") as "anthropic" | "localai",
  localAiBaseUrl: process.env.LOCALAI_BASE_URL?.trim().replace(/\/+$/, "") || null,
  localAiApiKey: process.env.LOCALAI_API_KEY?.trim() || null,
  localAiModel: process.env.LOCALAI_MODEL?.trim() || null,
  // Per-request cap on how long we wait for one LocalAI chat-completion
  // call. Without this, a request the model silently never answers (as
  // opposed to a clean error or connection reset) hangs the fetch() call
  // forever — no error, no timeout, nothing written to the DB or the
  // progress state, which from the UI looks exactly like a frozen agent.
  // Generous default since CPU inference on a large PDF can genuinely take
  // minutes; tune per hardware via env rather than in code.
  localAiTimeoutMs: Number(process.env.LOCALAI_TIMEOUT_MS ?? 5 * 60_000),
  // How many pages of a scanned PDF (no text layer) get rendered as images
  // and sent to the model per read. Higher = more of a long scan actually
  // gets seen, but costs proportionally more context — safe to raise with
  // Anthropic's large context window, but a small local model (see
  // AI_PROVIDER above) can run out of room and drop the connection with
  // even a handful of files at the default. Tune per provider, not in code.
  agentPdfMaxPages: Number(process.env.AGENT_PDF_MAX_PAGES ?? 6),
  // Render scale (roughly DPI/72) and JPEG quality for scanned-page images —
  // the other lever on the same context budget as the page count above.
  // Lower defaults than before: legible OCR doesn't need much resolution,
  // and every point here is pure context cost on a small model.
  agentPdfImageScale: Number(process.env.AGENT_PDF_IMAGE_SCALE ?? 1.5),
  agentPdfImageQuality: Number(process.env.AGENT_PDF_IMAGE_QUALITY ?? 65),
  allowedCidrs: (process.env.ALLOWED_CIDRS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  isDev: process.env.NODE_ENV !== "production",
};

export const aiEnabled =
  env.aiProvider === "localai" ? env.localAiBaseUrl !== null && env.localAiModel !== null : env.anthropicApiKey !== null;
