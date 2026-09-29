import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../prisma.js";
import { env, aiEnabled } from "../../env.js";
import { storage } from "../storage/storage.adapter.js";
import { createNewVersion, uploadFile } from "../files/files.service.js";
import { HttpError } from "../../lib/asyncHandler.js";
import { writeAudit } from "../../lib/audit.js";
import {
  categoryForFile,
  getToolsForCategories,
  dispatchTool,
  type AgentToolContext,
  type AttachedFileState,
  type DocCategory,
} from "./toolRegistry.js";
import * as docxTools from "./tools/docx.js";
import * as pptxTools from "./tools/pptx.js";
import * as xlsxTools from "./tools/xlsx.js";
import * as pdfTools from "./tools/pdf.js";
import { createDocxFromOutline, createPptxFromOutline, createXlsxFromOutline } from "./tools/create.js";
import { convertViaLibreOffice } from "../conversion/libreoffice.js";
import { createLocalAiCompletion } from "./localAiClient.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 8;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!aiEnabled) throw new HttpError(503, "ИИ-агент временно недоступен (режим деградации: не настроен ключ API)");
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey! });
  return client;
}

async function describeDocument(buffer: Buffer, category: DocCategory): Promise<string> {
  try {
    // Each branch must be awaited *inside* this try — returning an unawaited
    // promise would let it reject after this function has already returned,
    // outside the catch's scope, turning a "couldn't read this file" case
    // into an unhandled rejection that aborts the whole chat request.
    if (category === "docx") return await docxTools.readDocxText(buffer);
    if (category === "pptx") return JSON.stringify(await pptxTools.listSlides(buffer), null, 2);
    if (category === "xlsx") return await xlsxTools.readSheet(buffer);
    if (category === "pdf") return await pdfTools.readPdfText(buffer);
  } catch {
    return "(не удалось прочитать содержимое)";
  }
  return "(предпросмотр недоступен для этого типа файла)";
}

// Kept for the existing "open a file → AI agent" entry point: finds or
// creates a session with exactly that one file attached, via the join table
// (see AgentSessionFile) rather than the legacy single fileId column.
export async function getOrCreateSession(fileId: string, userId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== userId) throw new HttpError(404, "Файл не найден");

  // Must match a session dedicated to exactly this one file — `some: {
  // fileId }` alone would also match a multi-file session that merely
  // includes this file among several others (e.g. one built for a
  // cross-file comparison), which would make clicking any of those files in
  // the sidebar reopen that same shared session instead of a dedicated one.
  // `every: { fileId }` requires ALL attached files to equal this fileId;
  // `some: {}` rules out an empty (fileless) session vacuously satisfying `every`.
  const existing = await prisma.agentSession.findFirst({
    where: { createdById: userId, files: { every: { fileId }, some: {} } },
  });
  if (existing) return existing;

  return prisma.agentSession.create({
    data: { createdById: userId, fileId, files: { create: [{ fileId }] } },
  });
}

// The other entry point: a chat that starts with no file at all — files get
// attached afterward, in-conversation, via attachExistingFile /
// attachUploadedFile below.
export async function createGeneralSession(userId: string) {
  return prisma.agentSession.create({ data: { createdById: userId } });
}

async function requireOwnedSession(sessionId: string, userId: string) {
  const session = await prisma.agentSession.findUnique({ where: { id: sessionId } });
  if (!session || session.createdById !== userId) throw new HttpError(404, "Сессия не найдена");
  return session;
}

export async function listSessionFiles(sessionId: string, userId: string) {
  await requireOwnedSession(sessionId, userId);
  const links = await prisma.agentSessionFile.findMany({ where: { sessionId }, include: { file: true }, orderBy: { createdAt: "asc" } });
  return links.map((l) => l.file);
}

export async function attachExistingFile(sessionId: string, userId: string, fileId: string) {
  await requireOwnedSession(sessionId, userId);
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || file.ownerId !== userId) throw new HttpError(404, "Файл не найден");
  await prisma.agentSessionFile.upsert({
    where: { sessionId_fileId: { sessionId, fileId } },
    update: {},
    create: { sessionId, fileId },
  });
  return file;
}

