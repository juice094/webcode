import { BRIDGE_PORT_RANGE_END, BRIDGE_PORT_RANGE_START } from "@webcode/shared";

import { bridgePortRange, parsePingResponse, sortGateways } from "../src/background/discovery";
import { describePairingError, readPairingErrorCode } from "../src/background/pairing_errors";
import { isPairingMessageRequest } from "../src/pairing_protocol";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

async function main(): Promise<void> {
  const ports = bridgePortRange();
  assertEqual(ports.length, BRIDGE_PORT_RANGE_END - BRIDGE_PORT_RANGE_START + 1, "port range length");
  assertEqual(ports[0], BRIDGE_PORT_RANGE_START, "port range start");
  assertEqual(ports[ports.length - 1], BRIDGE_PORT_RANGE_END, "port range end");

  const ping = { schema: 1, product: "webcode", workspaceName: "repo", sessionActive: false };
  assertEqual(parsePingResponse(ping, 34567)?.workspaceName, "repo", "workspace name kept");
  assertEqual(parsePingResponse(ping, 34567)?.port, 34567, "requested port kept");
  assertEqual(parsePingResponse({ ...ping, workspaceName: null }, 34567)?.workspaceName, null, "null workspace name");
  assertEqual(parsePingResponse({ ...ping, schema: 2 }, 34567), null, "unknown schema rejected");
  assertEqual(parsePingResponse({ ...ping, sessionActive: "yes" }, 34567), null, "non-boolean session rejected");
  assertEqual(parsePingResponse({ ...ping, product: 5 }, 34567), null, "non-string product rejected");
  assertEqual(parsePingResponse("gateway", 34567), null, "non-object rejected");

  const sorted = sortGateways([
    { port: 34569, workspaceName: "c", sessionActive: false },
    { port: 34567, workspaceName: "a", sessionActive: true },
    { port: 34568, workspaceName: "b", sessionActive: false },
  ], 34569);
  assertEqual(sorted.map(gateway => gateway.port).join(","), "34569,34567,34568", "preferred port first");

  assertEqual(isPairingMessageRequest({ type: "DISCOVER_GATEWAYS" }), true, "discover accepted");
  assertEqual(isPairingMessageRequest({ type: "REQUEST_CONNECT", port: 34567 }), true, "connect accepted");
  assertEqual(
    isPairingMessageRequest({ type: "REQUEST_CONNECT", port: 34567, tabId: 3, siteId: "chatgpt" }),
    true,
    "connect with tab and site accepted"
  );
  assertEqual(isPairingMessageRequest({ type: "REQUEST_CONNECT" }), false, "connect without port rejected");
  assertEqual(isPairingMessageRequest({ type: "REQUEST_CONNECT", port: "34567" }), false, "string port rejected");
  assertEqual(isPairingMessageRequest({ type: "REQUEST_CONNECT", port: 1.5 }), false, "fractional port rejected");
  assertEqual(isPairingMessageRequest({ type: "HANDSHAKE", port: 34567 }), false, "content message is not pairing");
  assertEqual(isPairingMessageRequest(null), false, "null rejected");

  const declined = await readPairingErrorCode(new Response(JSON.stringify({ error: "declined" }), { status: 403 }));
  assertEqual(declined, "declined", "declined code preserved");
  const unknown = await readPairingErrorCode(new Response("nope", { status: 500 }));
  assertEqual(unknown, "invalid-response", "unparseable body falls back");
  const limited = await readPairingErrorCode(new Response("nope", { status: 429 }));
  assertEqual(limited, "rate-limited", "429 without body maps to rate limiting");
  assert(describePairingError("declined").includes("declined"), "declined text");
  assertEqual(describePairingError("invalid-sender").length > 0, true, "unknown codes still get text");

  console.log("PASS scans bridge ports and validates pairing discovery payloads");
}

void main();
