import {
  applyAttachmentDeliveryFailures,
  formatGatewayToolResultData,
  normalizeToolResultData,
  parseGatewayToolResult,
  TOOL_ATTACHMENT_MAX_BYTES,
  TOOL_ATTACHMENT_MAX_ENCODED_PAYLOAD_BYTES,
  TOOL_ATTACHMENT_PAYLOAD_LIMIT_ERROR,
  type ToolResultAttachment,
} from "../src/modules/tool_result";
import { isPasteEventAcknowledged } from "../src/modules/attachment_delivery";

const PNG_BASE64 = "iVBORw0KGgo=";

async function main(): Promise<void> {
  await runTest("extracts embedded resource attachments", testEmbeddedResource);
  await runTest("extracts UTF-8 TXT resource attachments", testTextResourceAttachment);
  await runTest("keeps text-only gateway results backward compatible", testTextOnlyResult);
  await runTest("rejects unsupported attachment MIME types", testUnsupportedMimeType);
  await runTest("rejects inherited MIME whitelist keys", testInheritedMimeType);
  await runTest("rejects cumulative attachment payloads above the runtime limit", testAttachmentPayloadLimit);
  await runTest("preserves attachments in buffered result batches", testBufferedAttachments);
  await runTest("rewrites only the failed attachment result", testAttachmentFailureResult);
  await runTest("distinguishes acknowledged paste events", testPasteAcknowledgement);
  await runTest("attaches periodic reminders to the last result of a batch", testReminderGoesToBatchTail);
}

function testTextResourceAttachment(): void {
  const content = "WebCode TXT attachment";
  const result = parseGatewayToolResult({
    content: [{
      type: "resource",
      resource: {
        uri: "workspace:///notes/example.txt",
        mimeType: "text/plain",
        blob: Buffer.from(content, "utf8").toString("base64"),
        _meta: { fileName: "example.txt" },
      },
    }],
  });

  assertEqual(result.attachments.length, 1, "TXT resource was not extracted");
  assertEqual(result.attachments[0]?.name, "example.txt", "TXT attachment filename changed");
  assertEqual(result.attachments[0]?.mimeType, "text/plain", "TXT attachment MIME type changed");
  assertEqual(result.attachments[0]?.size, Buffer.byteLength(content), "TXT attachment size is incorrect");
}

function testEmbeddedResource(): void {
  const result = parseGatewayToolResult({
    content: [
      { type: "text", text: "Inspect the attached file." },
      {
        type: "resource",
        resource: {
          uri: "workspace:///assets/sample%20image.png",
          mimeType: "image/png",
          blob: PNG_BASE64,
          _meta: { fileName: "sample image.png" },
        },
      },
    ],
  });

  assertEqual(result.text, "Inspect the attached file.", "tool result text changed");
  assertEqual(result.attachments.length, 1, "embedded resource was not extracted");
  assertEqual(result.attachments[0]?.name, "sample image.png", "attachment filename changed");
  assertEqual(result.attachments[0]?.mimeType, "image/png", "attachment MIME type changed");
  assertEqual(result.attachments[0]?.size, 8, "attachment decoded size is incorrect");

  const transportData = formatGatewayToolResultData(result);
  assert(typeof transportData !== "string", "attachment result was flattened to text");
  assertEqual(normalizeToolResultData(transportData, "").attachments.length, 1, "transport attachment was lost");
}

function testTextOnlyResult(): void {
  const result = parseGatewayToolResult({
    content: [{ type: "text", text: "plain text" }],
  });

  assertEqual(formatGatewayToolResultData(result), "plain text", "text-only response shape changed");
}

function testUnsupportedMimeType(): void {
  const result = parseGatewayToolResult({
    content: [{
      type: "resource",
      resource: {
        uri: "workspace:///archive.zip",
        mimeType: "application/zip",
        blob: PNG_BASE64,
      },
    }],
  });

  assertEqual(result.attachments.length, 0, "unsupported resource became an upload attachment");
}

function testInheritedMimeType(): void {
  ["constructor", "__proto__"].forEach((mimeType) => {
    const result = parseGatewayToolResult({
      content: [{
        type: "image",
        mimeType,
        data: PNG_BASE64,
      }],
    });

    assertEqual(result.attachments.length, 0, `inherited MIME key ${mimeType} was accepted`);
  });
}

function testAttachmentPayloadLimit(): void {
  const nearLimitBase64 = createBase64OfDecodedSize(TOOL_ATTACHMENT_MAX_BYTES);
  assert(
    nearLimitBase64.length * 3 > TOOL_ATTACHMENT_MAX_ENCODED_PAYLOAD_BYTES,
    "payload fixture does not exceed the cumulative encoded limit"
  );
  const result = parseGatewayToolResult({
    content: Array.from({ length: 3 }, (_, index) => ({
      type: "resource",
      resource: {
        uri: `workspace:///attachment-${index + 1}.png`,
        mimeType: "image/png",
        blob: nearLimitBase64,
      },
    })),
  });

  assertEqual(result.attachments.length, 0, "over-limit attachments remained transportable");
  assertEqual(result.attachmentError, TOOL_ATTACHMENT_PAYLOAD_LIMIT_ERROR, "payload error was not deterministic");
}

