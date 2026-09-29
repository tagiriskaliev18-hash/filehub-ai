import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { AgentMessageDto, FileDto } from "@filehub/shared";
import { api, ApiError } from "../../lib/api";
import { iconFor } from "../../lib/fileIcons";

// Session-centric rather than file-centric: a chat can have zero or more
// files attached (attach existing ones, or upload new ones right here),
// which is what makes cross-file requests possible — e.g. "compare this
// spec against this project file and tell me what's missing".
export function ChatPanel({
  sessionId,
  aiEnabled,
  onFilesChanged,
}: {
  sessionId: string;
  aiEnabled: boolean;
  onFilesChanged: () => void;
}) {
  const [messages, setMessages] = useState<AgentMessageDto[]>([]);
  const [attached, setAttached] = useState<FileDto[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [undoneIds, setUndoneIds] = useState<Set<string>>(new Set());
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [allFiles, setAllFiles] = useState<FileDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element the pointer crosses,
  // not just the outer container — a plain boolean flickers off every time
  // the pointer passes over a message bubble or button underneath. Counting
  // enter/leave pairs instead only clears the flag once the pointer has
  // actually left every nested element.
  const dragCounter = useRef(0);

  function refreshAttached() {
    api.listSessionFiles(sessionId).then(({ files }) => setAttached(files));
  }

  useEffect(() => {
    setMessages([]);
    if (!aiEnabled) return;
    let cancelled = false;
    refreshAttached();
    api
      .listAgentMessages(sessionId)
      .then(async ({ messages }) => {
        if (cancelled) return;
        setMessages(messages);

        // Recover a generation still running from before this mount — e.g.
        // the user switched to another tab mid-reply and came back. The
        // tool-use loop keeps going server-side regardless of who's watching,
        // so poll status instead of showing nothing just because the
        // original streaming connection is gone.
        const state = await api.getAgentProgress(sessionId);
        if (cancelled || state.status !== "running") return;
        setSending(true);
        setProgress(state.steps);
        pollUntilDone(sessionId, () => cancelled);
      })
      .catch((err) => {
        // Without this, a failed recovery check (network blip, session
        // hiccup right after reload) silently swallows the rejection —
        // sending/progress just never get set, so the UI looks like nothing
        // is happening instead of showing the actual problem.
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Не удалось загрузить чат");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, aiEnabled]);

  async function pollUntilDone(sid: string, isCancelled: () => boolean) {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      if (isCancelled()) return;
      const state = await api.getAgentProgress(sid);
      if (isCancelled()) return;
      if (state.status === "running") {
        setProgress(state.steps);
        continue;
      }
      if (state.status === "error") {
        setError(state.error ?? "Ошибка при обращении к ИИ-агенту");
      } else {
        const { messages } = await api.listAgentMessages(sid);
        if (!isCancelled()) setMessages(messages);
      }
      setSending(false);
      setProgress([]);
      return;
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, progress]);

  async function send() {
    if (!input.trim()) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setProgress([]);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, sessionId, role: "user", content, proposedDiff: null, status: "none", createdAt: new Date().toISOString() },
    ]);
    try {
      const reply = await api.streamAgentMessage(sessionId, content, (text) => {
        setProgress((prev) => [...prev, text]);
      });
      setMessages((prev) => [...prev, reply]);
      refreshAttached();
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить сообщение");
    } finally {
      setSending(false);
      setProgress([]);
    }
  }

  async function uploadFile(file: File) {
    await uploadFiles([file]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Shared by the file-picker input and drag-and-drop — uploads sequentially
  // (not Promise.all) so a mid-batch failure doesn't leave sibling uploads
  // racing each other's refreshAttached() calls.
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        await api.uploadFileToSession(sessionId, file);
      }
      refreshAttached();
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить файл");
    } finally {
      setUploading(false);
    }
  }

  async function openAttachPicker() {
    setAttachPickerOpen(true);
    const { files } = await api.listAllFiles();
    setAllFiles(files);
  }

  async function attachExisting(fileId: string) {
    try {
      await api.attachFileToSession(sessionId, fileId);
      refreshAttached();
      setAttachPickerOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось прикрепить файл");
    }
  }

  async function detach(fileId: string) {
    try {
      await api.detachFileFromSession(sessionId, fileId);
      refreshAttached();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось открепить файл");
    }
  }

  async function applyDiff(messageId: string) {
    try {
      await api.applyAgentMessage(messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "applied" } : m)));
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось применить изменения");
    }
  }

  async function rejectDiff(messageId: string) {
    try {
      await api.rejectAgentMessage(messageId);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, status: "rejected" } : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отклонить изменения");
    }
  }

  async function undoApplied(messageId: string, targetFileId: string) {
    try {
      await api.undoLastChange(targetFileId);
      setUndoneIds((prev) => new Set(prev).add(messageId));
      onFilesChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отменить изменения");
    }
  }

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragCounter.current++;
    setIsDragging(true);
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    uploadFiles([...e.dataTransfer.files]);
  }

  if (!aiEnabled) {
    return (
      <div className="p-4 text-sm text-gray-500">
        ИИ-агент временно недоступен (режим деградации). Файлом можно управлять обычными инструментами файлового менеджера.
      </div>
    );
  }

  const attachableFiles = allFiles.filter((f) => !attached.some((a) => a.id === f.id));

  return (
    <div
      className="relative flex flex-col h-full"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-20 bg-brand-600/10 border-4 border-dashed border-brand-500 rounded flex items-center justify-center pointer-events-none">
          <div className="bg-white px-6 py-4 rounded-lg shadow-lg text-brand-700 font-medium">📎 Отпустите файл(ы), чтобы загрузить в чат</div>
        </div>
      )}
      <div className="border-b px-3 py-2 flex flex-wrap items-center gap-2 bg-gray-50">
        {attached.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1 bg-white border rounded-full pl-2 pr-1 py-0.5 text-xs">
            <span>{iconFor(f.mimeType)}</span>
            <span className="max-w-[140px] truncate">{f.name}</span>
            <button onClick={() => detach(f.id)} title="Открепить" className="text-gray-400 hover:text-red-600 px-1">
              ×
            </button>
          </span>
        ))}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-xs px-2 py-1 border rounded hover:bg-white disabled:opacity-50">
          {uploading ? "Загрузка…" : "+ Загрузить файл"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
          }}
        />
        <div className="relative">
          <button onClick={openAttachPicker} className="text-xs px-2 py-1 border rounded hover:bg-white">
            + Прикрепить существующий
          </button>
          {attachPickerOpen && (
            <div className="absolute z-10 mt-1 w-64 max-h-64 overflow-y-auto bg-white border rounded shadow-lg">
              <div className="flex justify-between items-center px-2 py-1 border-b text-xs text-gray-400">
                <span>Выберите файл</span>
                <button onClick={() => setAttachPickerOpen(false)} className="hover:text-gray-700">
                  ×
                </button>
              </div>
              {attachableFiles.length === 0 ? (
                <div className="p-2 text-xs text-gray-400">Нет доступных файлов</div>
              ) : (
                attachableFiles.map((f) => (
                  <button key={f.id} onClick={() => attachExisting(f.id)} className="w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-1">
                    <span>{iconFor(f.mimeType)}</span>
                    <span className="truncate">{f.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {attached.length === 0 && messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm p-8">
            Загрузите или прикрепите один или несколько файлов выше, чтобы обсудить их с ИИ-агентом — можно сразу несколько, например чтобы сверить один документ с другим.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-800"}`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {m.proposedDiff && (
                <div className="mt-2 bg-white rounded border text-gray-800 p-2 text-xs space-y-2">
                  <div className="font-medium">
                    {m.proposedDiff.targetFileName && <span className="text-gray-400">[{m.proposedDiff.targetFileName}] </span>}
                    {m.proposedDiff.summary}
                  </div>
                  <details>
                    <summary className="cursor-pointer text-brand-700">Показать предпросмотр (до/после)</summary>
                    <div className="grid grid-cols-1 gap-2 mt-2">
                      <div>
                        <div className="font-semibold text-gray-500">До:</div>
                        <pre className="whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-50 p-1 rounded">{m.proposedDiff.before}</pre>
                      </div>
                      <div>
                        <div className="font-semibold text-gray-500">После:</div>
                        <pre className="whitespace-pre-wrap max-h-40 overflow-y-auto bg-gray-50 p-1 rounded">{m.proposedDiff.after}</pre>
                      </div>
                    </div>
                  </details>
                  {m.status === "pending" && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => applyDiff(m.id)} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">
                        Принять
                      </button>
                      <button onClick={() => rejectDiff(m.id)} className="px-3 py-1 bg-gray-200 rounded text-xs hover:bg-gray-300">
                        Отклонить
                      </button>
                    </div>
                  )}
                  {m.status === "applied" &&
                    (undoneIds.has(m.id) ? (
                      <div className="text-gray-500 text-xs">Изменения отменены — файл возвращён к прежней версии</div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-green-700 text-xs">Изменения применены</span>
                        <a href={api.downloadUrl(m.proposedDiff.targetFileId)} className="text-xs text-brand-600 hover:underline">
                          Скачать файл
                        </a>
                        <button onClick={() => undoApplied(m.id, m.proposedDiff!.targetFileId)} className="text-xs text-brand-600 hover:underline">
                          Отменить
                        </button>
                      </div>
                    ))}
                  {m.status === "rejected" && <div className="text-gray-500 text-xs">Изменения отклонены</div>}
                </div>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-600">
              {progress.length === 0 ? (
                <ThinkingDots />
              ) : (
                <ul className="space-y-1">
                  {progress.slice(0, -1).map((step, i) => (
                    <li key={i} className="text-gray-400 line-through decoration-gray-300">
                      {step}
                    </li>
                  ))}
                  <li className="flex items-center gap-2 font-medium text-gray-700">
                    <ThinkingDots small />
                    {progress[progress.length - 1]}
                  </li>
                </ul>
              )}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
      {error && <div className="px-4 py-2 text-sm text-red-600 bg-red-50">{error}</div>}
      <div className="border-t p-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Например: сверь технические условия с файлом проекта"
          disabled={sending}
          className="flex-1 border rounded px-3 py-2 text-sm disabled:bg-gray-50"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700 disabled:opacity-50"
        >
          Отправить
        </button>
      </div>
    </div>
  );
}

function ThinkingDots({ small }: { small?: boolean }) {
  const size = small ? "w-1.5 h-1.5" : "w-2 h-2";
  return (
    <span className="inline-flex items-center gap-1" aria-label="ИИ-агент печатает">
      <span className={`${size} rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]`} />
      <span className={`${size} rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]`} />
      <span className={`${size} rounded-full bg-gray-400 animate-bounce`} />
    </span>
  );
}
