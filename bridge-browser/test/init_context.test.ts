export {};

interface ExecutedToolCall {
  name: string;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function installBrowserGlobals(executedCalls: ExecutedToolCall[]): void {
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
          const data = name === "get_project_rules"
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
  installBrowserGlobals(executedCalls);
  const { buildWebcodeInitPrompt } = await import("../src/content/init_context");

  const prompt = await buildWebcodeInitPrompt();

  assert(!prompt.includes("# Available Tools"), "init payload still embeds the Available Tools section");
  assert(!prompt.includes("# Available Skills"), "init payload still embeds the Available Skills section");
  assert(prompt.includes("PROJECT-RULES-MARKER"), "init payload lost the project rules");
  assert(prompt.includes("PROJECT-CONTEXT-MARKER"), "init payload lost the project context");
  assert(prompt.includes("list_tools"), "init payload header must point the model at list_tools");
  assert(prompt.includes("list_skills"), "init payload header must point the model at list_skills");

  const fetchedNames = executedCalls.map((call) => call.name);
  assert(
    fetchedNames.includes("get_project_rules") && fetchedNames.includes("get_project_context"),
    "init payload no longer fetches project rules and context"
  );
  assert(
    !fetchedNames.includes("list_tools") && !fetchedNames.includes("list_skills"),
    "init payload still fetches the tool or skill list eagerly"
  );

  process.stdout.write("OK init payload stays slim and defers tool/skill lists to list_tools/list_skills.\n");
}

void main();
