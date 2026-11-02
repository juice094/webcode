import { describeGatewayConnection, describeGatewayMeta } from "../src/popup/workspaces";
import type { DiscoveredGateway } from "../src/pairing_protocol";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`${message}: expected ${right}, received ${left}`);
  }
}

const t = (key: string, params?: Record<string, string | number>): string => {
  const values: Record<string, string> = {
    port_label: "Port",
    discovered_connect: "Connect",
    discovered_busy: "Busy",
    discovered_connect_alongside: "Connect ({count} connected)",
    discovered_sessions: "{count} sessions connected",
  };
  let text = values[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
};

function main(): void {
  // Idle gateway: plain connect, always clickable.
  const idle: DiscoveredGateway = { port: 34567, workspaceName: "repo", sessionActive: false };
  assertDeepEqual(describeGatewayConnection(idle), { disabled: false, key: "discovered_connect" }, "idle gateway connects plainly");

  // 1.6.0+ gateway with live sessions: multi-connect is allowed and names the count.
  const shared: DiscoveredGateway = { port: 34567, workspaceName: "repo", sessionActive: true, sessionCount: 2 };
  const sharedView = describeGatewayConnection(shared);
  assertEqual(sharedView.disabled, false, "active session must not grey out the button on a 1.6.0+ gateway");
  assertEqual(sharedView.key, "discovered_connect_alongside", "alongside connect wording");
  assertEqual(t(sharedView.key, sharedView.params), "Connect (2 connected)", "count is interpolated");

  // Pre-1.6.0 gateway (no sessionCount field): legacy busy fallback stays.
  const legacy: DiscoveredGateway = { port: 34568, workspaceName: "old", sessionActive: true };
  assertDeepEqual(describeGatewayConnection(legacy), { disabled: true, key: "discovered_busy" }, "old gateway keeps the busy fallback");

  // Zero sessions: clickable plain connect, matching sessionActive semantics.
  const zeroCount: DiscoveredGateway = { port: 34569, workspaceName: "zero", sessionActive: false, sessionCount: 0 };
  assertDeepEqual(describeGatewayConnection(zeroCount), { disabled: false, key: "discovered_connect" }, "zero sessions connect plainly");

  // Meta line shows the count only when the gateway reports one.
  assertEqual(describeGatewayMeta(t, idle), "Port 34567", "idle meta is just the port");
  assertEqual(describeGatewayMeta(t, shared), "Port 34567 · 2 sessions connected", "meta names the live session count");
  assertEqual(describeGatewayMeta(t, legacy), "Port 34568", "old gateway meta stays port-only");
  assertEqual(describeGatewayMeta(t, zeroCount), "Port 34569", "zero-count meta stays port-only");

  console.log("PASS renders multi-session connect buttons with a legacy fallback");
}

main();
