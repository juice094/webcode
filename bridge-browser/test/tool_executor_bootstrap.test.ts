import type { ToolActivityStatus } from "../src/content/tool_activity";

export {};

interface StatusRecord {
  message?: string;
  status: ToolActivityStatus;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function installBrowserGlobals(executedToolNames: string[]): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US" },
    });
  }
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: {
      runtime: {
        lastError: undefined,
        sendMessage: (
          message: { type?: string; payload?: { name?: string } },
          callback: (response: unknown) => void
        ) => {
          if (message.type === "EXECUTE_TOOL") {
            executedToolNames.push(message.payload?.name ?? "");
          }
          callback({ success: true, data: [] });
        },
      },
    },
  });
}

async function main(): Promise<void> {
  const executedToolNames: string[] = [];
  installBrowserGlobals(executedToolNames);

  const [{ ToolExecutor }, { ToolRequestRegistry }, { createApprovalState }] = await Promise.all([
    import("../src/content/tool_executor"),
    import("../src/content/tool_request_registry"),
    import("../src/content/approval_policy"),
  ]);

  const statusLog = new Map<string, StatusRecord[]>();
  const settledKeys = new Map<string, () => void>();
  const approvalState = createApprovalState();

  function recordsFor(requestKey: string): StatusRecord[] {
    let records = statusLog.get(requestKey);
    if (!records) {
      records = [];
      statusLog.set(requestKey, records);
    }
    return records;
  }

  const executor = new ToolExecutor({
    getSelectors: () => null,
    getSiteId: () => null,
    getWorkspaceId: () => "workspace",
    getApprovalState: () => approvalState,
    // always-ask is the strictest mode: if list_tools/list_skills still ran
    // without a modal here, they are approval-free in every mode.
    getApprovalMode: () => "always-ask",
    onActivityStatusChange: (identity, status, message) => {
      recordsFor(identity.requestKey).push({ status, message });
      if (status === "succeeded" || status === "failed") {
        settledKeys.get(identity.requestKey)?.();
      }
    },
    requestRegistry: new ToolRequestRegistry(),
    scheduleMainLoop: () => undefined,
  });

  async function runTool(name: string, requestKey: string): Promise<StatusRecord[]> {
    const settled = new Promise<void>((resolve) => settledKeys.set(requestKey, resolve));
    executor.execute({ name, arguments: {} }, { requestKey });
    await settled;
    return recordsFor(requestKey);
  }

  for (const name of ["list_tools", "list_skills"]) {
    const statuses = await runTool(name, `call-${name}`);
    assert(
      statuses.some((record) => record.status === "succeeded"),
      `${name} did not reach the normal execution path`
    );
    assert(
      executedToolNames.includes(name),
      `${name} was never forwarded to the extension background`
    );
  }

  for (const name of ["get_project_rules", "get_project_context"]) {
    const statuses = await runTool(name, `call-${name}`);
    const failure = statuses.find((record) => record.status === "failed");
    assert(failure, `${name} must still be rejected for direct model calls`);
    assert(
      failure?.message !== undefined
        && /reserved for initialization assembly|初始化组装/.test(failure.message),
      `${name} rejection lost its initialization-assembly explanation`
    );
    assert(
      !executedToolNames.includes(name),
      `${name} leaked into the normal execution path`
    );
  }

  process.stdout.write("OK list_tools/list_skills execute normally; init-assembly tools stay rejected.\n");
}

void main();
