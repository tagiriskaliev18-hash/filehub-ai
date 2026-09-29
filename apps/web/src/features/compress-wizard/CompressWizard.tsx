import { useEffect, useRef, useState } from "react";
import type { FileDto } from "@filehub/shared";
import { api, ApiError } from "../../lib/api";
import { formatBytes } from "../../lib/format";
import { useJobPolling, ProgressBar } from "../../components/JobProgress";

export function CompressWizard({ files, onClose, onQueued }: { files: FileDto[]; onClose: () => void; onQueued: () => void }) {
  const [targetValue, setTargetValue] = useState(50);
  const [targetUnit, setTargetUnit] = useState<"MB" | "KB" | "PERCENT">("PERCENT");
  const [asNewFile, setAsNewFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobPolling(jobId);
  // onQueued is an inline callback from the parent, so it gets a new identity
  // on every parent re-render. Without this guard, the effect below would
  // re-fire (and re-schedule another delayed refresh) on every such
  // re-render for as long as job.status stays "done", stacking up duplicate
  // overlapping /api/files calls that race each other — the actual cause of
  // the file list flickering between an error and the correct contents.
  const firedForJobId = useRef<string | null>(null);

  useEffect(() => {
    if (job?.status === "done" && firedForJobId.current !== job.id) {
      firedForJobId.current = job.id;
      onQueued();
    }
    // onQueued intentionally excluded: it's an inline prop that changes
    // identity every render, and the ref guard above already makes this
    // effect fire exactly once per completed job regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const job = await api.compress(
        files.map((f) => f.id),
        targetValue,
        targetUnit,
        asNewFile,
      );
      setJobId(job.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось поставить задачу сжатия");
    } finally {
      setBusy(false);
    }
  }

  if (jobId) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Сжатие файлов</h2>
          {!job || job.status === "queued" || job.status === "running" ? (
            <>
              <ProgressBar percent={job?.progress ?? 0} />
              <div className="text-sm text-gray-500 text-center">{job?.progress ?? 0}%</div>
            </>
          ) : job.status === "done" ? (
            <>
              <ProgressBar percent={100} />
              <div className="text-sm text-green-700">Готово! Файлы сжаты.</div>
            </>
          ) : (
            <div className="text-sm text-red-600 bg-red-50 rounded p-2">{job.errorMessage ?? "Не удалось сжать файлы"}</div>
          )}
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              disabled={job?.status === "queued" || job?.status === "running"}
              className="px-4 py-2 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
            >
              {job?.status === "queued" || job?.status === "running" ? "Выполняется…" : "Закрыть"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
        <h2 className="text-lg font-semibold">Сжать до заданного размера</h2>
        <div className="text-sm text-gray-500">
          Файлов выбрано: {files.length}
          <ul className="mt-1 max-h-24 overflow-y-auto">
            {files.map((f) => (
              <li key={f.id}>
                {f.name} — {formatBytes(f.sizeBytes)}
              </li>
            ))}
          </ul>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</div>}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-sm text-gray-600 mb-1">Целевой размер</label>
            <input
              type="number"
              min={1}
              value={targetValue}
              onChange={(e) => setTargetValue(Number(e.target.value))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <select
            value={targetUnit}
            onChange={(e) => setTargetUnit(e.target.value as typeof targetUnit)}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="PERCENT">% от исходного</option>
            <option value="MB">МБ</option>
            <option value="KB">КБ</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={asNewFile} onChange={(e) => setAsNewFile(e.target.checked)} />
          Сохранить как отдельный файл (иначе — новая версия текущего файла)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Отправка…" : "Сжать"}
          </button>
        </div>
      </div>
    </div>
  );
}
