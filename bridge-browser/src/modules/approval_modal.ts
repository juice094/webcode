import { type ToolExecutionPayload } from "../types";
import {
  getCommandExecutable,
  getCommandApprovalContext,
  getCommandPrefix,
  isCommandApprovalScopeAllowed,
  isBroadCommandExecutable,
  normalizeCommandValue,
  type CommandApprovalScope,
} from "./command_approval";
import { isElementVisible } from "./dom_helpers";
import { t } from "./i18n";
import {
  clearUserAttention,
  showUserAttentionNotification,
} from "./user_attention";
import {
  APPROVAL_MODAL_STYLE,
  escapeHtml,
  renderApprovalModalHtml,
  renderCommandApprovalOptions,
  type ApprovalModalContent,
} from "./approval_modal_markup";
import {
  getModalElements,
  resetModalView,
  showAlwaysApprovalView,
  showRejectReasonView,
  type ModalElements,
  type ModalState,
} from "./approval_modal_views";

type ModalCallbacks = {
  onConfirm: (scope: CommandApprovalScope) => void;
  onReject: (reason: string) => void;
};

export type ApprovalModalOptions = {
  mandatory?: boolean;
  riskReasons?: string[];
};

type CommandApprovalDetails = {
  commandValue: string;
  exactKey: string;
  executableKey: string;
  isBroadExecutable: boolean;
  isCommandScopedApproval: boolean;
  prefixKey: string;
};

const MODAL_EVENT_GUARD_TYPES = [
  "beforeinput",
  "change",
  "click",
  "compositionend",
  "compositionstart",
  "compositionupdate",
  "contextmenu",
  "cut",
  "dblclick",
  "input",
  "keydown",
  "keypress",
  "keyup",
  "mousedown",
  "mouseup",
  "paste",
  "pointerdown",
  "pointerup",
  "touchend",
  "touchstart",
];
const MODAL_FOCUS_RESTORE_TYPES = [
  "beforeinput",
  "compositionstart",
  "compositionupdate",
  "keydown",
  "keypress",
  "paste",
];

/**
 * Stop host-page listeners from observing interactions inside the dialog.
 *
 * `<dialog>` already makes the rest of the document inert, but inertness does
 * not stop event propagation, so these guards remain necessary.
 */
function installModalEventGuards(
  host: HTMLElement,
  dialog: HTMLDialogElement,
  getFocusTarget?: (event: Event) => HTMLElement | null
): () => void {
  const cleanupCallbacks: Array<() => void> = [];
  const addGuard = (
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean
  ) => {
    target.addEventListener(type, listener, options);
    cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
  };

  const restoreModalFocus = (event: Event) => {
    const focusTarget = getFocusTarget?.(event);
    if (!focusTarget || !isElementVisible(focusTarget)) {return;}
    if (dialog.contains(document.activeElement)) {return;}
    focusTarget.focus({ preventScroll: true });
  };

  const stopPagePropagation = (event: Event) => {
    event.stopPropagation();
  };

  for (const type of MODAL_FOCUS_RESTORE_TYPES) {
    addGuard(host, type, restoreModalFocus, true);
  }

  for (const type of MODAL_EVENT_GUARD_TYPES) {
    addGuard(dialog, type, stopPagePropagation);
  }

  return () => {
    cleanupCallbacks.forEach((cleanup) => cleanup());
  };
}

function showApprovalWindowAttention(payload: ToolExecutionPayload): void {
  void showUserAttentionNotification({
    title: t("hitl_title"),
    message: `${t("hitl_intercept")}: ${payload.name}`,
    onlyWhenWindowInBackground: true,
  });
}

