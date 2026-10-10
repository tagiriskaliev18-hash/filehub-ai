// Иконка Mind: обводка, залитая переливающимся фиолетово-синим градиентом.
// Рисуется классами .mi .mi-<имя> из src/styles/mind-ui.css (MindKit) и mind-icons-extra.css.
export type MindIconName =
  | "folder"
  | "bot"
  | "trash"
  | "settings"
  | "chevron-down"
  | "back"
  | "close"
  | "attach"
  | "upload"
  | "send"
  | "download"
  | "refresh"
  | "plus"
  | "search"
  | "sparkles"
  | "edit"
  | "file"
  | "image"
  | "chart"
  | "table"
  | "template"
  | "archive"
  | "check"
  | "alert"
  | "mind"
  // свои, из mind-icons-extra.css
  | "film"
  | "music"
  | "compress"
  | "file-pdf";

interface Props {
  name: MindIconName;
  /** mono — цветом текста, white — белая (для кнопок на градиенте) */
  variant?: "gradient" | "mono" | "white";
  className?: string;
  title?: string;
}

export function MindIcon({ name, variant = "gradient", className, title }: Props) {
  const cls = ["mi", `mi-${name}`, variant === "mono" ? "mi-mono" : variant === "white" ? "mi-white" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return title ? <i className={cls} role="img" aria-label={title} title={title} /> : <i className={cls} aria-hidden="true" />;
}