export async function attachUploadedFile(
  sessionId: string,
  userId: string,
  params: { originalName: string; mimeType: string; data: Buffer; folderId: string | null },
) {
  await requireOwnedSession(sessionId, userId);
  const file = await uploadFile({ ownerId: userId, ...params });
  await prisma.agentSessionFile.create({ data: { sessionId, fileId: file.id } });
  return file;
}

export async function detachFile(sessionId: string, userId: string, fileId: string) {
  await requireOwnedSession(sessionId, userId);
  await prisma.agentSessionFile.deleteMany({ where: { sessionId, fileId } });
}

export async function listMessages(sessionId: string, userId: string) {
  const session = await prisma.agentSession.findUnique({ where: { id: sessionId } });
  if (!session || session.createdById !== userId) throw new HttpError(404, "Сессия не найдена");
  return prisma.agentMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
}

interface InternalDiff {
  summary: string;
  before: string;
  after: string;
  draftKey: string | null;
  targetFileId: string;
  targetMimeType: string;
  targetName: string;
  createdFileIds: { fileId: string; name: string }[];
}

const READ_ONLY_PROGRESS_LABELS: Record<string, string> = {
  read_docx_text: "Читаю текст документа…",
  list_slides: "Просматриваю слайды презентации…",
  read_sheet: "Читаю данные листа…",
  list_sheet_names: "Смотрю список листов…",
  read_pdf_text: "Извлекаю текст из PDF…",
};

export type AgentProgress = (text: string) => void;

export interface SessionProgressState {
  status: "running" | "error";
  steps: string[];
  error?: string;
}

// Lets a client that reconnects mid-generation (tab was backgrounded and its
// streaming connection got dropped, page reloaded, etc.) recover current
// status via polling instead of the generation appearing to have vanished —
// the tool-use loop below runs to completion regardless of whether anyone is
// still listening on the original stream. Cleared on success (the finished
// answer is already in AgentMessage by then); left set on error so a poll
// can surface what went wrong, until the next message on this session
// resets it.
const activeProgress = new Map<string, SessionProgressState>();

export function getSessionProgress(sessionId: string): SessionProgressState | null {
  return activeProgress.get(sessionId) ?? null;
}

