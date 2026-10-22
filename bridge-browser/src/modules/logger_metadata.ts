import { i18n } from './i18n';

export const STANDARD_LOG_TYPES = ["info", "success", "warn", "error", "action"] as const;
export type LoggerLogType = "summary" | typeof STANDARD_LOG_TYPES[number];
export type LoggerFilterType = LoggerLogType | "all";

/**
 * Per-type label and glyph.
 *
 * Colour is deliberately absent: it is applied by CSS rules keyed on
 * `data-log-type` so the palette stays in the token layer and the logger never
 * writes inline styles. Glyphs are plain text characters rather than emoji
 * because emoji render at different sizes and colours across platforms and
 * cannot inherit `color`.
 */
export const LOG_TYPE_META: Record<
  LoggerLogType,
  { icon: string; label: { en: string; zh: string } }
> = {
  summary: { icon: "▸", label: { en: "Summary", zh: "摘要" } },
  info: { icon: "·", label: { en: "Info", zh: "信息" } },
  success: { icon: "✓", label: { en: "Success", zh: "成功" } },
  warn: { icon: "!", label: { en: "Warn", zh: "警告" } },
  error: { icon: "×", label: { en: "Error", zh: "错误" } },
  action: { icon: "▹", label: { en: "Action", zh: "操作" } },
};

export function getFilterLabel(type: LoggerFilterType): string {
  if (type === "all") {
    return i18n.lang === "zh" ? "全部" : "All";
  }

  const meta = LOG_TYPE_META[type];
  return `${meta.icon} ${meta.label[i18n.lang]}`;
}
