import type { FileDto } from "@filehub/shared";
import { iconFor } from "../lib/fileIcons";
import { formatBytes } from "../lib/format";
import { MindIcon } from "./MindIcon";

interface Props {
  files: FileDto[];
  onClose: () => void;
  onCompress: () => void;
  onConvert: () => void;
  onOpenChat: (file: FileDto) => void;
}

// Shown right after an upload finishes — surfaces the obvious next steps
// (ТЗ-requested "suggest what to do with the file") instead of leaving the
// user to discover compression/conversion/AI-chat on their own.
export function UploadActionsModal({ files, onClose, onCompress, onConvert, onOpenChat }: Props) {
  if (files.length === 0) return null;
  const single = files.length === 1 ? files[0] : null;

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="fh-card mt-bounce-in p-6 w-full max-w-md space-y-4">
        <div>
          <h2 className="text-lg font-semibold mt-gradient-text inline-block">
            {files.length === 1 ? "Файл загружен" : `Загружено файлов: ${files.length}`}
          </h2>
          <p className="text-sm text-gray-500 mt-1">Что сделать дальше?</p>
        </div>

        <ul className="max-h-32 overflow-y-auto space-y-1 text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-gray-700">
              <MindIcon name={iconFor(f.mimeType)} />
              <span className="truncate flex-1">{f.name}</span>
              <span className="text-gray-400 text-xs">{formatBytes(f.sizeBytes)}</span>
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-1 gap-2">
          {single && (
            <button
              onClick={() => onOpenChat(single)}
              className="flex items-center gap-3 border rounded-lg px-4 py-3 text-sm text-left hover:bg-brand-50 hover:border-brand-300 mt-3d" data-mt-tilt
            >
              <MindIcon name="bot" className="text-xl" />
              <span>
                <span className="block font-medium">Открыть в ИИ-агенте</span>
                <span className="block text-gray-500 text-xs">Отредактировать, суммаризировать, задать вопрос</span>
              </span>
            </button>
          )}
          <button
            onClick={onCompress}
            className="flex items-center gap-3 border rounded-lg px-4 py-3 text-sm text-left hover:bg-brand-50 hover:border-brand-300 mt-3d" data-mt-tilt
          >
            <MindIcon name="compress" className="text-xl" />
            <span>
              <span className="block font-medium">Сжать до нужного размера</span>
              <span className="block text-gray-500 text-xs">Уменьшить размер файла перед отправкой</span>
            </span>
          </button>
          <button
            onClick={onConvert}
            className="flex items-center gap-3 border rounded-lg px-4 py-3 text-sm text-left hover:bg-brand-50 hover:border-brand-300 mt-3d" data-mt-tilt
          >
            <MindIcon name="refresh" className="text-xl" />
            <span>
              <span className="block font-medium">Конвертировать формат</span>
              <span className="block text-gray-500 text-xs">Преобразовать в другой формат файла</span>
            </span>
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded">
            Просто загрузить, без действий
          </button>
        </div>
      </div>
    </div>
  );
}
