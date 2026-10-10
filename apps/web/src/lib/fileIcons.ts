import type { MindIconName } from "../components/MindIcon";

// Иконка Mind для типа файла (раньше здесь были эмодзи).
const FILE_ICONS: Record<string, MindIconName> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "template",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "chart",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "table",
  "application/pdf": "file-pdf",
  "application/zip": "archive",
};

export function iconFor(mime: string): MindIconName {
  if (FILE_ICONS[mime]) return FILE_ICONS[mime];
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "film";
  if (mime.startsWith("audio/")) return "music";
  return "file";
}
