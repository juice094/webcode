/**
 * Single entry point for every shadow-root or injected style block.
 *
 * Surfaces must compose their own rules onto SHARED_STYLES instead of
 * re-declaring tokens. Keeping one import site means a new surface cannot
 * silently skip the token layer, which is how the earlier hardcoded styles
 * accumulated.
 *
 * SHARED_STYLES contains:
 * - `@property` registrations and token values (light + dark)
 * - focus ring, native control theming, reduced-motion and forced-colors
 * - base typography bound to the font and size tokens
 */

import { PRIMITIVE_STYLES } from "./primitives";
import { TOKEN_STYLES } from "./tokens";

/**
 * Base typography.
 *
 * Declared after the tokens so `:host` blocks in a surface can still opt out
 * for a specific element. Font stacks include CJK fallbacks because the
 * previous stacks relied on the OS default, which resolves to SimSun on some
 * Windows setups and is unreadable at 10-11px.
 */
export const TYPOGRAPHY_STYLES = `
  :root, :host {
    font-family: var(--wc-font-sans);
    font-size: var(--wc-text-md);
    line-height: var(--wc-leading-normal);
  }

  code, kbd, pre, samp, textarea.mono {
    font-family: var(--wc-font-mono);
  }
`;

export const SHARED_STYLES = [
  TOKEN_STYLES,
  PRIMITIVE_STYLES,
  TYPOGRAPHY_STYLES,
].join("\n");
