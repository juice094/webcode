import { Logger } from "../modules/logger";
import {
  DEFAULT_APPROVAL_MODE,
  normalizeApprovalMode,
  type ApprovalMode,
} from "../approval_mode";
import type { MessageRequest } from "../types";

export interface ApprovalModeConfig {
  approvalMode: ApprovalMode;
}

export function createApprovalModeConfig(): ApprovalModeConfig {
  return { approvalMode: DEFAULT_APPROVAL_MODE };
}

export function resolveStatusApprovalMode(status: {
  approvalMode?: unknown;
  autoApproveTools?: boolean;
} | null | undefined): ApprovalMode {
  return normalizeApprovalMode(status?.approvalMode)
    ?? (status?.autoApproveTools === true ? "never-ask" : DEFAULT_APPROVAL_MODE);
}

// Applies approval-mode updates carried by runtime messages (legacy boolean
// toggle, mode select, and status updates). Returns true when a mode was set.
export function applyApprovalModeRuntimeMessage(
  request: MessageRequest,
  config: ApprovalModeConfig
): boolean {
  let nextMode: ApprovalMode | undefined;
  if (request.type === "SET_AUTO_APPROVE_TOOLS") {
    // Legacy toggle: unchecked meant "ask every time".
    nextMode = request.autoApproveTools === true ? "never-ask" : "always-ask";
  } else if (request.type === "SET_APPROVAL_MODE") {
    nextMode = request.approvalMode;
  } else if (request.type === "STATUS_UPDATE") {
    nextMode = request.approvalMode
      ?? (typeof request.autoApproveTools === "boolean"
        ? (request.autoApproveTools ? "never-ask" : "always-ask")
        : undefined);
  }

  if (!nextMode) {return false;}
  config.approvalMode = nextMode;
  Logger.log(`Approval Mode: ${nextMode}`, "info");
  return true;
}
