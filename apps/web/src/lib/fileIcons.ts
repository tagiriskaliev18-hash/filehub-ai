const FILE_ICONS: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "📄",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "📊",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "📈",
  "application/pdf": "📕",
  "application/zip": "🗜️",
};

export function iconFor(mime: string): string {
  if (FILE_ICONS[mime]) return FILE_ICONS[mime];
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎞️";
  if (mime.startsWith("audio/")) return "🎵";
  return "📃";
}
