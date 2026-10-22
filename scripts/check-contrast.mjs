#!/usr/bin/env node
/**
 * WCAG 2.2 contrast checker for the oklch design tokens.
 *
 * The token layer stores colours as oklch(), which no existing WCAG tool reads
 * directly. This converts oklch -> oklab -> linear sRGB -> sRGB exactly as the
 * CSS Color 4 spec defines it, then applies the WCAG 2.x relative luminance
 * formula to the 8-bit sRGB result.
 *
 * Thresholds (WCAG 2.2 AA):
 *   4.5:1 for body text, 3:1 for large text (>=18.66px bold or >=24px).
 */

/** oklch -> sRGB triplet in 0..1, clamped. */
function oklchToSrgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const linR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const linG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const linB = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [encodeSrgb(linR), encodeSrgb(linG), encodeSrgb(linB)];
}

/** Linear light -> sRGB gamma, then clamp to the displayable range. */
function encodeSrgb(linear) {
  const value = linear <= 0.0031308
    ? 12.92 * linear
    : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, value));
}

/** WCAG 2.x relative luminance from an sRGB triplet in 0..1. */
function relativeLuminance([r, g, b]) {
  const channel = (value) => (value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Token table mirroring shared/src/designTokens.ts. */
const TOKENS = {
  light: {
    surface: [1, 0, 0],
    surfaceRaised: [0.977, 0.004, 250],
    onSurface: [0.32, 0.01, 260],
    onSurfaceMuted: [0.45, 0.012, 260],
    border: [0.9, 0.005, 250],
    accent: [0.53, 0.18, 250],
    onAccent: [1, 0, 0],
    onFilled: [1, 0, 0],
    danger: [0.55, 0.22, 27],
    success: [0.49, 0.13, 155],
    warning: [0.47, 0.14, 62],
  },
  dark: {
    surface: [0.22, 0.012, 258],
    surfaceRaised: [0.26, 0.012, 258],
    onSurface: [0.93, 0.005, 260],
    onSurfaceMuted: [0.72, 0.01, 260],
    border: [0.36, 0.012, 258],
    accent: [0.68, 0.17, 250],
    onAccent: [0.18, 0.01, 260],
    onFilled: [0.18, 0.01, 260],
    danger: [0.66, 0.19, 27],
    success: [0.66, 0.15, 155],
    warning: [0.75, 0.14, 72],
  },
};

/** Real foreground/background pairs used by the approval dialog and popup. */
const PAIRS = [
  ["onSurface", "surface", "body text on card", 4.5],
  ["onSurface", "surfaceRaised", "value text on raised block", 4.5],
  ["onSurfaceMuted", "surface", "label (uppercase 12px 600)", 4.5],
  ["onSurfaceMuted", "surfaceRaised", "hint text on raised block", 4.5],
  ["danger", "surface", "dialog title / tool name", 4.5],
  ["accent", "surfaceRaised", "purpose text", 4.5],
  ["warning", "surfaceRaised", "scope warning", 4.5],
  ["onFilled", "danger", "reject hover / error button label", 4.5],
  ["onFilled", "success", "approve button label", 4.5],
  ["onFilled", "warning", "always-allow button label", 4.5],
  ["onAccent", "accent", "scope approve button label", 4.5],
];

let failures = 0;

for (const [themeName, theme] of Object.entries(TOKENS)) {
  console.log(`\n=== ${themeName} ===`);
  for (const [fgName, bgName, label, threshold] of PAIRS) {
    const fg = oklchToSrgb(...theme[fgName]);
    const bg = oklchToSrgb(...theme[bgName]);
    const ratio = contrastRatio(fg, bg);
    const pass = ratio >= threshold;
    if (!pass) {failures += 1;}
    console.log(
      `${pass ? "PASS" : "FAIL"}  ${ratio.toFixed(2)}:1  (need ${threshold})  ${label}`
    );
  }
}

console.log(`\n${failures === 0 ? "all pairs pass" : `${failures} pair(s) below threshold`}`);
process.exit(failures === 0 ? 0 : 1);
