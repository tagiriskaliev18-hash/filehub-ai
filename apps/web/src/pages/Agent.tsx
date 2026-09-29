import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { FileDto } from "@filehub/shared";
import { api } from "../lib/api";
import { iconFor } from "../lib/fileIcons";
import { formatDate } from "../lib/format";
import { ChatPanel } from "../features/agent-chat/ChatPanel";

// A dedicated, first-class home for the AI agent (rather than something
// nested a click deep inside a file's details panel). Two ways in: pick a
// file on the left to open a chat about it (as before), or start a general
// chat with no file and attach/upload files right inside the conversation —
// useful for cross-file requests like comparing a spec against a delivered
// project. On phones the list and chat collapse into a single view with a
// back button, since there isn't room for both side by side.
export function AgentPage() {
  const [searchParams] = useSearchParams();
  const [files, setFiles] = useState<FileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);

  useEffect(() => {
    api.agentStatus().then((s) => setAiEnabled(s.aiEnabled)).catch(() => setAiEnabled(false));
  }, []);

  function loadFiles() {
    return api.listAllFiles().then(({ files }) => setFiles(files));
  }

  useEffect(() => {
    loadFiles()
      .then(() => {
        const preselectId = searchParams.get("fileId");
        if (preselectId) openFile(preselectId);
      })
      .finally(() => setLoading(false));
    // Only run once on mount — the preselect param is a one-time deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openFile(fileId: string) {
    const { sessionId } = await api.getOrCreateSession(fileId);
    setSessionId(sessionId);
  }

  async function startGeneralChat() {
    const { sessionId } = await api.createGeneralAgentSession();
    setSessionId(sessionId);
  }

  const filtered = files.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`w-full sm:w-80 border-r bg-white flex flex-col ${sessionId ? "hidden sm:flex" : "flex"}`}>
        <div className="p-4 border-b space-y-2">
          <h1 className="font-semibold text-lg">ИИ-агент</h1>
          <p className="text-xs text-gray-500">Выберите файл, чтобы начать диалог по его содержимому, или откройте общий чат и прикрепите файлы прямо там.</p>
          <button onClick={startGeneralChat} className="w-full px-3 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700">
            + Новый общий чат
          </button>
        </div>
        <div className="p-3 border-b">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск файла…"
            className="w-full border rounded px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-gray-400">Загрузка…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-gray-400">
              {files.length === 0 ? "У вас пока нет файлов. Загрузите файл на вкладке «Мои файлы» или начните общий чат." : "Ничего не найдено."}
            </div>
          ) : (
            filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => openFile(f.id)}
                className="w-full text-left px-4 py-3 border-b hover:bg-gray-50 flex items-start gap-2"
              >
                <span className="text-lg leading-none">{iconFor(f.mimeType)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{f.name}</span>
                  <span className="block text-xs text-gray-400">{formatDate(f.updatedAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className={`flex-1 flex-col ${sessionId ? "flex" : "hidden sm:flex"}`}>
        {sessionId ? (
          <>
            <div className="border-b px-4 py-3 flex items-center gap-3 bg-white">
              <button onClick={() => setSessionId(null)} className="sm:hidden text-gray-500">
                ← Назад
              </button>
              <span className="font-medium truncate flex-1">Диалог с ИИ-агентом</span>
            </div>
            <ChatPanel sessionId={sessionId} aiEnabled={aiEnabled} onFilesChanged={loadFiles} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400 p-8">
            <div>
              <div className="text-4xl mb-3">🤖</div>
              <p>Выберите файл слева, или начните общий чат, чтобы прикрепить файлы прямо в диалоге.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
