// Approval mode shared between the popup, background, and content scripts.

export const APPROVAL_MODES = ["always-ask", "ask-when-needed", "never-ask"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const DEFAULT_APPROVAL_MODE: ApprovalMode = "ask-when-needed";

export function normalizeApprovalMode(value: unknown): ApprovalMode | undefined {
  return APPROVAL_MODES.find((mode) => mode === value);
}

export interface SetApprovalModeMessageRequest {
  type: "SET_APPROVAL_MODE";
  tabId?: number;
  approvalMode: ApprovalMode;
}

export interface SetDefaultApprovalModeMessageRequest {
  type: "SET_DEFAULT_APPROVAL_MODE";
  defaultApprovalMode: ApprovalMode;
}

export interface ApprovalModeChangedMessageRequest {
  type: "APPROVAL_MODE_CHANGED";
  tabId: number;
  approvalMode: ApprovalMode;
}

export interface DefaultApprovalModeChangedMessageRequest {
  type: "DEFAULT_APPROVAL_MODE_CHANGED";
  defaultApprovalMode: ApprovalMode;
}

// Kept as a concrete key set so the spread into MESSAGE_REQUEST_VALIDATORS
// preserves compile-time exhaustiveness for MessageRequest["type"].
export const APPROVAL_MODE_VALIDATORS = {
  SET_APPROVAL_MODE: (value: Record<string, unknown>) =>
    isOptionalNumber(value.tabId) && normalizeApprovalMode(value.approvalMode) !== undefined,
  SET_DEFAULT_APPROVAL_MODE: (value: Record<string, unknown>) =>
    normalizeApprovalMode(value.defaultApprovalMode) !== undefined,
  APPROVAL_MODE_CHANGED: (value: Record<string, unknown>) =>
    typeof value.tabId === "number" && normalizeApprovalMode(value.approvalMode) !== undefined,
  DEFAULT_APPROVAL_MODE_CHANGED: (value: Record<string, unknown>) =>
    normalizeApprovalMode(value.defaultApprovalMode) !== undefined,
} satisfies Record<string, (value: Record<string, unknown>) => boolean>;

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}
