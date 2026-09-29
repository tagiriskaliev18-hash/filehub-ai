import { useEffect, useState } from "react";
import type { AuditLogDto, UserDto } from "@filehub/shared";
import { api } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";

type Tab = "users" | "audit" | "stats" | "conversion";

export function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto w-full">
      <h1 className="text-lg font-semibold mb-4">Администрирование</h1>
      <div className="flex gap-4 border-b mb-4 text-sm overflow-x-auto whitespace-nowrap">
        {(["users", "audit", "stats", "conversion"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 ${tab === t ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500"}`}
          >
            {{ users: "Пользователи", audit: "Журнал действий", stats: "Статистика", conversion: "Форматы конвертации" }[t]}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "stats" && <StatsTab />}
      {tab === "conversion" && <ConversionTab />}
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<UserDto[]>([]);

  async function load() {
    setUsers((await api.adminUsers()).users);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleRole(u: UserDto) {
    await api.adminUpdateUser(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" });
    await load();
  }
  async function toggleBlocked(u: UserDto, blocked: boolean) {
    await api.adminUpdateUser(u.id, { isBlocked: blocked });
    await load();
  }
  async function setQuota(u: UserDto) {
    const gb = prompt("Квота хранилища, ГБ:", String(Math.round(u.storageQuotaBytes / (1024 * 1024 * 1024))));
    if (!gb) return;
    await api.adminUpdateUser(u.id, { storageQuotaBytes: Number(gb) * 1024 * 1024 * 1024 });
    await load();
  }

  return (
    <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
      <table className="w-full text-sm min-w-[560px]">
        <thead className="text-left text-gray-500 border-b">
          <tr>
            <th className="py-2 px-3">Email</th>
            <th>Роль</th>
            <th>Хранилище</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2 px-3">{u.email}</td>
              <td>{u.role}</td>
              <td>
                {formatBytes(u.storageUsedBytes)} / {formatBytes(u.storageQuotaBytes)}
              </td>
              <td>{u.isBlocked ? <span className="text-red-600">Заблокирован</span> : "Активен"}</td>
              <td className="text-right px-3 space-x-3 whitespace-nowrap">
                <button onClick={() => toggleRole(u)} className="text-brand-600 hover:underline">
                  Сменить роль
                </button>
                <button onClick={() => setQuota(u)} className="text-brand-600 hover:underline">
                  Квота
                </button>
                <button onClick={() => toggleBlocked(u, !u.isBlocked)} className="text-red-600 hover:underline">
                  {u.isBlocked ? "Разблокировать" : "Заблокировать"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const [entries, setEntries] = useState<AuditLogDto[]>([]);
  useEffect(() => {
    api.adminAuditLog().then((r) => setEntries(r.entries));
  }, []);

  return (
    <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
      <table className="w-full text-sm min-w-[560px]">
        <thead className="text-left text-gray-500 border-b">
          <tr>
            <th className="py-2 px-3">Время</th>
            <th>Пользователь</th>
            <th>Действие</th>
            <th>Объект</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b">
              <td className="py-2 px-3 whitespace-nowrap">{formatDate(e.createdAt)}</td>
              <td>{e.userEmail ?? "—"}</td>
              <td>{e.action}</td>
              <td>
                {e.targetType} {e.targetId ? `#${e.targetId.slice(0, 8)}` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.adminStats>> | null>(null);
  useEffect(() => {
    api.adminStats().then(setStats);
  }, []);
  if (!stats) return <div className="text-gray-400">Загрузка…</div>;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      <StatCard label="Пользователей" value={String(stats.userCount)} />
      <StatCard label="Файлов" value={String(stats.fileCount)} />
      <StatCard label="Занято хранилища" value={formatBytes(stats.totalStorageBytes)} />
      {stats.jobCounts.map((j) => (
        <StatCard key={`${j.type}-${j.status}`} label={`${j.type} · ${j.status}`} value={String(j.count)} />
      ))}
    </div>
  );
}
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-gray-500">{label}</div>
    </div>
  );
}

function ConversionTab() {
  const [fullMatrix, setFullMatrix] = useState<Record<string, string[]>>({});
  const [disabled, setDisabled] = useState<Set<string>>(new Set());

  async function load() {
    const r = await api.adminConversionSettings();
    setFullMatrix(r.fullMatrix);
    setDisabled(new Set(r.disabled));
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(pair: string) {
    const next = new Set(disabled);
    if (next.has(pair)) next.delete(pair);
    else next.add(pair);
    setDisabled(next);
    await api.adminSetConversionSettings(Array.from(next));
  }

  return (
    <div className="space-y-4">
      {Object.entries(fullMatrix).map(([category, formats]) => (
        <div key={category} className="bg-white rounded-lg shadow-sm p-4">
          <div className="font-medium mb-2">{category}</div>
          <div className="flex flex-wrap gap-3 text-sm">
            {formats.map((f) => {
              const pair = `${category}:${f}`;
              const isDisabled = disabled.has(pair);
              return (
                <label key={f} className="flex items-center gap-1">
                  <input type="checkbox" checked={!isDisabled} onChange={() => toggle(pair)} />
                  {f.toUpperCase()}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
