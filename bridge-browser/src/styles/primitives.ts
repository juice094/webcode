/**
 * Cross-surface primitives built on top of the semantic tokens.
 *
 * Every rule here must stay declarative: no runtime style computation, no
 * layout-triggering animation, and no per-surface overrides. A surface opts in
 * by including PRIMITIVE_STYLES in its style block.
 *
 * Keep this file small. The budget is 15KB uncompressed for tokens+primitives.
 */

/**
 * Shared focus treatment.
 *
 * `:where()` keeps specificity at zero so surfaces can still override the ring
 * for special cases (for example an inverted ring on a dark overlay) without
 * needing extra specificity hacks.
 */
export const FOCUS_RING_STYLES = `
  :where(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
    outline: 2px solid var(--wc-focus-ring);
    outline-offset: 2px;
  }
`;

/**
 * Native control theming plus interaction defaults shared by every surface.
 */
export const BASE_CONTROL_STYLES = `
  :root, :host {
    accent-color: var(--wc-accent);
  }

  :where(button, input, select, textarea) {
    font: inherit;
  }

  :where(button):disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
`;

/**
 * Motion and accessibility fallbacks.
 *
 * The reduced-motion rule is intentionally broad: a surface that forgets its
 * own media query must still lose animation rather than fail the a11y gate.
 */
export const PREFERENCE_STYLES = `
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 1ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 1ms !important;
      scroll-behavior: auto !important;
    }
  }

  @media (forced-colors: active) {
    :where(button, input, select, textarea, .wc-card) {
      border-color: CanvasText;
    }

    :where(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
      outline-color: Highlight;
    }

    :where(button):disabled {
      color: GrayText;
    }
  }

  @media (prefers-contrast: more) {
    :root, :host {
      --wc-border: currentColor;
    }

    :where(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])):focus-visible {
      outline-width: 3px;
    }
  }
`;

/**
 * Visually hidden but still exposed to assistive technology.
 * Used for labels that must not change the visual layout.
 */
export const VISUALLY_HIDDEN_STYLES = `
  .wc-visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
`;

/**
 * Single export so a surface can adopt the whole primitive layer with one
 * template interpolation and reviewers can see the full weight in one place.
 */
export const PRIMITIVE_STYLES = [
  FOCUS_RING_STYLES,
  BASE_CONTROL_STYLES,
  PREFERENCE_STYLES,
  VISUALLY_HIDDEN_STYLES,
].join("\n");
