export {};

interface ExecutedToolCall {
  name: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function installBrowserGlobals(executedCalls: ExecutedToolCall[], snapshotAvailable: boolean): void {
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
          message: { payload?: { name?: string } },
          callback: (response: unknown) => void
        ) => {
          const name = message.payload?.name ?? "";
          executedCalls.push({ name });
          if (name === "get_capability_snapshot" && !snapshotAvailable) {
            callback({ success: false, error: "unknown tool" });
            return;
          }
          const data = name === "get_capability_snapshot"
            ? "CAPABILITY-SNAPSHOT-MARKER"
            : name === "get_project_rules"
              ? "PROJECT-RULES-MARKER"
              : name === "get_project_context"
                ? "PROJECT-CONTEXT-MARKER"
                : [];
          callback({ success: true, data });
        },
      },
    },
  });
}

async function main(): Promise<void> {
  const executedCalls: ExecutedToolCall[] = [];
  installBrowserGlobals(executedCalls, true);
  const { buildWebcodeInitPrompt } = await import("../src/content/init_context");

  const prompt = await buildWebcodeInitPrompt();

  assert(prompt.includes("CAPABILITY-SNAPSHOT-MARKER"), "init payload lost the capability snapshot");
  assert(prompt.includes("PROJECT-RULES-MARKER"), "init payload lost the project rules");
  assert(prompt.includes("PROJECT-CONTEXT-MARKER"), "init payload lost the project context");
  assert(
    prompt.includes("source of truth") || prompt.includes("事实来源"),
    "init payload header must declare the snapshot as the source of truth"
  );
  assert(
    !prompt.includes("Before starting the task") && !prompt.includes("开始任务前"),
    "init payload header still forces a pre-task list_tools round"
  );

  const fetchedNames = executedCalls.map((call) => call.name);
  assert(
    fetchedNames.includes("get_capability_snapshot") &&
      fetchedNames.includes("get_project_rules") &&
      fetchedNames.includes("get_project_context"),
    "init payload no longer fetches snapshot, project rules, and context"
  );

  process.stdout.write("OK init payload embeds the capability snapshot and drops the pre-task inventory round.\n");

  const fallbackCalls: ExecutedToolCall[] = [];
  installBrowserGlobals(fallbackCalls, false);
  const fallbackPrompt = await buildWebcodeInitPrompt();

  assert(
    !fallbackPrompt.includes("CAPABILITY-SNAPSHOT-MARKER"),
    "fallback payload unexpectedly contains a snapshot"
  );
  assert(
    fallbackPrompt.includes("Before starting the task, call list_tools") ||
      fallbackPrompt.includes("开始任务前，先调用 list_tools"),
    "fallback header must restore the list_tools guidance when the gateway has no snapshot tool"
  );
  assert(
    fallbackPrompt.includes("PROJECT-RULES-MARKER"),
    "fallback payload lost the project rules"
  );

  process.stdout.write("OK init payload falls back to list_tools guidance when the gateway lacks the snapshot tool.\n");
}

void main();
