import { PROTOCOL } from "@webcode/shared";
import type { ApprovalMode } from "../src/approval_mode";
import type { ToolExecutionPayload } from "../src/types";
import {
  createApprovalState,
  isPayloadApproved,
  parseStoredApprovalEntries,
  persistApprovalRule,
  shouldRequestApproval,
} from "../src/content/approval_policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function executeCommand(argumentsValue: Record<string, unknown>): ToolExecutionPayload {
  return {
    name: "execute_command",
    arguments: {
      command: "git status",
      ...argumentsValue,
    },
  };
}

function runInTerminal(argumentsValue: Record<string, unknown>): ToolExecutionPayload {
  return {
    name: "run_in_terminal",
    arguments: {
      command: "git status",
      ...argumentsValue,
    },
  };
}

function main(): void {
  const executeState = createApprovalState();
  const legacyPosixPayload = executeCommand({});
  const explicitDefaultPayload = executeCommand({ profile: "default" });

  persistApprovalRule(legacyPosixPayload, "exact", executeState);
  assert(isPayloadApproved(legacyPosixPayload, executeState), "omitted execute profile approval was not retained");
  assert(
    !isPayloadApproved(explicitDefaultPayload, executeState),
    "omitted execute profile approval leaked into the explicit default profile"
  );

  const ambiguousLegacyState = parseStoredApprovalEntries([
    "command-exact:execute_command:.:default:git status",
  ]);
  assert(
    !isPayloadApproved(legacyPosixPayload, ambiguousLegacyState)
      && !isPayloadApproved(explicitDefaultPayload, ambiguousLegacyState),
    "legacy ambiguous default-profile approvals should not match either execute mode"
  );

  const terminalState = createApprovalState();
  persistApprovalRule(runInTerminal({}), "exact", terminalState);
  assert(
    isPayloadApproved(runInTerminal({ profile: "default" }), terminalState),
    "run_in_terminal omitted and explicit default profiles should share the same context"
  );

  assertApprovalModeGate();

  process.stdout.write("✓ command approvals distinguish legacy execute profile semantics\n");
}

function assertApprovalModeGate(): void {
  const routineExecute = executeCommand({});
  const routineTerminal = runInTerminal({});
  const emptyState = createApprovalState();

  // The default mode must not interrupt routine calls; both E2E suites and the
  // product default rely on this.
  assert(!shouldRequestApproval(routineExecute, "ask-when-needed", emptyState),
    "ask-when-needed interrupted a routine execute_command");
  assert(!shouldRequestApproval(routineTerminal, "ask-when-needed", emptyState),
    "ask-when-needed interrupted a routine run_in_terminal");
  assert(!shouldRequestApproval(routineExecute, "never-ask", emptyState),
    "never-ask interrupted a routine execute_command");

  // always-ask interrupts until the user persists a matching rule.
  assert(shouldRequestApproval(routineExecute, "always-ask", emptyState),
    "always-ask skipped a routine execute_command");
  assert(shouldRequestApproval(routineTerminal, "always-ask", emptyState),
    "always-ask skipped a routine run_in_terminal");

  const executableState = createApprovalState();
  persistApprovalRule(routineExecute, "executable", executableState);
  assert(!shouldRequestApproval(routineExecute, "always-ask", executableState),
    "always-ask ignored a persisted executable-scope approval");
  assert(shouldRequestApproval(routineTerminal, "always-ask", executableState),
    "execute_command approval leaked into run_in_terminal");

  // Bootstrap-only tools never prompt, in any mode.
  for (const approvalMode of ["always-ask", "ask-when-needed", "never-ask"] as ApprovalMode[]) {
    assert(!shouldRequestApproval({ name: PROTOCOL.initToolName, arguments: {} }, approvalMode, emptyState),
      `${approvalMode} prompted for the init tool`);
    assert(!shouldRequestApproval({ name: "list_tools", arguments: {} }, approvalMode, emptyState),
      `${approvalMode} prompted for a bootstrap-only tool`);
  }

  process.stdout.write("OK approval mode gate keeps the default mode quiet and risky calls gated.");
  process.stdout.write(String.fromCharCode(10));
}

main();
