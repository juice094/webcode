async function main(): Promise<void> {
  installBrowserGlobals();
  const [{ ToolCallTracker }, { ToolRequestRegistry }, { parseToolCall }] = await Promise.all([
    import("../src/content/tool_call_tracker"),
    import("../src/content/tool_request_registry"),
    import("../src/modules/toolCallProtocol"),
  ]);
  const registry = new ToolRequestRegistry();
  const tracker = new ToolCallTracker({
    requestRegistry: registry,
    scheduleMainLoop: () => undefined,
  });
  const parseCall = () => parseToolCall(JSON.stringify({
    arguments: { path: "README.md" },
    mcp_action: "call",
    name: "read_file",
    purpose: "Read the project documentation",
    request_id: "legacy-model-id",
  }));

  await runTest("discards legacy model request IDs", () => {
    assert(!("request_id" in parseCall()), "legacy request ID leaked into the execution payload");
  });

  await runTest("keeps a DOM call stable across code element replacement", () => {
    const location = domLocation("conversation-1", 0);
    const first = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), location, 0);
    const replacement = tracker.ensurePayloadRequestIdentity(parseCall(), fakeCodeElement(), location, 0);
    assertEqual(replacement.requestKey, first.requestKey, "replacement code element changed the call key");
  });

  await runTest("keeps a DOM call stable across message element replacement", () => {
    const first = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-1", 0),
      0
    );
    const replacement = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-1", 0),
      0
    );
    assertEqual(replacement.requestKey, first.requestKey, "replacement message element changed the call key");
  });

  await runTest("isolates identical calls in separate conversation messages", () => {
    const first = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-1", 0),
      0
    );
    const second = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-1", 1),
      0
    );
    assert(first.requestKey !== second.requestKey, "separate messages reused an internal call key");
  });

  await runTest("isolates identical DOM calls in separate conversations", () => {
    const first = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-1", 0),
      0
    );
    const second = tracker.ensurePayloadRequestIdentity(
      parseCall(),
      fakeCodeElement(),
      domLocation("conversation-2", 0),
      0
    );
    assert(first.requestKey !== second.requestKey, "separate conversations reused an internal call key");
  });

  await runTest("scopes network calls to their conversation turn", () => {
    const first = tracker.ensureNetworkPayloadRequestIdentity(parseCall(), "conversation-1:message-1", 0);
    const repeated = tracker.ensureNetworkPayloadRequestIdentity(parseCall(), "conversation-1:message-1", 0);
    const nextConversation = tracker.ensureNetworkPayloadRequestIdentity(
      parseCall(),
      "conversation-2:message-1",
      0
    );
    assertEqual(repeated.requestKey, first.requestKey, "repeated network capture changed the call key");
    assert(first.requestKey !== nextConversation.requestKey, "network conversations reused an internal call key");
  });

  const { markGatewayInitCompleted } = await import("../src/content/init_state");

  await runTest("pre-init protocol error feedback includes the init call format", () => {
    const identity = tracker.handleNetworkProtocolError("not json", "turn-pre-init", 0, new Error("parse failed"));
    const batch = registry.buildBufferedResultBatch([identity.requestKey]);
    assert(
      batch.output.includes("Initialization tool format"),
      "pre-init feedback lost the init call format"
    );
  });

  await runTest("post-init protocol error feedback drops the init call format", () => {
    markGatewayInitCompleted();
    const identity = tracker.handleNetworkProtocolError("not json", "turn-post-init", 0, new Error("parse failed"));
    const batch = registry.buildBufferedResultBatch([identity.requestKey]);
    assert(
      !batch.output.includes("Initialization tool format"),
      "post-init feedback still invites a redundant re-init"
    );
    assert(
      batch.output.includes("Standard tool format"),
      "post-init feedback lost the standard call format"
    );
  });
}

function fakeCodeElement(): HTMLElement {
  return { dataset: {} } as HTMLElement;
}

function domLocation(conversationKey: string, messageIndex: number) {
  return { conversationKey, messageIndex };
}

function installBrowserGlobals(): void {
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
        sendMessage: (_message: unknown, callback?: (response: unknown) => void) => {
          callback?.({ success: true });
        },
      },
    },
  });
}

async function runTest(name: string, test: () => void | Promise<void>): Promise<void> {
  try {
    await test();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

void main();
