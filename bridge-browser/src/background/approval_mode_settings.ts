import {
  type ApprovalMode,
  normalizeApprovalMode,
  type SetApprovalModeMessageRequest,
  type SetDefaultApprovalModeMessageRequest,
} from "../approval_mode";
import type {
  SetAutoApproveToolsMessageRequest,
  SetDefaultAutoApproveToolsMessageRequest,
} from "../types";
import { updateDefaultApprovalMode } from "./presets";
import { updateSessionApprovalMode } from "./sessions";

type SendResponse = (response?: unknown) => void;

// The legacy boolean toggle maps onto the never-ask / always-ask ends of the
// mode spectrum so older popup builds keep working against a newer background.
export function handleSetAutoApproveTools(
  request: SetAutoApproveToolsMessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): void {
  respondSetApprovalMode(
    currentTabId,
    request.autoApproveTools ? "never-ask" : "always-ask",
    sendResponse
  );
}

export function handleSetApprovalMode(
  request: SetApprovalModeMessageRequest,
  currentTabId: number | null | undefined,
  sendResponse: SendResponse
): void {
  const approvalMode = normalizeApprovalMode(request.approvalMode);
  if (!approvalMode) {
    sendResponse({ success: false, error: "Missing approval mode" });
    return;
  }
  respondSetApprovalMode(currentTabId, approvalMode, sendResponse);
}

function respondSetApprovalMode(
  currentTabId: number | null | undefined,
  approvalMode: ApprovalMode,
  sendResponse: SendResponse
): void {
  const targetTabId = currentTabId;
  if (!targetTabId) {
    sendResponse({ success: false, error: "Missing Tab ID" });
    return;
  }

  respondAsync(
    updateSessionApprovalMode(targetTabId, approvalMode).then(() => {
      void chrome.tabs
        .sendMessage(targetTabId, { type: "SET_APPROVAL_MODE", approvalMode })
        .catch(ignoreRuntimeError);
      chrome.runtime.sendMessage(
        { type: "APPROVAL_MODE_CHANGED", tabId: targetTabId, approvalMode },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return { success: true };
    }),
    sendResponse
  );
}

export function handleSetDefaultAutoApproveTools(
  request: SetDefaultAutoApproveToolsMessageRequest,
  sendResponse: SendResponse
): void {
  respondSetDefaultApprovalMode(
    request.defaultAutoApproveTools ? "never-ask" : "ask-when-needed",
    sendResponse
  );
}

export function handleSetDefaultApprovalMode(
  request: SetDefaultApprovalModeMessageRequest,
  sendResponse: SendResponse
): void {
  const defaultApprovalMode = normalizeApprovalMode(request.defaultApprovalMode);
  if (!defaultApprovalMode) {
    sendResponse({ success: false, error: "Missing default approval mode" });
    return;
  }
  respondSetDefaultApprovalMode(defaultApprovalMode, sendResponse);
}

function respondSetDefaultApprovalMode(
  defaultApprovalMode: ApprovalMode,
  sendResponse: SendResponse
): void {
  respondAsync(
    updateDefaultApprovalMode(defaultApprovalMode).then((presetSettings) => {
      chrome.runtime.sendMessage(
        {
          type: "DEFAULT_APPROVAL_MODE_CHANGED",
          defaultApprovalMode: presetSettings.defaultApprovalMode,
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
      return { success: true };
    }),
    sendResponse
  );
}

function respondAsync<T>(promise: Promise<T>, sendResponse: SendResponse): void {
  void promise.catch((error: unknown) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  })).then(sendResponse);
}

function ignoreRuntimeError(_error: unknown): void {
  void chrome.runtime.lastError;
}
