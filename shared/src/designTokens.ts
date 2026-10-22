/**
 * Design token data shared by the browser extension and the VS Code gateway.
 *
 * This module intentionally contains **data only**: plain string maps plus one
 * pure serializer. It carries no runtime behaviour, no DOM access and no
 * dependency on either package's build tooling, which is what makes it safe to
 * live in `shared` next to `branding.json` and `bridgeProtocol.json`.
 *
 * What is deliberately NOT here:
 * - `@property` registrations. Those are a browser-only concern and belong to
 *   the extension's token layer.
 * - Component or layout rules. Each surface keeps its own structure; only the
 *   values are shared.
 *
 * Naming is semantic (`--wc-surface`, `--wc-danger`), never visual, so a reader
 * can map a gateway colour to its extension counterpart by name alone.
 */

export type DesignTokenTheme = "light" | "dark";

/**
 * Colour tokens per theme.
 *
 * The gateway bridge page is dark-only today and reads `dark`; the extension
 * uses both themes. Sharing both keeps a single source of truth so the two
 * surfaces cannot silently diverge.
 */
export const DESIGN_TOKENS: Record<DesignTokenTheme, Readonly<Record<string, string>>> = {
  light: {
    "--wc-surface": "oklch(1 0 0)",
    "--wc-surface-raised": "oklch(0.977 0.004 250)",
    "--wc-on-surface": "oklch(0.32 0.01 260)",
    "--wc-on-surface-muted": "oklch(0.45 0.012 260)",
    "--wc-border": "oklch(0.9 0.005 250)",
    "--wc-accent": "oklch(0.55 0.18 250)",
    "--wc-on-accent": "oklch(1 0 0)",
    "--wc-on-filled": "oklch(1 0 0)",
    "--wc-danger": "oklch(0.55 0.22 27)",
    "--wc-success": "oklch(0.49 0.13 155)",
    "--wc-warning": "oklch(0.47 0.14 62)",
    "--wc-focus-ring": "oklch(0.55 0.18 250)",
  },
  dark: {
    "--wc-surface": "oklch(0.22 0.012 258)",
    "--wc-surface-raised": "oklch(0.26 0.012 258)",
    "--wc-on-surface": "oklch(0.93 0.005 260)",
    "--wc-on-surface-muted": "oklch(0.72 0.01 260)",
    "--wc-border": "oklch(0.36 0.012 258)",
    "--wc-accent": "oklch(0.62 0.17 250)",
    "--wc-on-accent": "oklch(1 0 0)",
    "--wc-on-filled": "oklch(1 0 0)",
    "--wc-danger": "oklch(0.66 0.19 27)",
    "--wc-success": "oklch(0.66 0.15 155)",
    "--wc-warning": "oklch(0.75 0.14 72)",
    "--wc-focus-ring": "oklch(0.72 0.15 250)",
  },
};

/**
 * Theme-independent metrics: spacing, radius, duration, type scale.
 */
export const DESIGN_TOKEN_METRICS: Readonly<Record<string, string>> = {
  "--wc-space-1": "4px",
  "--wc-space-2": "8px",
  "--wc-space-3": "12px",
  "--wc-space-4": "16px",
  "--wc-space-5": "24px",
  "--wc-radius-sm": "6px",
  "--wc-radius-md": "8px",
  "--wc-radius-lg": "12px",
  "--wc-dur-fast": "120ms",
  "--wc-dur-base": "200ms",
  "--wc-text-xs": "11px",
  "--wc-text-sm": "12px",
  "--wc-text-md": "13px",
  "--wc-text-lg": "14px",
  "--wc-leading-tight": "1.3",
  "--wc-leading-normal": "1.45",
};

/**
 * Font stacks.
 *
 * CJK fallbacks are explicit because relying on the OS default resolves to
 * SimSun on some Windows setups, which is unreadable at 11-12px.
 */
export const DESIGN_TOKEN_FONTS: Readonly<Record<string, string>> = {
  "--wc-font-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
  "--wc-font-mono": 'ui-monospace, "SFMono-Regular", Consolas, Menlo, monospace',
};

/**
 * Serialize a token map into CSS declarations.
 *
 * Pure function, no I/O. Callers embed the result in their own stylesheet so
 * each package keeps full control over selectors and cascade position.
 */
export function toCssDeclarations(values: Readonly<Record<string, string>>): string {
  return Object.entries(values)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
}