export async function sendMessage(sessionId: string, userId: string, content: string, notify: AgentProgress = () => {}) {
  const progressState: SessionProgressState = { status: "running", steps: [] };
  activeProgress.set(sessionId, progressState);
  const onProgress: AgentProgress = (text) => {
    progressState.steps.push(text);
    try {
      notify(text);
    } catch {
      // Client's connection is gone — keep going, don't let a dead socket
      // abort the generation itself.
    }
  };

  try {
  const session = await requireOwnedSession(sessionId, userId);

  await prisma.agentMessage.create({ data: { sessionId, role: "user", content } });

  const links = await prisma.agentSessionFile.findMany({ where: { sessionId }, include: { file: true }, orderBy: { createdAt: "asc" } });
  onProgress(links.length === 1 ? `Открываю файл «${links[0].file.name}»…` : links.length > 1 ? `Открываю файлы (${links.length})…` : "Начинаю беседу…");

  const ctx: AgentToolContext = { files: new Map() };
  const beforeDescriptions = new Map<string, string>();
  // A file can be attached to more than one active session, and buffers are
  // mutated in place as tools edit them — load a fresh copy per session
  // rather than risking two concurrent conversations sharing one Buffer.
  for (const link of links) {
    const buffer = await storage.get(link.file.storageKey);
    const category = categoryForFile(link.file.mimeType);
    ctx.files.set(link.file.id, { fileId: link.file.id, name: link.file.name, category, buffer, changeLog: [], proposedSummary: null });
    beforeDescriptions.set(link.file.id, await describeDocument(buffer, category));
  }
  const createdFiles: { fileId: string; name: string }[] = [];
  // Anchors a brand-new file's folder to wherever the first attached file
  // already lives, when there is one — falls back to the root folder for a
  // general chat that has none yet.
  const anchorFile = links[0]?.file ?? null;

  const history = await prisma.agentMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  // Anthropic is the default, well-tested path; LocalAI (or any other
  // OpenAI-compatible endpoint) is opt-in via AI_PROVIDER=localai, keeping
  // document content on internal infrastructure instead of Anthropic's API.
  // getClient() is skipped entirely for localai — it would otherwise demand
  // an ANTHROPIC_API_KEY that provider has no use for.
  const anthropic = env.aiProvider === "anthropic" ? getClient() : null;
  if (!aiEnabled) throw new HttpError(503, "ИИ-агент временно недоступен (режим деградации: провайдер не настроен)");
  const categories = new Set([...ctx.files.values()].map((f) => f.category));
  const tools = getToolsForCategories(categories);
  // Marks the tool definitions as a cache breakpoint: the system prompt +
  // tool schemas are identical across every round-trip within this same
  // tool-use loop (and close to identical across messages in the same
  // session), so caching them means iteration 2+ skip reprocessing that
  // fixed prefix entirely — the biggest lever for response latency here,
  // since a typical edit already takes 2-3 round trips (read, then act,
  // then propose_diff).
  const cachedTools: Anthropic.Tool[] = tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );

  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const fileListText =
    links.length === 0
      ? "Файлы пока не прикреплены к этой беседе — пользователь может загрузить или прикрепить их в любой момент."
      : "Прикреплённые файлы:\n" + links.map((l) => `- id="${l.file.id}", имя="${l.file.name}", тип=${categoryForFile(l.file.mimeType)}`).join("\n");

  const systemPrompt = [
    "Ты — ИИ-агент корпоративной файловой платформы FileHub AI.",
    "В этой беседе может быть прикреплено несколько файлов одновременно (например, чтобы сверить один документ с другим). Каждый вызов инструмента, работающего с конкретным файлом, требует параметр fileId — используй list_attached_files, если не уверен в id.",
    fileListText,
    "Используй инструменты, чтобы прочитать и изменить файлы. Не выдумывай содержимое, которое не видел — сначала читай. Если пользователь просит сравнить/сверить несколько файлов — прочитай каждый через соответствующий read-инструмент и отвечай текстом на основе реально прочитанного, без propose_diff/создания файлов, если правки не просили.",
    "Прежде чем вносить ЛЮБЫЕ правки в конкретный файл (или создавать исправленную версию PDF/скана через create_file_from_description с sourceFileId), сразу после чтения его содержимого вызови check_document_signatures для этого fileId и честно сообщи, есть ли в документе подписи/печати/утверждение конкретными лицами. Это не формальность — платформа технически не даст сохранить изменения, если этот инструмент не вызван для файла или если он вернул, что подписи есть; в этом случае объясни пользователю отказ и предложи официальный порядок исправления (переподписание или протокол/эрратум) вместо тихой правки.",
    "Когда все правки в конкретный файл внесены, обязательно вызови propose_diff с fileId и кратким описанием изменений — без этого изменения не будут показаны и сохранены пользователю. За одно сообщение редактируй только один файл (если нужно отредактировать несколько — сделай это в следующих сообщениях).",
    "Если пользователь просто задаёт вопрос о содержимом без просьбы что-то изменить — отвечай текстом и НЕ вызывай propose_diff.",
    "Отвечай на русском языке, если пользователь не пишет по-английски.",
    "НИКОГДА не заменяй в документе реальные имена/фамилии людей, подписи, даты, номера документов, печати/штампы или другие сведения, удостоверяющие подлинность или авторство, на выдуманные — ни по прямой просьбе, ни по своей инициативе. Это верно для любых документов, но особенно для официальных/технических/регламентных, где такие поля определяют, кто именно составил или утвердил документ. Разрешено: чинить настоящие опечатки/ошибки OCR (если пользователь указывает, как поле должно выглядеть на самом деле), и любые правки контента, не затрагивающие такие поля. Если просят подставить случайные/сгенерированные имена вместо настоящих — вежливо откажи именно в этой части и объясни, что это выглядит как подделка документа, но предложи выполнить остальную часть запроса, если она есть.",
    ...(categories.has("pdf")
      ? [
          "У PDF нет инструментов редактирования — у тебя нет propose_diff для PDF-файлов, и ты никогда не пытаешься изменить сам PDF/скан «на месте». Для PDF ты можешь только читать/суммаризировать/переводить/сравнивать его текст (read_pdf_text) или создать СОВЕРШЕННО НОВЫЙ файл docx/pptx/xlsx на основе его содержимого через create_file_from_description (указав sourceFileId = id этого PDF).",
          "Если пользователь просит исправить/изменить конкретные слова в скане и получить готовый файл — это нормальный запрос (см. также правило выше про запрет подмены имён/подписей), выполняй его через create_file_from_description с sourceFileId: сначала через read_pdf_text полностью распознай ВЕСЬ текст со всех страниц (для сканов инструмент сам вернёт изображения страниц — прочитай их целиком, включая рукописный текст, если он есть), затем вызови create_file_from_description ОДИН РАЗ с ПОЛНЫМ текстом документа, внеся туда запрошенные правки. Результат — новый самостоятельный файл с исправленным содержимым, а не изменённая копия оригинального скана.",
        ]
      : []),
    ...(categories.has("unsupported")
      ? [
          "Для некоторых прикреплённых файлов нет инструментов чтения или редактирования (неподдерживаемый тип) — явно сообщи об этом пользователю, если он спросит про такой файл. Создать новый docx/pptx/xlsx через create_file_from_description по-прежнему можно.",
        ]
      : []),
  ].join("\n");

  let finalText = "";
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    onProgress(iterations === 1 ? "Анализирую запрос…" : "Обдумываю следующий шаг…");
    // 8192: reconstructing a whole scanned document's text into a
    // create_file_from_description call (see the pdf system-prompt branch
    // above) needs real room for a multi-page document — 2048/4096 were both
    // observed truncating mid-outline on a 4-page document, which silently
    // produced an empty file rather than an obvious error (see the
    // emptiness check in handleCreateFile below, added for the same reason:
    // raising the limit reduces how often this happens but can't rule it
    // out for a long enough document).
    const response =
      anthropic !== null
        ? await anthropic.messages.create({
            model: MODEL,
            max_tokens: 8192,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            tools: cachedTools,
            messages,
          })
        : await createLocalAiCompletion({ systemPrompt, messages, tools: cachedTools, maxTokens: 8192 });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    finalText = textBlocks.map((b) => b.text).join("\n") || finalText;

    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let stop = false;

    for (const use of toolUses) {
      try {
        if (use.name === "create_file_from_description") {
          const input = use.input as any;
          // sourceFileId marks this as a pdf's "edit via replacement" path
          // (there are no real edit tools for a pdf/scan) — so it needs the
          // same signature gate propose_diff has for docx/pptx/xlsx. Doesn't
          // apply when creating a genuinely new, unrelated file (no
          // sourceFileId) — that path never touches any existing content.
          const sourceFile = input.sourceFileId ? ctx.files.get(input.sourceFileId) : null;
          if (sourceFile && sourceFile.documentHasSignatures !== false) {
            throw new Error(
              sourceFile.documentHasSignatures === true
                ? `Создание исправленной версии "${sourceFile.name}" заблокировано: в документе обнаружены подписи/утверждение конкретными лицами.`
                : `Сначала вызови check_document_signatures для "${sourceFile.name}", чтобы проверить документ на наличие подписей.`,
            );
          }
          onProgress(`Создаю новый файл «${input.fileName ?? ""}»…`);
          // pdf sessions have no edit tools at all, so this is the only way
          // they get a usable end result — auto-export the created docx to
          // PDF too via LibreOffice, since that's the format the user
          // actually asked to end up with, not an intermediate they have to
          // convert by hand.
          const created = await handleCreateFile(
            input,
            userId,
            anchorFile?.folderId ?? null,
            sourceFile?.category === "pdf",
            response.stop_reason,
          );
          created.forEach((c) => createdFiles.push({ fileId: c.id, name: c.name }));
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: `Создан(ы) файл(ы): ${created.map((c) => `"${c.name}" (id: ${c.id})`).join(", ")}`,
          });
          onProgress(`Файл «${created[0].name}» создан`);
        } else if (use.name === "propose_diff") {
          onProgress("Готовлю предпросмотр изменений…");
          const result = await dispatchTool(use.name, use.input, ctx);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: result });
        } else {
          const targetFile = ctx.files.get((use.input as any)?.fileId);
          const changeLogBefore = targetFile?.changeLog.length ?? 0;
          onProgress(READ_ONLY_PROGRESS_LABELS[use.name] ?? `Выполняю: ${use.name}…`);
          const result = await dispatchTool(use.name, use.input, ctx);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: result });
          if (targetFile && targetFile.changeLog.length > changeLogBefore) onProgress(targetFile.changeLog[targetFile.changeLog.length - 1]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ошибка выполнения инструмента";
        toolResults.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        onProgress(`Ошибка: ${message}`);
      }
      // create_file_from_description is a terminal action, same as
      // propose_diff — nothing about "a new file now exists" calls for
      // another tool round. Without this, a model that second-guesses
      // itself (or a pdf source file, which has no propose_diff to stop on)
      // can keep re-calling it every iteration up to MAX_TOOL_ITERATIONS,
      // creating the same file repeatedly.
      if (use.name === "propose_diff" || use.name === "create_file_from_description") stop = true;
    }

    messages.push({ role: "user", content: toolResults });
    if (stop) break;
  }

  let diff: InternalDiff | null = null;
  // At most one file gets a proposed diff per message (propose_diff stops
  // the loop) — find it, if any.
  const editedFile = [...ctx.files.values()].find((f) => f.proposedSummary !== null);
  if (editedFile) {
    const afterDescription = await describeDocument(editedFile.buffer, editedFile.category);
    const draftKey = `drafts/${sessionId}-${Date.now()}`;
    await storage.put(draftKey, editedFile.buffer);
    const originalFile = links.find((l) => l.file.id === editedFile.fileId)!.file;
    diff = {
      summary: editedFile.proposedSummary!,
      before: beforeDescriptions.get(editedFile.fileId) ?? "",
      after: afterDescription,
      draftKey,
      targetFileId: originalFile.id,
      targetMimeType: originalFile.mimeType,
      targetName: originalFile.name,
      createdFileIds: createdFiles,
    };
  } else if (createdFiles.length > 0 && !finalText) {
    finalText = `Готово. Создан файл: ${createdFiles.map((f) => f.name).join(", ")}`;
  } else if (!finalText) {
    finalText = "Не удалось сформировать ответ.";
  }

  const assistantMessage = await prisma.agentMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content: finalText,
      proposedDiff: diff ? JSON.stringify(diff) : null,
      status: diff ? "pending" : "none",
    },
  });

  await writeAudit({
    userId,
    action: "agent.message",
    targetType: "AgentSession",
    targetId: sessionId,
    meta: { changeLog: [...ctx.files.values()].flatMap((f) => f.changeLog.map((c) => `[${f.name}] ${c}`)), createdFiles },
  });

  activeProgress.delete(sessionId);
  return assistantMessage;
  } catch (err) {
    progressState.status = "error";
    progressState.error = err instanceof Error ? err.message : "Ошибка при обращении к ИИ-агенту";
    throw err;
  }
}

