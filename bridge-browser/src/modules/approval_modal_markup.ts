import { t } from "./i18n";
import { SHARED_STYLES } from "../styles/shared";

export type ApprovalModalContent = {
  alwaysDescription: string;
  alwaysOptionsHtml: string;
  alwaysTitle: string;
  safeAlwaysTarget: string;
  safeArgs: string;
  safeName: string;
  safePurpose: string;
  safeRiskReasons: string[];
};

export type CommandApprovalOptions = {
  exactKey: string;
  executableKey: string;
  isBroadExecutable: boolean;
  prefixKey: string;
};

/**
 * Approval dialog styles.
 *
 * Every color, radius and spacing value comes from the shared tokens; the
 * only literal colors left are the translucent backdrop and shadows, which are
 * intentionally surface-specific and reviewed against the layer budget.
 */
export const APPROVAL_MODAL_STYLE = `
  :host { all: initial; }
${SHARED_STYLES}
  *, *::before, *::after { box-sizing: border-box; }

  dialog {
    width: min(90vw, 450px);
    max-height: calc(100dvh - 2 * var(--wc-space-5));
    margin: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--wc-on-surface);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }

  dialog::backdrop {
    background: color-mix(in oklch, black 55%, transparent);
    backdrop-filter: blur(2px);
  }

  dialog[open] .card { animation: fadeIn var(--wc-dur-base) ease-out; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .card {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    overflow-y: auto;
    padding: var(--wc-space-5);
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-lg);
    background: var(--wc-surface);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  }

  .title {
    display: flex;
    align-items: center;
    gap: var(--wc-space-2);
    margin: 0 0 var(--wc-space-4);
    color: var(--wc-danger);
    font-size: calc(var(--wc-text-lg) * 1.43);
    font-weight: 600;
  }

  .warn-icon { font-size: 24px; }

  .field { margin-bottom: var(--wc-space-4); }

  .label {
    display: block;
    margin-bottom: 6px;
    color: var(--wc-on-surface-muted);
    font-size: var(--wc-text-sm);
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .value {
    max-height: 250px;
    overflow-y: auto;
    padding: var(--wc-space-2);
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-sm);
    background: var(--wc-surface-raised);
    color: var(--wc-on-surface);
    font-family: Menlo, Consolas, monospace;
    font-size: var(--wc-text-md);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .value-tool { color: var(--wc-danger); font-weight: 700; }
  .value-purpose { color: var(--wc-accent); font-weight: 500; }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--wc-space-3);
    margin-top: var(--wc-space-5);
  }

  .btn {
    padding: 10px 20px;
    border: 1px solid transparent;
    border-radius: var(--wc-radius-sm);
    font-size: var(--wc-text-lg);
    font-weight: 600;
    cursor: pointer;
    transition: background-color var(--wc-dur-fast) ease-out, border-color var(--wc-dur-fast) ease-out;
  }

  .btn-reject {
    border-color: var(--wc-danger);
    background: var(--wc-surface);
    color: var(--wc-danger);
  }

  .btn-reject:hover { background: var(--wc-danger); color: var(--wc-on-filled); }

  .btn-confirm-always { display: none; }

  .btn-confirm,
  .btn-confirm-always {
    background: var(--wc-success);
    color: var(--wc-on-filled);
  }

  .btn-confirm:hover,
  .btn-confirm-always:hover { filter: brightness(0.92); }

  .btn-always,
  .btn-back { margin-right: auto; }

  .btn-always {
    background: var(--wc-warning);
    color: var(--wc-on-filled);
  }

  .btn-back {
    display: none;
    background: var(--wc-surface-raised);
    border-color: var(--wc-border);
    color: var(--wc-on-surface);
  }

  .btn-always:hover,
  .btn-back:hover { filter: brightness(0.94); }

  .always-view { padding: var(--wc-space-4) 0; text-align: center; }
  .always-icon { margin-bottom: var(--wc-space-2); font-size: 40px; }

  .always-title {
    margin: 0 0 var(--wc-space-2);
    color: var(--wc-danger);
    font-size: calc(var(--wc-text-lg) * 1.14);
    font-weight: 700;
  }

  .always-desc {
    margin: 0;
    color: var(--wc-on-surface-muted);
    font-size: var(--wc-text-md);
    line-height: 1.5;
  }

  .approval-options {
    display: grid;
    gap: var(--wc-space-2);
    margin-top: var(--wc-space-3);
    text-align: left;
  }

  .approval-option {
    padding: var(--wc-space-3);
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-md);
    background: var(--wc-surface-raised);
  }

  .approval-option.warning { border-color: var(--wc-warning); }
  .approval-option.disabled { border-color: var(--wc-danger); }

  .approval-option strong {
    display: block;
    margin-bottom: var(--wc-space-1);
    color: var(--wc-on-surface);
  }

  .approval-option code {
    display: block;
    margin-top: 6px;
    padding: var(--wc-space-2);
    border-radius: var(--wc-radius-sm);
    background: var(--wc-surface);
    color: var(--wc-accent);
    word-break: break-all;
  }

  .approval-option .btn {
    width: 100%;
    margin-top: var(--wc-space-2);
    background: var(--wc-accent);
    color: var(--wc-on-accent);
  }

  .approval-option .btn:hover { filter: brightness(0.92); }

  .scope-warning {
    margin-top: var(--wc-space-2);
    color: var(--wc-warning);
    font-size: var(--wc-text-sm);
    font-weight: 600;
  }

  .risk-reasons {
    border-color: var(--wc-warning);
    background: var(--wc-surface-raised);
    color: var(--wc-on-surface);
  }

  .risk-reasons ul { margin: 0; padding-left: 20px; }
  .risk-reasons li + li { margin-top: 6px; }

  .reason {
    display: none;
    width: 100%;
    margin-top: var(--wc-space-2);
    padding: 10px;
    border: 1px solid var(--wc-border);
    border-radius: var(--wc-radius-sm);
    background: var(--wc-surface);
    color: var(--wc-on-surface);
    font-size: var(--wc-text-lg);
  }

  .reason:focus { border-color: var(--wc-danger); }
`;

