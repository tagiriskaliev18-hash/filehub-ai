import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FileDto, FileVersionDto, FolderDto } from "@filehub/shared";
import { api, ApiError } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";
import { iconFor } from "../lib/fileIcons";
import { Breadcrumbs, type Crumb } from "../components/Breadcrumbs";
import { CompressWizard } from "../features/compress-wizard/CompressWizard";
import { ConvertWizard } from "../features/convert-wizard/ConvertWizard";
import { ChatPanel } from "../features/agent-chat/ChatPanel";
import { UploadActionsModal } from "../components/UploadActionsModal";

export function FileManagerPage() {
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: "Мои файлы" }]);
  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [files, setFiles] = useState<FileDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [detailsFile, setDetailsFile] = useState<FileDto | null>(null);
  const [detailsSessionId, setDetailsSessionId] = useState<string | null>(null);
  const [detailsTab, setDetailsTab] = useState<"info" | "chat">("info");
  const [versions, setVersions] = useState<FileVersionDto[]>([]);
  const [showCompress, setShowCompress] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileDto[] | null>(null);
  const [justUploaded, setJustUploaded] = useState<FileDto[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const currentFolderId = path[path.length - 1].id;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listFolder(currentFolderId);
      setFolders(data.folders);
      setFiles(data.files);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось получить список файлов");
    } finally {
      setLoading(false);
    }
  }, [currentFolderId]);

  useEffect(() => {
    load();
    setSelected(new Set());
  }, [load]);

  // Errors are transient by nature (a retry or an unrelated successful action
  // usually follows) — without this, a stale message from one failed request
  // could sit on screen indefinitely through everything that happens after.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    api.agentStatus().then((s) => setAiEnabled(s.aiEnabled)).catch(() => setAiEnabled(false));
  }, []);

  useEffect(() => {
    setDetailsSessionId(null);
    if (detailsFile) {
      api.fileVersions(detailsFile.id).then((r) => setVersions(r.versions));
      api.getOrCreateSession(detailsFile.id).then((r) => setDetailsSessionId(r.sessionId));
    }
  }, [detailsFile]);

  function openFolder(folder: FolderDto) {
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
  }
  function navigateCrumb(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    try {
      const { files: uploaded } = await api.upload(Array.from(fileList), currentFolderId);
      await load();
      setJustUploaded(uploaded);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить файлы на сервер");
    }
  }

  const handleJobQueued = useCallback(() => {
    setSelected(new Set());
    setTimeout(load, 1500);
  }, [load]);

  async function handleNewFolder() {
    const name = prompt("Название новой папки:");
    if (!name) return;
    try {
      await api.createFolder(name, currentFolderId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать папку");
    }
  }

  async function handleRename(file: FileDto) {
    const name = prompt("Новое имя файла:", file.name);
    if (!name || name === file.name) return;
    await api.renameFile(file.id, name);
    await load();
  }

  async function handleTrash(file: FileDto) {
    await api.trashFile(file.id);
    setDetailsFile(null);
    await load();
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const { files } = await api.search(searchQuery.trim());
    setSearchResults(files);
  }

  const selectedFiles = files.filter((f) => selected.has(f.id));
  const displayedFiles = searchResults ?? files;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className={`flex-1 flex-col overflow-hidden ${detailsFile ? "hidden sm:flex" : "flex"}`}>
        <div className="p-4 border-b bg-white flex items-center justify-between gap-3 flex-wrap">
          {searchResults ? (
            <div className="text-sm text-gray-600">
              Результаты поиска «{searchQuery}»{" "}
              <button
                className="text-brand-600 hover:underline ml-2"
                onClick={() => {
                  setSearchResults(null);
                  setSearchQuery("");
                }}
              >
                Сбросить
              </button>
            </div>
          ) : (
            <Breadcrumbs path={path} onNavigate={navigateCrumb} />
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Поиск…"
              className="border rounded px-3 py-1.5 text-sm w-28 sm:w-48"
            />
            <button onClick={handleNewFolder} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 whitespace-nowrap">
              + Папка
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 whitespace-nowrap"
            >
              Загрузить
            </button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUpload(e.target.files)} />
          </div>
        </div>

        {selected.size > 0 && (
          <div className="px-4 py-2 bg-brand-50 border-b flex items-center gap-3 flex-wrap text-sm">
            <span>Выбрано: {selected.size}</span>
            <button onClick={() => setShowCompress(true)} className="px-3 py-1 border rounded hover:bg-white">
              Сжать
            </button>
            <button onClick={() => setShowConvert(true)} className="px-3 py-1 border rounded hover:bg-white">
              Конвертировать
            </button>
            <button
              onClick={async () => {
                for (const id of selected) await api.trashFile(id);
                setSelected(new Set());
                await load();
              }}
              className="px-3 py-1 border rounded hover:bg-white text-red-600"
            >
              Удалить
            </button>
          </div>
        )}

        {error && (
          <div className="px-4 py-2 text-sm text-red-600 bg-red-50 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700 shrink-0">
              ×
            </button>
          </div>
        )}

        <div
          className="flex-1 overflow-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleUpload(e.dataTransfer.files);
          }}
        >
          {loading ? (
            <div className="p-8 text-center text-gray-400">Загрузка…</div>
          ) : (
            <table className="w-full text-sm min-w-[480px]">
              <thead className="text-left text-gray-500 border-b sticky top-0 bg-white">
                <tr>
                  <th className="w-8"></th>
                  <th className="py-2">Название</th>
                  <th>Размер</th>
                  <th className="hidden sm:table-cell">Изменён</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!searchResults &&
                  folders.map((folder) => (
                    <tr key={folder.id} className="border-b hover:bg-gray-50 cursor-pointer" onDoubleClick={() => openFolder(folder)}>
                      <td></td>
                      <td className="py-2 flex items-center gap-2" onClick={() => openFolder(folder)}>
                        <span>📁</span> {folder.name}
                      </td>
                      <td>—</td>
                      <td className="hidden sm:table-cell">—</td>
                      <td></td>
                    </tr>
                  ))}
                {displayedFiles.map((file) => (
                  <tr key={file.id} className={`border-b hover:bg-gray-50 ${detailsFile?.id === file.id ? "bg-brand-50" : ""}`}>
                    <td className="pl-2">
                      <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggleSelect(file.id)} />
                    </td>
                    <td className="py-2 cursor-pointer" onClick={() => setDetailsFile(file)}>
                      <span className="mr-2">{iconFor(file.mimeType)}</span>
                      {file.name}
                      {file.lastAuthor === "AGENT" && (
                        <span className="ml-2 text-xs bg-purple-100 text-purple-700 rounded px-1.5 py-0.5">ИИ</span>
                      )}
                    </td>
                    <td>{formatBytes(file.sizeBytes)}</td>
                    <td className="hidden sm:table-cell">{formatDate(file.updatedAt)}</td>
                    <td className="pr-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => navigate(`/agent?fileId=${file.id}`)}
                        className="text-purple-600 hover:underline text-xs"
                        title="Открыть в ИИ-агенте"
                      >
                        ИИ
                      </button>
                      <a href={api.downloadUrl(file.id)} className="text-brand-600 hover:underline text-xs">
                        Скачать
                      </a>
                      <button onClick={() => handleRename(file)} className="text-gray-500 hover:underline text-xs hidden sm:inline">
                        Переим.
                      </button>
                      <button onClick={() => handleTrash(file)} className="text-red-500 hover:underline text-xs">
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && folders.length === 0 && displayedFiles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-12">
                      Здесь пока пусто. Перетащите файлы сюда или нажмите «Загрузить».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detailsFile && (
        <div className="w-full sm:w-96 border-l bg-white flex flex-col">
          <div className="border-b flex items-center">
            <button onClick={() => setDetailsFile(null)} className="sm:hidden px-3 text-gray-500">
              ← Назад
            </button>
            <button
              onClick={() => setDetailsTab("info")}
              className={`flex-1 py-2 text-sm ${detailsTab === "info" ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}
            >
              Сведения
            </button>
            <button
              onClick={() => setDetailsTab("chat")}
              className={`flex-1 py-2 text-sm ${detailsTab === "chat" ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}
            >
              ИИ-агент
            </button>
            <button onClick={() => setDetailsFile(null)} className="hidden sm:block px-3 text-gray-400 hover:text-gray-700">
              ×
            </button>
          </div>

          {detailsTab === "info" ? (
            <div className="p-4 space-y-4 overflow-y-auto text-sm">
              <div>
                <div className="font-medium break-words">{detailsFile.name}</div>
                <div className="text-gray-500">{detailsFile.mimeType}</div>
              </div>
              <dl className="space-y-1 text-gray-600">
                <div className="flex justify-between">
                  <dt>Размер</dt>
                  <dd>{formatBytes(detailsFile.sizeBytes)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Создан</dt>
                  <dd>{formatDate(detailsFile.createdAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Изменён</dt>
                  <dd>{formatDate(detailsFile.updatedAt)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Автор изменения</dt>
                  <dd>{detailsFile.lastAuthor === "AGENT" ? "ИИ-агент" : "Пользователь"}</dd>
                </div>
              </dl>

              <div>
                <h3 className="font-medium mb-2">История версий</h3>
                <ul className="space-y-1 max-h-48 overflow-y-auto">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between text-xs text-gray-600 border-b py-1">
                      <span>
                        {formatDate(v.createdAt)} · {formatBytes(v.sizeBytes)} · {v.authoredBy === "AGENT" ? "ИИ" : "Пользователь"}
                        {v.note ? ` — ${v.note}` : ""}
                      </span>
                      <button
                        onClick={async () => {
                          await api.restoreVersion(detailsFile.id, v.id);
                          const updated = await api.listFolder(currentFolderId);
                          setFiles(updated.files);
                          const fresh = updated.files.find((f) => f.id === detailsFile.id);
                          if (fresh) setDetailsFile(fresh);
                        }}
                        className="text-brand-600 hover:underline"
                      >
                        Восстановить
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            detailsSessionId && <ChatPanel sessionId={detailsSessionId} aiEnabled={aiEnabled} onFilesChanged={load} />
          )}
        </div>
      )}

      {showCompress && <CompressWizard files={selectedFiles} onClose={() => setShowCompress(false)} onQueued={handleJobQueued} />}
      {showConvert && <ConvertWizard files={selectedFiles} onClose={() => setShowConvert(false)} onQueued={handleJobQueued} />}

      {justUploaded && (
        <UploadActionsModal
          files={justUploaded}
          onClose={() => setJustUploaded(null)}
          onCompress={() => {
            setSelected(new Set(justUploaded.map((f) => f.id)));
            setJustUploaded(null);
            setShowCompress(true);
          }}
          onConvert={() => {
            setSelected(new Set(justUploaded.map((f) => f.id)));
            setJustUploaded(null);
            setShowConvert(true);
          }}
          onOpenChat={(file) => {
            setJustUploaded(null);
            navigate(`/agent?fileId=${file.id}`);
          }}
        />
      )}
    </div>
  );
}