export function showConfirmationModal(
  payload: ToolExecutionPayload,
  onConfirm: (scope: CommandApprovalScope) => void,
  onReject: (reason: string) => void,
  options: ApprovalModalOptions = {}
): void {
  const previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const host = createModalHost();
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(createStyleElement());

  const details = getCommandApprovalDetails(payload);
  const elements = createModalElements(shadow, payload, details, options);
  if (options.mandatory) {
    elements.btnAlways.hidden = true;
  }

  const removeModalGuards = installReasonFocusGuards(host, elements.dialog, elements.inputReason);
  const closeModal = createCloseModal(host, removeModalGuards, previouslyFocused);

  bindModalActions(elements, details, { onConfirm, onReject }, closeModal, options.mandatory === true);
  bindDialogCancel(elements.dialog, options.mandatory === true, closeModal);

  // The dialog already lives inside the shadow root. Appending it to the host
  // again would move it into the host page's light DOM, where none of the
  // shadow styles apply and the dialog renders unstyled.
  elements.dialog.showModal();
  elements.btnConfirm.focus({ preventScroll: true });
  showApprovalWindowAttention(payload);
}

function createModalHost(): HTMLElement {
  const host = document.createElement("div");
  host.dataset.wcApprovalHost = "true";
  document.body.appendChild(host);
  return host;
}

function createStyleElement(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = APPROVAL_MODAL_STYLE;
  return style;
}

function createModalElements(
  shadow: ShadowRoot,
  payload: ToolExecutionPayload,
  details: CommandApprovalDetails,
  options: ApprovalModalOptions
): ModalElements {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "approval-title");
  dialog.innerHTML = `<div class="card">${renderApprovalModalHtml(createModalContent(payload, details, options))}</div>`;
  shadow.appendChild(dialog);
  return getModalElements(dialog);
}

function createModalContent(
  payload: ToolExecutionPayload,
  details: CommandApprovalDetails,
  options: ApprovalModalOptions
): ApprovalModalContent {
  return {
    alwaysDescription: details.isCommandScopedApproval ? t("cmd_always_desc") : t("always_desc_2"),
    alwaysOptionsHtml: details.isCommandScopedApproval ? renderCommandApprovalOptions(details) : "",
    alwaysTitle: details.isCommandScopedApproval ? t("cmd_always_title") : t("always_title"),
    safeAlwaysTarget: escapeHtml(details.isCommandScopedApproval ? details.commandValue : payload.name),
    safeArgs: escapeHtml(JSON.stringify(payload.arguments ?? {}, null, 2)),
    safeName: escapeHtml(payload.name),
    safePurpose: escapeHtml(payload.purpose ?? "No purpose provided."),
    safeRiskReasons: (options.riskReasons ?? []).map(escapeHtml),
  };
}

function getCommandApprovalDetails(payload: ToolExecutionPayload): CommandApprovalDetails {
  const commandValue = normalizeCommandValue(payload.arguments?.command) ?? "";
  if (!isCommandApprovalPayload(payload.name, commandValue)) {
    return {
      commandValue,
      exactKey: "",
      executableKey: "",
      isBroadExecutable: false,
      isCommandScopedApproval: false,
      prefixKey: "",
    };
  }

  const executableValue = getCommandExecutable(commandValue) ?? "";
  const isBroadExecutable = Boolean(
    executableValue
    && (
      isBroadCommandExecutable(executableValue)
      || !isCommandApprovalScopeAllowed(commandValue, "executable")
    )
  );
  const prefixValue = getCommandPrefix(commandValue) ?? "";
  const contextValue = getCommandApprovalContext(payload.name, payload.arguments);

  return {
    commandValue,
    exactKey: escapeHtml(`command-exact:${payload.name}:${contextValue}:${commandValue}`),
    executableKey: executableValue && !isBroadExecutable
      ? escapeHtml(`command-executable:${payload.name}:${contextValue}:${executableValue}`)
      : "",
    isBroadExecutable,
    isCommandScopedApproval: true,
    prefixKey: prefixValue
      ? escapeHtml(`command-prefix:${payload.name}:${contextValue}:${prefixValue}`)
      : "",
  };
}