export function renderApprovalModalHtml(content: ApprovalModalContent): string {
  const riskHtml = content.safeRiskReasons.length > 0
    ? `
              <div class="field">
                  <span class="label" id="approval-risk-label">${t("label_risk")}</span>
                  <div class="value risk-reasons" aria-labelledby="approval-risk-label"><ul>${content.safeRiskReasons.map(reason => `<li>${reason}</li>`).join("")}</ul></div>
              </div>`
    : "";
  return `
          <h2 class="title" id="approval-title"><span class="warn-icon" aria-hidden="true">✋</span> ${t("hitl_title")}</h2>

          <div id="view-main">
              <div class="field">
                  <span class="label" id="approval-tool-label">${t("label_tool")}</span>
                  <div class="value value-tool" aria-labelledby="approval-tool-label">${content.safeName}</div>
              </div>
              <div class="field">
                  <span class="label" id="approval-purpose-label">${t("label_purpose")}</span>
                  <div class="value value-purpose" aria-labelledby="approval-purpose-label">${content.safePurpose}</div>
              </div>
              <div class="field">
                  <span class="label" id="approval-args-label">${t("label_args")}</span>
                  <div class="value" aria-labelledby="approval-args-label">${content.safeArgs}</div>
              </div>
              ${riskHtml}
          </div>

          <div id="view-always-confirm" class="always-view" hidden>
               <div class="always-icon" aria-hidden="true">🔓</div>
               <p class="always-title">${content.alwaysTitle}</p>
               <p class="always-desc">
                  ${t("always_desc_1")} <b>${content.safeAlwaysTarget}</b>.<br>
                  ${content.alwaysDescription}
               </p>
               ${content.alwaysOptionsHtml}
          </div>

          <label class="wc-visually-hidden" for="approval-reason">${t("placeholder_reason")}</label>
          <input type="text" id="approval-reason" class="reason" placeholder="${t("placeholder_reason")}">

          <div class="buttons">
              <button type="button" class="btn btn-always">${t("btn_always")}</button>
              <button type="button" class="btn btn-back">${t("btn_back")}</button>
              <button type="button" class="btn btn-reject">${t("btn_reject")}</button>
              <button type="button" class="btn btn-confirm">${t("btn_approve")}</button>
              <button type="button" class="btn btn-confirm-always">${t("btn_allow_confirm")}</button>
          </div>
      `;
}

export function renderCommandApprovalOptions(options: CommandApprovalOptions): string {
  const executableOptionHtml = options.executableKey
    ? renderExecutableApprovalOption(options.executableKey, options.isBroadExecutable)
    : "";
  const prefixOptionHtml = options.prefixKey
    ? renderPrefixApprovalOption(options.prefixKey, options.isBroadExecutable)
    : "";

  return `
          <div class="approval-options">
              <div class="approval-option">
                  <strong>${t("cmd_scope_exact_title")}</strong>
                  <div>${t("cmd_scope_exact_desc")}</div>
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${options.exactKey}</code>
                  <button type="button" class="btn btn-allow-exact btn-scope-approve">${t("btn_allow_exact")}</button>
              </div>
              ${prefixOptionHtml}
              ${executableOptionHtml}
          </div>
      `;
}

export function escapeHtml(unsafe: string): string {
  return (unsafe || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderExecutableApprovalOption(executableKey: string, isBroadExecutable: boolean): string {
  if (isBroadExecutable) {
    return `
              <div class="approval-option disabled">
                  <strong>${t("cmd_scope_executable_title")}</strong>
                  <div>${t("cmd_scope_executable_desc")}</div>
                  <div class="scope-warning">${t("cmd_scope_executable_blocked")}</div>
                  <button type="button" class="btn btn-allow-executable btn-scope-approve" disabled>${t("btn_allow_executable")}</button>
              </div>
          `;
  }

  return `
              <div class="approval-option">
                  <strong>${t("cmd_scope_executable_title")}</strong>
                  <div>${t("cmd_scope_executable_desc")}</div>
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${executableKey}</code>
                  <button type="button" class="btn btn-allow-executable btn-scope-approve">${t("btn_allow_executable")}</button>
              </div>
          `;
}

function renderPrefixApprovalOption(prefixKey: string, isBroadExecutable: boolean): string {
  const warning = isBroadExecutable
    ? `<div class="scope-warning">${t("cmd_scope_prefix_warning")}</div>`
    : "";

  return `
              <div class="approval-option${isBroadExecutable ? " warning" : ""}">
                  <strong>${t("cmd_scope_prefix_title")}</strong>
                  <div>${t("cmd_scope_prefix_desc")}</div>
                  ${warning}
                  <div class="label">${t("label_rule_key")}</div>
                  <code>${prefixKey}</code>
                  <button type="button" class="btn btn-allow-prefix btn-scope-approve">${t("btn_allow_prefix")}</button>
              </div>
          `;
}
