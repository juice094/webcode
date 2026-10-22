export const POPUP_BASE_STYLES = `
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body {
        width: 290px;
        margin: 0;
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: var(--wc-text-md);
        line-height: 1.4;
        background: var(--wc-surface);
        color: var(--wc-on-surface);
      }
      h2 {
        margin: 0 0 12px 0;
        font-size: var(--wc-text-lg);
        font-weight: 650;
        color: var(--wc-on-surface);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .status-dot {
        width: 9px;
        height: 9px;
        flex: none;
        border-radius: 50%;
        background: var(--wc-on-surface-muted);
      }
      .status-dot.online {
        background: var(--wc-success);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--wc-success) 22%, transparent);
      }
      .status-dot.suspended {
        background: var(--wc-warning);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--wc-warning) 22%, transparent);
      }
      .status-dot.expired {
        background: var(--wc-danger);
        box-shadow: 0 0 0 3px color-mix(in oklch, var(--wc-danger) 22%, transparent);
      }

      .card {
        background: var(--wc-surface-raised);
        border-radius: var(--wc-radius-md);
        padding: 12px;
        margin-bottom: 10px;
        border: 1px solid var(--wc-border);
      }
      .connected-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .connected-stack .card {
        margin-bottom: 0;
      }
      .status-card {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .status-card.disconnected {
        border-color: color-mix(in oklch, var(--wc-danger) 40%, var(--wc-border));
        background: color-mix(in oklch, var(--wc-danger) 10%, var(--wc-surface-raised));
      }
      .status-card.suspended {
        border-color: color-mix(in oklch, var(--wc-warning) 40%, var(--wc-border));
        background: color-mix(in oklch, var(--wc-warning) 10%, var(--wc-surface-raised));
      }
      .status-card.expired {
        border-color: color-mix(in oklch, var(--wc-danger) 40%, var(--wc-border));
        background: color-mix(in oklch, var(--wc-danger) 8%, var(--wc-surface-raised));
      }
      .status-card.checking {
        border-color: color-mix(in oklch, var(--wc-accent) 35%, var(--wc-border));
        background: color-mix(in oklch, var(--wc-accent) 8%, var(--wc-surface-raised));
      }
      .connection-label {
        color: var(--wc-on-surface);
        font-weight: 600;
        line-height: 1.35;
      }
      .connection-label.disconnected {
        color: var(--wc-danger);
      }
      .connection-label.suspended {
        color: var(--wc-warning);
      }
      .connection-label.expired {
        color: var(--wc-danger);
      }
      .connection-label.checking {
        color: var(--wc-accent);
      }
      .status-meta {
        flex: none;
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
        line-height: 1.4;
        text-align: right;
        white-space: nowrap;
      }
      .settings-card {
        padding: 4px 12px;
      }
      .disconnected-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .disconnected-stack .card {
        margin-bottom: 0;
      }
      .suspended-hint {
        color: var(--wc-warning);
        font-size: var(--wc-text-sm);
      }
      .expired-card {
        background: color-mix(in oklch, var(--wc-warning) 12%, var(--wc-surface-raised));
        border: 1px solid color-mix(in oklch, var(--wc-warning) 45%, var(--wc-border));
        border-radius: var(--wc-radius-md);
        padding: 12px;
      }
      .expired-desc {
        color: var(--wc-on-surface);
        font-size: var(--wc-text-xs);
      }
      .install-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section-title {
        color: var(--wc-on-surface);
        font-size: var(--wc-text-sm);
        font-weight: 700;
        margin-bottom: 6px;
      }
      .installed-action-card,
      .marketplace-card {
        border-radius: var(--wc-radius-md);
        padding: 12px;
      }
      .installed-action-card {
        background: color-mix(in oklch, var(--wc-accent) 12%, var(--wc-surface-raised));
        border: 1px solid color-mix(in oklch, var(--wc-accent) 40%, var(--wc-border));
      }
      .install-desc {
        color: var(--wc-on-surface);
        font-size: var(--wc-text-xs);
      }
      .marketplace-card {
        background: color-mix(in oklch, var(--wc-success) 12%, var(--wc-surface-raised));
        border: 1px solid color-mix(in oklch, var(--wc-success) 40%, var(--wc-border));
      }
      .marketplace-hint {
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
        margin-bottom: 2px;
      }
      .marketplace-query {
        color: var(--wc-success);
        font-size: var(--wc-text-sm);
        font-weight: 700;
      }
      .btn {
        display: block;
        width: 100%;
        padding: 8px 10px;
        background: var(--wc-accent);
        border: 1px solid transparent;
        border-radius: var(--wc-radius-sm);
        color: var(--wc-on-accent);
        cursor: pointer;
        font-size: var(--wc-text-sm);
        font-weight: 600;
        text-align: center;
        text-decoration: none;
        transition: background-color var(--wc-dur-fast) ease-out;
      }
      .btn:hover {
        background: color-mix(in oklch, var(--wc-accent) 88%, black);
      }
      .btn:disabled {
        background: var(--wc-surface-raised);
        border-color: var(--wc-border);
        color: var(--wc-on-surface-muted);
        cursor: not-allowed;
      }
      .btn[data-state="success"] {
        background: var(--wc-success);
        color: var(--wc-on-filled);
      }
      .btn[data-state="error"] {
        background: var(--wc-danger);
        color: var(--wc-on-filled);
      }
      .btn.secondary {
        background: transparent;
        border-color: var(--wc-border);
        color: var(--wc-on-surface);
        margin-top: 8px;
      }
      .btn.secondary:hover {
        background: color-mix(in oklch, var(--wc-on-surface) 10%, transparent);
      }
      .discovered-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .discovered-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .discovered-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        background: var(--wc-surface);
        border: 1px solid var(--wc-border);
        border-radius: var(--wc-radius-sm);
      }
      .discovered-name {
        min-width: 0;
        font-size: var(--wc-text-sm);
        color: var(--wc-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .discovered-meta {
        font-size: var(--wc-text-xs);
        color: var(--wc-on-surface-muted);
      }
      .discovered-connect {
        flex: none;
        width: auto;
        padding: 4px 10px;
        font-size: var(--wc-text-xs);
      }

      .brand-emphasis {
        color: var(--wc-accent);
        font-weight: 700;
      }
      .hidden {
        display: none;
      }
      p {
        margin: 0;
        font-size: var(--wc-text-sm);
        line-height: 1.45;
        color: var(--wc-on-surface);
      }
      a[href]:focus-visible,
      button:focus-visible,
      input:focus-visible,
      select:focus-visible {
        outline: 2px solid var(--wc-focus-ring);
        outline-offset: 2px;
      }
      .checkbox-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: var(--wc-text-sm);
        min-height: 34px;
        margin-bottom: 0;
        border-bottom: 1px solid var(--wc-border);
      }
      .checkbox-row:last-child {
        border-bottom: none;
      }
      .session-setting-last {
        border-bottom: none;
      }
      .disclosure-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        min-height: 34px;
        padding: 0;
        border: none;
        border-top: 1px solid var(--wc-border);
        background: transparent;
        color: var(--wc-on-surface);
        cursor: pointer;
        font: inherit;
        font-size: var(--wc-text-sm);
        text-align: left;
      }
      .disclosure-button:hover {
        color: var(--wc-accent);
      }
      .disclosure-caret {
        flex: none;
        width: 6px;
        height: 6px;
        margin-right: 3px;
        border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor;
        transform: rotate(45deg);
        transition: transform var(--wc-dur-fast) ease;
      }
      .disclosure-button[aria-expanded="true"] .disclosure-caret {
        margin-top: 5px;
        transform: rotate(225deg);
      }
`;
