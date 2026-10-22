/**
 * Semantic design tokens shared by every webcode UI surface.
 *
 * Token *values* come from `@webcode/shared`, which is also consumed by the
 * VS Code gateway. That module holds data only; this file adds the one thing
 * that is browser-specific and must not leak into the gateway build:
 * `@property` registrations.
 *
 * `@property` registers document-wide even when declared inside a shadow root,
 * so it is emitted here once and embedded into each surface's style block. This
 * keeps the extension independent of the host page CSP.
 */

import {
  DESIGN_TOKEN_FONTS,
  DESIGN_TOKEN_METRICS,
  DESIGN_TOKENS,
  toCssDeclarations,
} from "@webcode/shared";

export const TOKEN_PROPERTY_REGISTRY = `
@property --wc-surface { syntax: "<color>"; inherits: true; initial-value: oklch(1 0 0); }
@property --wc-surface-raised { syntax: "<color>"; inherits: true; initial-value: oklch(0.977 0.004 250); }
@property --wc-on-surface { syntax: "<color>"; inherits: true; initial-value: oklch(0.32 0.01 260); }
@property --wc-on-surface-muted { syntax: "<color>"; inherits: true; initial-value: oklch(0.45 0.012 260); }
@property --wc-border { syntax: "<color>"; inherits: true; initial-value: oklch(0.9 0.005 250); }
@property --wc-accent { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0.18 250); }
@property --wc-on-accent { syntax: "<color>"; inherits: true; initial-value: oklch(1 0 0); }
@property --wc-on-filled { syntax: "<color>"; inherits: true; initial-value: oklch(1 0 0); }
@property --wc-danger { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0.22 27); }
@property --wc-success { syntax: "<color>"; inherits: true; initial-value: oklch(0.49 0.13 155); }
@property --wc-warning { syntax: "<color>"; inherits: true; initial-value: oklch(0.47 0.14 62); }
@property --wc-focus-ring { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0.18 250); }
@property --wc-space-1 { syntax: "<length>"; inherits: true; initial-value: 4px; }
@property --wc-space-2 { syntax: "<length>"; inherits: true; initial-value: 8px; }
@property --wc-space-3 { syntax: "<length>"; inherits: true; initial-value: 12px; }
@property --wc-space-4 { syntax: "<length>"; inherits: true; initial-value: 16px; }
@property --wc-space-5 { syntax: "<length>"; inherits: true; initial-value: 24px; }
@property --wc-radius-sm { syntax: "<length>"; inherits: true; initial-value: 6px; }
@property --wc-radius-md { syntax: "<length>"; inherits: true; initial-value: 8px; }
@property --wc-radius-lg { syntax: "<length>"; inherits: true; initial-value: 12px; }
@property --wc-dur-fast { syntax: "<time>"; inherits: true; initial-value: 120ms; }
@property --wc-dur-base { syntax: "<time>"; inherits: true; initial-value: 200ms; }
@property --wc-font-sans { syntax: "*"; inherits: true; initial-value: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; }
@property --wc-font-mono { syntax: "*"; inherits: true; initial-value: ui-monospace, "SFMono-Regular", Consolas, Menlo, monospace; }
@property --wc-text-xs { syntax: "<length>"; inherits: true; initial-value: 11px; }
@property --wc-text-sm { syntax: "<length>"; inherits: true; initial-value: 12px; }
@property --wc-text-md { syntax: "<length>"; inherits: true; initial-value: 13px; }
@property --wc-text-lg { syntax: "<length>"; inherits: true; initial-value: 14px; }
@property --wc-leading-tight { syntax: "<number>"; inherits: true; initial-value: 1.3; }
@property --wc-leading-normal { syntax: "<number>"; inherits: true; initial-value: 1.45; }
`;

/**
 * Token values for a single surface style block.
 *
 * Light is the default because the approval dialog renders on top of arbitrary
 * host pages. Dark surfaces opt in with `data-theme="dark"`.
 */
export const TOKEN_VALUES = `
  :root, :host {
    color-scheme: light;
${toCssDeclarations(DESIGN_TOKENS.light)}
${toCssDeclarations(DESIGN_TOKEN_METRICS)}
${toCssDeclarations(DESIGN_TOKEN_FONTS)}
  }

  :root[data-theme="dark"], :host([data-theme="dark"]) {
    color-scheme: dark;
${toCssDeclarations(DESIGN_TOKENS.dark)}
  }

  /* Follow the operating system unless a surface explicitly opts into a theme.
     Without this block the dark palette above was unreachable: no code ever set
     the data-theme attribute, so every surface rendered light on a dark desktop. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]):not([data-theme="dark"]),
    :host(:not([data-theme="light"]):not([data-theme="dark"])) {
      color-scheme: dark;
${toCssDeclarations(DESIGN_TOKENS.dark)}
    }
  }
`;

/**
 * Registry plus values, ready to embed in a shadow-root style block.
 */
export const TOKEN_STYLES = `${TOKEN_PROPERTY_REGISTRY}\n${TOKEN_VALUES}`;
