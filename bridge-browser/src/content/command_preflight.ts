import type { ToolExecutionPayload } from "../types";

// Tools whose risk is assessed by the gateway preflight route. Command tools
// keep their existing mandatory-approval flow; file tools join so sensitive
// paths (.env, private keys, credentials) also force a confirmation modal.
const PREFLIGHT_RISK_TOOLS = new Set([
  "execute_command",
  "run_in_terminal",
  "read_file",
  "write_file",
  "edit_file",
  "attach_file",
]);

interface ToolPreflightResponse {
  success: boolean;
  error?: string;
  risk?: {
    level: "allowed" | "requires_confirmation" | "blocked";
    reasons: string[];
  };
  challengeId?: string;
}

interface ToolApprovalResponse {
  success: boolean;
  approvalToken?: string;
  error?: string;
}

export function preflightCommand(payload: ToolExecutionPayload): Promise<ToolPreflightResponse | null> {
  if (!PREFLIGHT_RISK_TOOLS.has(payload.name)) {
    return Promise.resolve(null);
  }

  return sendRuntimeMessage<ToolPreflightResponse>({
    type: "PREFLIGHT_TOOL",
    payload,
  }).then((response) => {
    if (!response.success) {
      throw new Error(response.error ?? "Command preflight failed.");
    }
    return response;
  });
}

export function grantCommandApproval(challengeId: string): Promise<string> {
  return sendRuntimeMessage<ToolApprovalResponse>({
    type: "APPROVE_TOOL",
    challengeId,
  }).then((response) => {
    if (!response.success || !response.approvalToken) {
      throw new Error(response.error ?? "Command approval failed.");
    }
    return response.approvalToken;
  });
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "Runtime message failed."));
        return;
      }
      resolve(response);
    });
  });
}
