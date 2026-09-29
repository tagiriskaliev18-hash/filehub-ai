import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { JobDto } from "@filehub/shared";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import { useJobsPolling } from "../lib/useJobsPolling";
import { formatBytes } from "../lib/format";

interface JobFileResult {
  fileId: string;
  resultFileId: string;
  fileName: string;
}

// job.resultJson is a raw JSON string of `{ results: [...] }` — shaped
// differently per job type, but both compress and convert results always
// carry fileId/resultFileId, which is all the notification actions need.
function parseSingleJobResult(job: JobDto): JobFileResult | null {
  if (!job.resultJson) return null;
  try {
    const parsed = JSON.parse(job.resultJson) as { results?: JobFileResult[] };
    if (parsed.results?.length === 1) return parsed.results[0];
  } catch {
    // ignore malformed/unexpected result payloads
  }
  return null;
}

const NAV_ITEMS = [
  { to: "/", label: "Мои файлы", icon: "📁" },
  { to: "/agent", label: "ИИ-агент", icon: "🤖" },
  { to: "/trash", label: "Корзина", icon: "🗑️" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [aiEnabled, setAiEnabled] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actedOn, setActedOn] = useState<Record<string, string>>({});
  const { notifications, dismiss } = useJobsPolling(!!user);

  async function undoJob(jobId: string, result: JobFileResult) {
    try {
      if (result.resultFileId === result.fileId) {
        await api.undoLastChange(result.fileId);
        setActedOn((prev) => ({ ...prev, [jobId]: "Отменено — файл возвращён к прежней версии" }));
      } else {
        await api.trashFile(result.resultFileId);
        setActedOn((prev) => ({ ...prev, [jobId]: "Созданный файл удалён" }));
      }
    } catch (err) {
      setActedOn((prev) => ({ ...prev, [jobId]: err instanceof ApiError ? err.message : "Не удалось отменить" }));
    }
  }

  useEffect(() => {
    api.agentStatus().then((s) => setAiEnabled(s.aiEnabled)).catch(() => setAiEnabled(false));
  }, []);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const navItems = user?.role === "ADMIN" ? [...NAV_ITEMS, { to: "/admin", label: "Админ", icon: "⚙️" }] : NAV_ITEMS;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-6 min-w-0">
          <Link to="/" className="font-semibold text-lg text-brand-700 shrink-0">
            FileHub AI
          </Link>
          {/* Desktop nav — hidden on phones, replaced by the bottom tab bar there */}
          <nav className="hidden sm:flex gap-4 text-sm text-gray-600">
            {navItems.map((item) => (
              <Link key={item.to} to={item.to} className="hover:text-brand-600">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden sm:flex items-center gap-4 text-sm">
          {user && (
            <span className="text-gray-500 truncate max-w-[16rem]">
              {user.email} · {formatBytes(user.storageUsedBytes)} / {formatBytes(user.storageQuotaBytes)}
            </span>
          )}
          <button onClick={handleLogout} className="text-gray-500 hover:text-red-600 shrink-0">
            Выйти
          </button>
        </div>

        {/* Mobile: compact menu button instead of the full desktop nav/user bar */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="sm:hidden text-gray-600 border rounded px-2 py-1 text-sm"
          aria-label="Меню"
        >
          {user?.email ? user.email.split("@")[0] : "Меню"} ▾
        </button>
      </header>

      {menuOpen && (
        <div className="sm:hidden border-b bg-white px-4 py-3 text-sm space-y-2">
          {user && (
            <div className="text-gray-500">
              {user.email} · {formatBytes(user.storageUsedBytes)} / {formatBytes(user.storageQuotaBytes)}
            </div>
          )}
          <button
            onClick={() => {
              setMenuOpen(false);
              handleLogout();
            }}
            className="text-red-600"
          >
            Выйти
          </button>
        </div>
      )}

      {!aiEnabled && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs sm:text-sm text-amber-800">
          Режим деградации: ИИ-агент недоступен (не настроен ключ провайдера). Файловый менеджер, сжатие и конвертация
          работают в обычном режиме.
        </div>
      )}

      <div className="fixed bottom-20 sm:bottom-4 right-4 flex flex-col gap-2 z-50 max-w-xs">
        {notifications.map((n) => {
          const result = n.job.status === "done" ? parseSingleJobResult(n.job) : null;
          const feedback = actedOn[n.job.id];
          return (
            <div
              key={n.job.id}
              className={`rounded-lg shadow-lg px-4 py-3 text-sm text-white ${n.job.status === "done" ? "bg-green-600" : "bg-red-600"}`}
            >
              <div className="flex items-center justify-between gap-4">
                <span>
                  {n.job.type === "compress" ? "Сжатие" : "Конвертация"}: {n.job.status === "done" ? "завершено" : "ошибка"}
                  {result ? ` — ${result.fileName}` : ""}
                </span>
                <button onClick={() => dismiss(n.job.id)} className="opacity-70 hover:opacity-100 shrink-0">
                  ×
                </button>
              </div>
              {result &&
                (feedback ? (
                  <div className="text-xs mt-1 opacity-90">{feedback}</div>
                ) : (
                  <div className="flex gap-3 mt-2 text-xs">
                    <button onClick={() => undoJob(n.job.id, result)} className="underline opacity-90 hover:opacity-100">
                      {result.resultFileId === result.fileId ? "Отменить" : "Удалить результат"}
                    </button>
                    <button
                      onClick={() => navigate(`/agent?fileId=${result.resultFileId}`)}
                      className="underline opacity-90 hover:opacity-100"
                    >
                      Открыть в ИИ-агенте
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      <main className="flex-1 flex flex-col pb-16 sm:pb-0">{children}</main>

      {/* Bottom tab bar — the primary way to navigate on phones */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-white border-t flex z-40">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`flex-1 flex flex-col items-center py-2 text-xs ${active ? "text-brand-600" : "text-gray-500"}`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="mt-0.5">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