const EMPTY_OUTLINE_MESSAGE = (stopReason: string | null) =>
  stopReason === "max_tokens"
    ? "Не удалось создать файл: ответ модели обрезан по лимиту токенов раньше, чем текст документа поместился. Попробуйте разбить документ на части (например, по разделам) и создавать/дополнять файл несколькими сообщениями."
    : "Не удалось создать файл: модель не передала никакого содержимого. Попробуйте переформулировать запрос.";

async function handleCreateFile(input: any, ownerId: string, folderId: string | null, alsoExportAsPdf: boolean, stopReason: string | null) {
  let data: Buffer;
  let mimeType: string;
  let sourceExt: string;
  // A silently-empty result (the model's tool call carried no real content,
  // most often because its response got cut off by max_tokens mid-outline
  // on a long document) used to still report success with a blank file —
  // confusing and easy to miss. Fail loudly instead.
  if (input.fileType === "docx") {
    const outline = input.docx;
    if (!outline?.title?.trim() && !outline?.sections?.some((s: any) => s?.text?.trim() || s?.heading?.trim())) {
      throw new Error(EMPTY_OUTLINE_MESSAGE(stopReason));
    }
    data = await createDocxFromOutline(outline);
    mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    sourceExt = "docx";
  } else if (input.fileType === "pptx") {
    const outline = input.pptx;
    if (!outline?.slides?.some((s: any) => s?.title?.trim() || s?.bullets?.length)) {
      throw new Error(EMPTY_OUTLINE_MESSAGE(stopReason));
    }
    data = await createPptxFromOutline(outline);
    mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    sourceExt = "pptx";
  } else if (input.fileType === "xlsx") {
    const outline = input.xlsx;
    if (!outline?.rows?.length) {
      throw new Error(EMPTY_OUTLINE_MESSAGE(stopReason));
    }
    data = await createXlsxFromOutline(outline);
    mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    sourceExt = "xlsx";
  } else {
    throw new Error(`Неизвестный тип файла "${input.fileType}"`);
  }

  const created = await uploadFile({ ownerId, folderId, originalName: input.fileName, mimeType, data });
  const results = [created];

  if (alsoExportAsPdf) {
    try {
      const pdfData = await convertViaLibreOffice(data, sourceExt, "pdf");
      const base = input.fileName.replace(/\.[^.]+$/, "");
      const pdfCreated = await uploadFile({ ownerId, folderId, originalName: `${base}.pdf`, mimeType: "application/pdf", data: pdfData });
      results.push(pdfCreated);
    } catch {
      // LibreOffice unavailable or conversion failed — non-fatal, the
      // source file above is still a usable result on its own.
    }
  }

  return results;
}

