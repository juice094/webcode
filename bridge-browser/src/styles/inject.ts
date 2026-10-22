/**
 * Inject a shared style block into an extension page or a shadow root.
 *
 * Extension pages are not subject to a restrictive `style-src`, so a plain
 * `<style>` element is enough and avoids any runtime CSS parsing work beyond
 * what the browser already does for inline stylesheet text.
 *
 * Returns the created element so callers can replace or remove it later.
 */
export function injectStyleText(
  target: Document | ShadowRoot,
  text: string,
  marker: string
): HTMLStyleElement {
  const doc = target instanceof Document ? target : target.ownerDocument;
  const existing = target.querySelector<HTMLStyleElement>(`style[data-wc-style="${marker}"]`);
  if (existing) {
    existing.textContent = text;
    return existing;
  }

  const style = doc.createElement("style");
  style.dataset.wcStyle = marker;
  style.textContent = text;

  if (target instanceof Document) {
    (target.head ?? target.documentElement).appendChild(style);
  } else {
    target.appendChild(style);
  }

  return style;
}
