export const POPUP_PANEL_STYLES = `
      .preset-panel {
        border-top: 1px solid var(--wc-border);
      }
      .preset-hint {
        margin: 8px 0 2px;
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
        line-height: 1.35;
      }
      .preset-row {
        min-height: 46px;
        padding: 7px 0;
        border-bottom: none;
      }
      .rules-panel {
        border-top: 1px solid var(--wc-border);
        padding-bottom: 6px;
      }
      .rules-list {
        margin: 6px 0 0;
        padding: 0;
        list-style: none;
        max-height: 150px;
        overflow-y: auto;
      }
      .rule-row {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        padding: 3px 0;
      }
      .rule-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--wc-on-surface);
        font-size: var(--wc-text-xs);
      }
      .rule-time {
        flex: none;
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
      }
      .rule-remove {
        flex: none;
        min-height: 22px;
        padding: 0 8px;
        border: 1px solid var(--wc-border);
        border-radius: var(--wc-radius-sm);
        background: transparent;
        color: var(--wc-on-surface);
        font-size: var(--wc-text-xs);
        cursor: pointer;
      }
      .rule-remove:hover {
        border-color: var(--wc-danger);
        color: var(--wc-danger);
      }
      .rules-empty {
        margin: 8px 0 2px;
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
        line-height: 1.35;
      }
      input[type="checkbox"] {
        flex: none;
        cursor: pointer;
      }
      select.mode-select {
        flex: none;
        cursor: pointer;
        background: var(--wc-surface);
        color: var(--wc-on-surface);
        border: 1px solid var(--wc-border);
        border-radius: var(--wc-radius-sm);
        padding: 3px 6px;
        font-size: var(--wc-text-sm);
        max-width: 150px;
      }
      .mode-hint {
        margin: 4px 0 0;
        color: var(--wc-on-surface-muted);
        font-size: var(--wc-text-xs);
        line-height: 1.35;
      }
`;