export async function applyMessage(messageId: string, userId: string) {
  const message = await prisma.agentMessage.findUnique({ where: { id: messageId }, include: { session: true } });
  if (!message || message.session.createdById !== userId) throw new HttpError(404, "Сообщение не найдено");
  if (message.status !== "pending" || !message.proposedDiff) throw new HttpError(400, "Нет ожидающих применения изменений");

  const diff: InternalDiff = JSON.parse(message.proposedDiff);
  if (!diff.draftKey) throw new HttpError(400, "Черновик изменений не найден");

  const draft = await storage.get(diff.draftKey);
  const updated = await createNewVersion({
    fileId: diff.targetFileId,
    data: draft,
    authoredBy: "AGENT",
    note: diff.summary,
  });

  await prisma.agentMessage.update({ where: { id: messageId }, data: { status: "applied" } });
  await storage.delete(diff.draftKey);
  await writeAudit({ userId, action: "agent.apply", targetType: "File", targetId: updated.id, meta: { summary: diff.summary } });

  return updated;
}

export async function rejectMessage(messageId: string, userId: string) {
  const message = await prisma.agentMessage.findUnique({ where: { id: messageId }, include: { session: true } });
  if (!message || message.session.createdById !== userId) throw new HttpError(404, "Сообщение не найдено");
  if (message.status !== "pending") throw new HttpError(400, "Нет ожидающих изменений");

  if (message.proposedDiff) {
    const diff: InternalDiff = JSON.parse(message.proposedDiff);
    if (diff.draftKey) await storage.delete(diff.draftKey);
  }

  await prisma.agentMessage.update({ where: { id: messageId }, data: { status: "rejected" } });
  await writeAudit({ userId, action: "agent.reject", targetType: "AgentMessage", targetId: messageId });
}