function isCommandApprovalPayload(toolName: string, commandValue: string): boolean {
  return (toolName === "execute_command" || toolName === "run_in_terminal") && Boolean(commandValue);
}

function installReasonFocusGuards(
  host: HTMLElement,
  dialog: HTMLDialogElement,
  inputReason: HTMLInputElement
): () => void {
  return installModalEventGuards(host, dialog, (event) => getReasonFocusTarget(event, dialog, inputReason));
}

function getReasonFocusTarget(
  event: Event,
  dialog: HTMLDialogElement,
  inputReason: HTMLInputElement
): HTMLElement | null {
  if (inputReason.style.display === "none") {return null;}

  const root = dialog.getRootNode();
  const activeElement = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
  const path = event.composedPath();
  return path.includes(inputReason) || activeElement === inputReason ? inputReason : null;
}

function createCloseModal(
  host: HTMLElement,
  removeModalGuards: () => void,
  previouslyFocused: HTMLElement | null
): () => void {
  let isClosed = false;
  return () => {
    if (isClosed) {return;}
    isClosed = true;
    clearUserAttention();
    removeModalGuards();
    host.remove();
    previouslyFocused?.focus({ preventScroll: true });
  };
}

/**
 * Escape must not dismiss a mandatory approval, because that would let the
 * host page bypass an approval the user cannot decline by closing the tab.
 */
function bindDialogCancel(
  dialog: HTMLDialogElement,
  mandatory: boolean,
  closeModal: () => void
): void {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!mandatory) {closeModal();}
  });
}

function bindModalActions(
  elements: ModalElements,
  details: CommandApprovalDetails,
  callbacks: ModalCallbacks,
  closeModal: () => void,
  mandatory: boolean
): void {
  const state: ModalState = { rejectStep: 0 };
  elements.btnConfirm.onclick = (event) => confirmTrustedScope(event, false, callbacks, closeModal);
  elements.btnAlways.onclick = (event) => {
    if (event.isTrusted) {showAlwaysApprovalView(elements, details.isCommandScopedApproval, mandatory);}
  };
  elements.btnConfirmAlways.onclick = (event) => confirmTrustedScope(event, "exact", callbacks, closeModal);
  bindScopeButton(elements.btnAllowExact, "exact", callbacks, closeModal);
  bindScopeButton(elements.btnAllowExecutable, "executable", callbacks, closeModal, details.executableKey);
  bindScopeButton(elements.btnAllowPrefix, "prefix", callbacks, closeModal, details.prefixKey);
  bindRejectFlow(elements, state, callbacks, closeModal);
  elements.btnBack.onclick = (event) => {
    if (event.isTrusted) {resetModalView(elements, state, mandatory);}
  };
}

function confirmTrustedScope(
  event: MouseEvent,
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  if (event.isTrusted) {confirmScope(scope, callbacks, closeModal);}
}

function confirmScope(
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  closeModal();
  callbacks.onConfirm(scope);
}

function bindScopeButton(
  button: HTMLButtonElement | null,
  scope: CommandApprovalScope,
  callbacks: ModalCallbacks,
  closeModal: () => void,
  ruleKey = "enabled"
): void {
  if (!button || !ruleKey) {
    return;
  }

  button.onclick = (event) => confirmTrustedScope(event, scope, callbacks, closeModal);
}

function bindRejectFlow(
  elements: ModalElements,
  state: ModalState,
  callbacks: ModalCallbacks,
  closeModal: () => void
): void {
  const reject = () => {
    if (state.rejectStep === 0) {
      showRejectReasonView(elements, state);
      return;
    }

    const reason = elements.inputReason.value.trim();
    closeModal();
    callbacks.onReject(reason);
  };
  elements.btnReject.onclick = (event) => {
    if (event.isTrusted) {reject();}
  };
  elements.inputReason.onkeydown = (event) => {
    if (event.isTrusted && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      reject();
    }
  };
}
