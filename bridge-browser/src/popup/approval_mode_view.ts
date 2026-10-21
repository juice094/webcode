import type { PopupTranslator } from "./i18n";

/**
 * Approval-mode controls shared by the popup session row and the new-session
 * preset row. Split out of `popup/index.ts` to keep that module inside its line
 * budget.
 */

export function localizeApprovalModeOptions(select: HTMLSelectElement, t: PopupTranslator): void {
  const labels: Record<string, string> = {
    "always-ask": t("approval_mode_always_ask"),
    "ask-when-needed": t("approval_mode_ask_when_needed"),
    "never-ask": t("approval_mode_never_ask"),
  };
  for (const option of Array.from(select.options)) {
    option.textContent = labels[option.value] ?? option.value;
  }
}

export function bindApprovalModeSelect(
  currentTabId: number,
  approvalModeSelect: HTMLSelectElement
): void {
  approvalModeSelect.addEventListener("change", () => {
    void chrome.runtime.sendMessage({
      type: "SET_APPROVAL_MODE",
      tabId: currentTabId,
      approvalMode: approvalModeSelect.value,
    });
  });
}
