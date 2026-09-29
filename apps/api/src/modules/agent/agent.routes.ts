import { Router } from "express";
import multer from "multer";
import { agentMessageSchema } from "@filehub/shared";
import { asyncHandler, HttpError } from "../../lib/asyncHandler.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { aiEnabled } from "../../env.js";
import * as agentService from "./agent.service.js";
import { toAgentMessageDto } from "./dto.js";
import { toFileDto } from "../files/dto.js";
import { fixUploadFilename } from "../files/files.routes.js";

export const agentRouter = Router();
agentRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

agentRouter.get("/status", (_req, res) => {
  res.json({ aiEnabled });
});

agentRouter.post(
  "/sessions/by-file/:fileId",
  asyncHandler(async (req, res) => {
    const session = await agentService.getOrCreateSession(req.params.fileId, req.user!.id);
    res.json({ sessionId: session.id });
  }),
);

// General-purpose entry point: a chat that starts with no file — files get
// attached afterward (existing files via the endpoint below, or new
// uploads), so one conversation can work across several files at once
// (e.g. comparing a spec document against a delivered project).
agentRouter.post(
  "/sessions",
  asyncHandler(async (req, res) => {
    const session = await agentService.createGeneralSession(req.user!.id);
    res.status(201).json({ sessionId: session.id });
  }),
);

agentRouter.get(
  "/sessions/:sessionId/files",
  asyncHandler(async (req, res) => {
    const files = await agentService.listSessionFiles(req.params.sessionId, req.user!.id);
    res.json({ files: files.map(toFileDto) });
  }),
);

agentRouter.post(
  "/sessions/:sessionId/files",
  asyncHandler(async (req, res) => {
    if (typeof req.body?.fileId !== "string") throw new HttpError(400, "Не указан fileId");
    const file = await agentService.attachExistingFile(req.params.sessionId, req.user!.id, req.body.fileId);
    res.status(201).json(toFileDto(file));
  }),
);

agentRouter.post(
  "/sessions/:sessionId/upload",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, "Файл не передан");
    const file = await agentService.attachUploadedFile(req.params.sessionId, req.user!.id, {
      originalName: fixUploadFilename(req.file.originalname),
      mimeType: req.file.mimetype || "application/octet-stream",
      data: req.file.buffer,
      folderId: null,
    });
    res.status(201).json(toFileDto(file));
  }),
);

agentRouter.delete(
  "/sessions/:sessionId/files/:fileId",
  asyncHandler(async (req, res) => {
    await agentService.detachFile(req.params.sessionId, req.user!.id, req.params.fileId);
    res.status(204).end();
  }),
);

agentRouter.get(
  "/sessions/:sessionId/messages",
  asyncHandler(async (req, res) => {
    const messages = await agentService.listMessages(req.params.sessionId, req.user!.id);
    res.json({ messages: messages.map(toAgentMessageDto) });
  }),
);

// Lets the client recover status after its streaming connection drops for
// reasons that have nothing to do with the generation itself — a
// backgrounded browser tab getting discarded, a page reload, a flaky network
// blip — since the tool-use loop keeps running server-side either way. Poll
// this after reconnecting instead of assuming a silent stream means nothing
// is happening.
agentRouter.get(
  "/sessions/:sessionId/progress",
  asyncHandler(async (req, res) => {
    await agentService.listMessages(req.params.sessionId, req.user!.id); // 404s if not owned
    const state = agentService.getSessionProgress(req.params.sessionId);
    res.json(state ?? { status: "idle", steps: [] });
  }),
);

// Streams newline-delimited JSON progress events while the agent's tool-use
// loop runs (each Claude round-trip + tool call can take several seconds, and
// the loop can run multiple rounds — without this the user stares at a
// spinner with zero idea whether anything is happening). Not wrapped in
// asyncHandler: once streaming starts, headers are already sent, so errors
// must be written into the stream itself rather than handled by the global
// error middleware.
agentRouter.post("/sessions/:sessionId/messages", async (req, res) => {
  let input;
  try {
    input = agentMessageSchema.parse(req.body);
  } catch {
    return res.status(400).json({ error: "Некорректные данные запроса" });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  // Guarded: if the client's connection is already gone (closed tab,
  // discarded background tab, network drop) by the time a progress event
  // fires, writing to a dead response can throw — which would otherwise
  // propagate up through the onProgress callback deep inside
  // agentService.sendMessage and abort the whole tool-use loop over a
  // client-side problem that has nothing to do with the generation itself.
  const send = (event: Record<string, unknown>) => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(`${JSON.stringify(event)}\n`);
    } catch {
      // ignore — same reasoning as above
    }
  };

  try {
    const message = await agentService.sendMessage(req.params.sessionId, req.user!.id, input.content, (text) =>
      send({ type: "status", text }),
    );
    send({ type: "done", message: toAgentMessageDto(message) });
  } catch (err) {
    const text = err instanceof HttpError ? err.message : "Ошибка при обращении к ИИ-агенту";
    send({ type: "error", message: text });
  } finally {
    res.end();
  }
});

agentRouter.post(
  "/messages/:messageId/apply",
  asyncHandler(async (req, res) => {
    const file = await agentService.applyMessage(req.params.messageId, req.user!.id);
    res.json(toFileDto(file));
  }),
);

agentRouter.post(
  "/messages/:messageId/reject",
  asyncHandler(async (req, res) => {
    await agentService.rejectMessage(req.params.messageId, req.user!.id);
    res.status(204).end();
  }),
);
