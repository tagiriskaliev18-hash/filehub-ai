import { useEffect, useRef, useState } from "react";
import type { FileDto } from "@filehub/shared";
import { categoryForMime } from "@filehub/shared";
import { api, ApiError } from "../../lib/api";
import { useJobPolling, ProgressBar } from "../../components/JobProgress";

export function ConvertWizard({ files, onClose, onQueued }: { files: FileDto[]; onClose: () => void; onQueued: () => void }) {
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [libreOfficeAvailable, setLibreOfficeAvailable] = useState(true);
  const [targetFormat, setTargetFormat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobPolling(jobId);
  // See CompressWizard for why this guard exists: onQueued is an inline prop
  // that gets a new identity every parent re-render, which would otherwise
  // re-fire this effect (and re-schedule another delayed refresh) repeatedly
  // for as long as job.status stays "done".
  const firedForJobId = useRef<string | null>(null);

  useEffect(() => {
    api.conversionMatrix().then((r) => {
      setMatrix(r.matrix);
      setLibreOfficeAvailable(r.libreOfficeAvailable);
    });
  }, []);

  useEffect(() => {
    if (job?.status === "done" && firedForJobId.current !== job.id) {
      firedForJobId.current = job.id;
      onQueued();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id]);

  const categories = files.map((f) => categoryForMime(f.mimeType));
  const allKnown = categories.every((c): c is string => c !== null);
  // A file's category can list its own extension as a valid target for
  // *other* formats in the same category (e.g. spreadsheet covers both xlsx
  // and csv) — but offering that extension back to a file already in it is a
  // same-format "conversion" that always fails. Exclude every selected
  // file's current extension from the choices so nothing offered can do that.
  const currentExtensions = new Set(files.map((f) => f.name.split(".").pop()?.toLowerCase()).filter(Boolean));
  const commonFormats = allKnown
    ? categories
        .reduce<string[]>((acc, cat, i) => (i === 0 ? matrix[cat] ?? [] : acc.filter((f) => (matrix[cat] ?? []).includes(f))), [])
        .filter((f) => !currentExtensions.has(f))
    : [];

  async function submit() {
    if (!targetFormat) return;
    setBusy(true);
    setError(null);
    try {
      const job = await api.convert(
        files.map((f) => f.id),
        targetFormat,
      );
      setJobId(job.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось поставить задачу конвертации");
    } finally {
      setBusy(false);
    }
  }

  if (jobId) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
          <h2 className="text-lg font-semibold">Конвертация файлов</h2>
          {!job || job.status === "queued" || job.status === "running" ? (
            <>
              <ProgressBar percent={job?.progress ?? 0} />
              <div className="text-sm text-gray-500 text-center">{job?.progress ?? 0}%</div>
            </>
          ) : job.status === "done" ? (
            <>
              <ProgressBar percent={100} />
              <div className="text-sm text-green-700">Готово! Файлы сконвертированы.</div>
            </>
          ) : (
            <div className="text-sm text-red-600 bg-red-50 rounded p-2">{job.errorMessage ?? "Не удалось сконвертировать файлы"}</div>
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
        <h2 className="text-lg font-semibold">Конвертировать формат</h2>
        <div className="text-sm text-gray-500">Файлов выбрано: {files.length}</div>

        {!allKnown && <div className="text-sm text-amber-700 bg-amber-50 rounded p-2">Один или несколько файлов не поддерживают конвертацию.</div>}
        {allKnown && commonFormats.length === 0 && (
          <div className="text-sm text-amber-700 bg-amber-50 rounded p-2">
            Нет общего целевого формата для всех выбранных файлов. Конвертируйте файлы разных типов по отдельности.
          </div>
        )}
        {!libreOfficeAvailable && (
          <div className="text-xs text-gray-400">
            Конвертация с участием PDF (Word/Excel/PowerPoint ↔ PDF, изображение ↔ PDF) недоступна: на сервере не
            установлен LibreOffice.
          </div>
        )}
        {error && <div className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</div>}

        {commonFormats.length > 0 && (
          <div>
            <label className="block text-sm text-gray-600 mb-1">Целевой формат</label>
            <select
              value={targetFormat}
              onChange={(e) => setTargetFormat(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm"
            >
              <option value="">Выберите формат</option>
              {commonFormats.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={busy || !targetFormat}
            className="px-4 py-2 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Отправка…" : "Конвертировать"}
          </button>
        </div>
      </div>
    </div>
  );
}
