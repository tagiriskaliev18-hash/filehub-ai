import { useEffect, useState } from "react";
import type { FileDto } from "@filehub/shared";
import { api } from "../lib/api";
import { formatBytes, formatDate } from "../lib/format";

export function TrashPage() {
  const [files, setFiles] = useState<FileDto[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { files } = await api.listTrash();
    setFiles(files);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function restore(id: string) {
    await api.restoreFile(id);
    await load();
  }
  async function deleteForever(id: string) {
    if (!confirm("Удалить файл безвозвратно? Это действие нельзя отменить.")) return;
    await api.deleteFileForever(id);
    await load();
  }

  async function emptyAll() {
    if (!confirm(`Удалить все ${files.length} файл(ов) из корзины безвозвратно? Это действие нельзя отменить.`)) return;
    await api.emptyTrash();
    await load();
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Корзина</h1>
        {files.length > 0 && (
          <button onClick={emptyAll} className="text-sm text-red-600 hover:underline">
            Очистить корзину
          </button>
        )}
      </div>
      {loading ? (
        <div className="text-gray-400">Загрузка…</div>
      ) : files.length === 0 ? (
        <div className="text-gray-400">Корзина пуста.</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow-sm">
        <table className="w-full text-sm min-w-[500px]">
          <thead className="text-left text-gray-500 border-b">
            <tr>
              <th className="py-2 px-3">Название</th>
              <th>Размер</th>
              <th>Удалён</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b">
                <td className="py-2 px-3">{f.name}</td>
                <td>{formatBytes(f.sizeBytes)}</td>
                <td>{f.deletedAt ? formatDate(f.deletedAt) : "—"}</td>
                <td className="text-right px-3 space-x-3">
                  <button onClick={() => restore(f.id)} className="text-brand-600 hover:underline">
                    Восстановить
                  </button>
                  <button onClick={() => deleteForever(f.id)} className="text-red-600 hover:underline">
                    Удалить навсегда
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
