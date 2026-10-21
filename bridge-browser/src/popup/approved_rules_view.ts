import {
  clearApprovedRules,
  listApprovedRules,
  pruneRuleTimestamps,
  removeApprovedRule,
  rulesMetaStorageKey,
  rulesStorageKey,
  type ApprovedRuleEntry,
} from "../approved_rules";
import type { PopupTranslator } from "./i18n";

/**
 * "Authorized Rules" disclosure in the popup. It reads and writes
 * `chrome.storage.local` directly: the content script already reacts to those
 * keys, so revoking a rule needs no new message type.
 */

export interface ApprovedRulesElements {
  toggle: HTMLButtonElement;
  toggleLabel: HTMLElement;
  panel: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  clear: HTMLButtonElement;
}

export function getApprovedRulesElements(): ApprovedRulesElements {
  return {
    toggle: document.getElementById("authorizedRulesToggle") as HTMLButtonElement,
    toggleLabel: document.getElementById("authorizedRulesToggleLabel") as HTMLElement,
    panel: document.getElementById("authorizedRulesPanel") as HTMLElement,
    list: document.getElementById("authorizedRulesList") as HTMLElement,
    empty: document.getElementById("authorizedRulesEmpty") as HTMLElement,
    clear: document.getElementById("authorizedRulesClear") as HTMLButtonElement,
  };
}

const state: { workspaceId: string | null; t: PopupTranslator | null } = {
  workspaceId: null,
  t: null,
};

export function mountApprovedRules(elements: ApprovedRulesElements, t: PopupTranslator): void {
  state.t = t;
  elements.toggleLabel.textContent = t("authorized_rules_label");
  elements.toggle.title = t("authorized_rules_hint");
  elements.clear.textContent = t("authorized_rules_clear");
  elements.empty.textContent = t("authorized_rules_empty");

  elements.toggle.addEventListener("click", () => {
    const expanded = elements.toggle.getAttribute("aria-expanded") !== "true";
    elements.toggle.setAttribute("aria-expanded", String(expanded));
    elements.panel.classList.toggle("hidden", !expanded);
  });

  elements.list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {return;}
    const button = target.closest("[data-rule]");
    const rule = button instanceof HTMLElement ? button.dataset.rule : undefined;
    if (rule) {revokeRule(elements, rule);}
  });

  elements.clear.addEventListener("click", () => {revokeAllRules(elements);});
}

export function refreshApprovedRules(
  elements: ApprovedRulesElements,
  workspaceId: string | null,
  t: PopupTranslator
): void {
  state.workspaceId = workspaceId;
  state.t = t;
  if (!workspaceId) {
    renderRules(elements, [], translate("authorized_rules_unavailable"));
    elements.toggle.setAttribute("aria-disabled", "true");
    return;
  }

  elements.toggle.removeAttribute("aria-disabled");
  const entriesKey = rulesStorageKey(workspaceId);
  const metaKey = rulesMetaStorageKey(workspaceId);
  chrome.storage.local.get([entriesKey, metaKey], (items) => {
    renderRules(elements, listApprovedRules(items[entriesKey], items[metaKey]), translate("authorized_rules_empty"));
  });
}

function revokeRule(elements: ApprovedRulesElements, rule: string): void {
  const workspaceId = state.workspaceId;
  if (!workspaceId) {return;}

  const entriesKey = rulesStorageKey(workspaceId);
  const metaKey = rulesMetaStorageKey(workspaceId);
  chrome.storage.local.get([entriesKey, metaKey], (items) => {
    const remaining = removeApprovedRule(items[entriesKey], rule);
    const meta = pruneRuleTimestamps(items[metaKey], remaining);
    chrome.storage.local.set({ [entriesKey]: remaining, [metaKey]: meta }, () => {
      renderRules(elements, listApprovedRules(remaining, meta), translate("authorized_rules_empty"));
    });
  });
}

function revokeAllRules(elements: ApprovedRulesElements): void {
  const workspaceId = state.workspaceId;
  if (!workspaceId) {return;}

  const entriesKey = rulesStorageKey(workspaceId);
  const metaKey = rulesMetaStorageKey(workspaceId);
  chrome.storage.local.set({ [entriesKey]: clearApprovedRules(), [metaKey]: {} }, () => {
    renderRules(elements, [], translate("authorized_rules_empty"));
  });
}

function renderRules(
  elements: ApprovedRulesElements,
  entries: ApprovedRuleEntry[],
  emptyMessage: string
): void {
  elements.list.replaceChildren(...entries.map(createRuleRow));
  elements.empty.textContent = emptyMessage;
  elements.empty.classList.toggle("hidden", entries.length > 0);
  elements.clear.classList.toggle("hidden", entries.length === 0);
}

function createRuleRow(entry: ApprovedRuleEntry): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "rule-row";

  const label = document.createElement("span");
  label.className = "rule-label";
  label.textContent = entry.rule;
  label.title = entry.rule;

  const createdAt = document.createElement("span");
  createdAt.className = "rule-time";
  createdAt.textContent = entry.createdAt === null ? "" : formatCreatedAt(entry.createdAt);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "rule-remove";
  remove.dataset.rule = entry.rule;
  remove.textContent = translate("authorized_rules_remove");
  remove.title = entry.rule;

  row.append(label, createdAt, remove);
  return row;
}

function formatCreatedAt(value: number): string {
  return new Date(value).toLocaleString();
}

function translate(key: string): string {
  return state.t ? state.t(key) : key;
}
