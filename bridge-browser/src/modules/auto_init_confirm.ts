import { SHARED_STYLES } from "../styles/shared";
import { i18n } from "./i18n";

/**
 * Confirmation dialog for adding initialization context.
 *
 * Styles now come from SHARED_STYLES so the palette, focus ring, reduced-motion
 * and forced-colors handling match the other surfaces. The previous Material
 * palette (#1a73e8 / #dadce0 / #202124) was a leftover from an unrelated design
 * system and made this dialog visually inconsistent with the rest of webcode.
 *
 * Kept as a manual overlay rather than `<dialog>` because this runs inside an
 * arbitrary host page and its Enter/Escape capture behavior is relied on by
 * callers. Migrating it to `<dialog>` is tracked separately.
 */
const AUTO_INIT_STYLES = `
  :host { all: initial; }
${SHARED_STYLES}
  *, *::before, *::after { box-sizing: border-box; }

  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: var(--wc-space-4);
    background: color-mix(in oklch, black 45%, transparent);
    font-family: var(--wc-font-sans);
  }

  .card {
    width: min(420px, calc(100vw - 2 * var(--wc-space-4)));
    padding: var(--wc-space-5);
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-lg);
    background: var(--wc-surface);
    color: var(--wc-on-surface);
    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
  }

  h2 {
    margin: 0 0 var(--wc-space-2);
    color: var(--wc-on-surface);
    font-size: calc(var(--wc-text-lg) * 1.29);
    font-weight: 650;
    line-height: var(--wc-leading-tight);
  }

  p {
    margin: 0;
    color: var(--wc-on-surface-muted);
    font-size: var(--wc-text-lg);
    line-height: var(--wc-leading-normal);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--wc-space-2);
    margin-top: var(--wc-space-5);
  }

  button {
    padding: var(--wc-space-2) var(--wc-space-3);
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-sm);
    background: var(--wc-surface-raised);
    color: var(--wc-on-surface);
    font-size: var(--wc-text-lg);
    font-weight: 600;
    cursor: pointer;
    transition: background-color var(--wc-dur-fast) ease-out;
  }

  button:hover { background: color-mix(in oklch, var(--wc-on-surface) 8%, var(--wc-surface-raised)); }

  .primary {
    border-color: var(--wc-accent);
    background: var(--wc-accent);
    color: var(--wc-on-accent);
  }

  .primary:hover { background: color-mix(in oklch, var(--wc-accent) 88%, black); }
`;

export function showAutoInitConfirm(): Promise<boolean> {
  return new Promise((resolve) => {
    const isZh = i18n.lang === "zh";
    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      zIndex: 999999,
      top: 0,
      left: 0,
      width: "0",
      height: "0",
    });
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = AUTO_INIT_STYLES;

    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="card" role="dialog" aria-modal="true">
        <h2>${isZh ? "添加 webcode 初始化上下文？" : "Add webcode initialization context?"}</h2>
        <p>${isZh ? "点击添加或按 Enter，将完整初始化上下文添加到当前输入框。不会自动发送。" : "Click Add or press Enter to add the full initialization context to the current input. This will not send automatically."}</p>
        <div class="buttons">
          <button class="cancel" type="button">${isZh ? "取消" : "Cancel"}</button>
          <button class="primary" type="button">${isZh ? "添加" : "Add"}</button>
        </div>
      </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(overlay);

    const cleanup = (result: boolean) => {
      document.removeEventListener("keydown", onKeyDown, true);
      host.remove();
      resolve(result);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup(false);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    shadow.querySelector(".primary")?.addEventListener("click", () => cleanup(true));
    shadow.querySelector(".cancel")?.addEventListener("click", () => cleanup(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        cleanup(false);
      }
    });
    shadow.querySelector<HTMLButtonElement>(".primary")?.focus();
  });
}