function createBase64OfDecodedSize(size: number): string {
  const remainder = size % 3;
  const padding = remainder === 1 ? "==" : remainder === 2 ? "=" : "";
  const encodedLength = Math.ceil(size / 3) * 4;
  return "A".repeat(encodedLength - padding.length) + padding;
}

async function testBufferedAttachments(): Promise<void> {
  installNavigator();
  const { ToolRequestRegistry } = await import("../src/content/tool_request_registry");
  const registry = new ToolRequestRegistry();
  const attachment: ToolResultAttachment = {
    data: PNG_BASE64,
    mimeType: "image/png",
    name: "sample.png",
    size: 8,
  };

  registry.markRunning("request-key");
  registry.markSettled("request-key");
  registry.saveToolResult(
    "request-key",
    "attached",
    { attachments: [attachment], toolName: "attach_file" }
  );
  const batch = registry.buildBufferedResultBatch(["request-key"]);

  assertEqual(batch.attachmentGroups.length, 1, "attachment request association was lost");
  assertEqual(batch.attachmentGroups[0]?.toolName, "attach_file", "attachment tool name changed");
  assertEqual(batch.attachmentGroups[0]?.outputIndex, 0, "attachment output index changed");
  assertEqual(batch.attachmentGroups[0]?.attachments[0]?.name, "sample.png", "buffered attachment changed");
  assertEqual(batch.output.includes("attach_file"), true, "tool result text was not formatted");
  assert(batch.output.includes("attached"), "tool result lost its output");
  assert(!batch.output.includes("request_id"), "public request ID remained in the tool result");
}

async function testAttachmentFailureResult(): Promise<void> {
  installNavigator();
  const { ToolRequestRegistry } = await import("../src/content/tool_request_registry");
  const registry = new ToolRequestRegistry();
  const attachment: ToolResultAttachment = {
    data: PNG_BASE64,
    mimeType: "image/png",
    name: "sample.png",
    size: 8,
  };

  registry.markRunning("attachment-key");
  registry.markSettled("attachment-key");
  registry.saveToolResult(
    "attachment-key",
    "attached",
    { attachments: [attachment], toolName: "attach_file" }
  );
  registry.markRunning("text-key");
  registry.markSettled("text-key");
  registry.saveToolResult("text-key", "text result", { toolName: "read_file" });

  const batch = registry.buildBufferedResultBatch(["attachment-key", "text-key"]);
  const failedParts = applyAttachmentDeliveryFailures(batch.outputParts, [{
    outputIndex: batch.attachmentGroups[0]?.outputIndex ?? -1,
    reason: "The page did not acknowledge the paste.",
    toolName: batch.attachmentGroups[0]?.toolName ?? "attach_file",
  }]);
  const attachmentResult = failedParts[0] ?? "";
  const textResult = failedParts[1] ?? "";

  assert(attachmentResult.includes("attach_file"), "failed attachment result lost its tool name");
  assert(
    attachmentResult.includes("failed") || attachmentResult.includes("没成功"),
    "attachment result did not become an error"
  );
  assert(
    attachmentResult.includes("The page did not acknowledge the paste."),
    "failure reason changed"
  );
  assert(!attachmentResult.includes("attached"), "failed attachment result retained its success output");
  assert(textResult.includes("read_file"), "unrelated tool result lost its tool name");
  assert(
    textResult.includes("done") || textResult.includes("跑完了"),
    "unrelated tool result changed status"
  );
  assert(textResult.includes("text result"), "unrelated tool output changed");
}

function testPasteAcknowledgement(): void {
  assert(isPasteEventAcknowledged(false, true), "canceled paste was not acknowledged");
  assert(isPasteEventAcknowledged(false, false), "dispatch cancellation was not acknowledged");
  assert(!isPasteEventAcknowledged(true, false), "uncanceled paste was treated as acknowledged");
}

function installNavigator(): void {
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { language: "en-US" },
    });
  }
}

async function testReminderGoesToBatchTail(): Promise<void> {
  const { ToolRequestRegistry } = await import("../src/content/tool_request_registry");
  const registry = new ToolRequestRegistry();
  const keys: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const key = `reminder-key-${index}`;
    keys.push(key);
    registry.saveToolResult(key, `result ${index}`, { toolName: "read_file" });
  }
  const batch = registry.buildBufferedResultBatch(keys);

  assertEqual(batch.outputParts.length, 5, "expected five formatted results");
  // The reminder now rides along as its own paragraph instead of a JSON field;
  // match its stable opening instead of the old "system_note" key.
  const systemNoteMarker = "[System] Reminder";
  for (let index = 0; index < 4; index += 1) {
    assert(!batch.outputParts[index].includes(systemNoteMarker),
      `reminder leaked into mid-batch result ${index}`);
  }
  assert(batch.outputParts[4].includes(systemNoteMarker),
    "reminder missing from the last result of the batch");
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
