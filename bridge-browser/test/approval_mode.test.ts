import {
  DEFAULT_APPROVAL_MODE,
  normalizeApprovalMode,
} from "../src/approval_mode";
import { normalizeSession } from "../src/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function createStoredSession(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    port: 43125,
    token: "token",
    ...overrides,
  };
}

function main(): void {
  assert(normalizeApprovalMode("always-ask") === "always-ask", "always-ask rejected");
  assert(normalizeApprovalMode("ask-when-needed") === "ask-when-needed", "ask-when-needed rejected");
  assert(normalizeApprovalMode("never-ask") === "never-ask", "never-ask rejected");
  assert(normalizeApprovalMode("yolo") === undefined, "unknown mode accepted");
  assert(normalizeApprovalMode(undefined) === undefined, "undefined mode accepted");
  assert(DEFAULT_APPROVAL_MODE === "ask-when-needed", "default approval mode drifted");

  const explicit = normalizeSession(createStoredSession({ approvalMode: "always-ask", autoApproveTools: true }));
  assert(explicit?.approvalMode === "always-ask", "stored approvalMode not honored");
  assert(explicit?.autoApproveTools === false, "autoApproveTools not synced for always-ask");

  const legacyNeverAsk = normalizeSession(createStoredSession({ autoApproveTools: true }));
  assert(legacyNeverAsk?.approvalMode === "never-ask", "legacy autoApproveTools=true must map to never-ask");
  assert(legacyNeverAsk?.autoApproveTools === true, "legacy autoApproveTools=true not preserved");

  const legacyAsk = normalizeSession(createStoredSession({ autoApproveTools: false }));
  assert(legacyAsk?.approvalMode === "ask-when-needed", "legacy autoApproveTools=false must adopt the new default");

  const fresh = normalizeSession(createStoredSession({}));
  assert(fresh?.approvalMode === "ask-when-needed", "fresh sessions must default to ask-when-needed");

  console.log("PASS approval mode normalization and legacy migration");
}

main();
