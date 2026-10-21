import { decideSessionRecovery } from "../src/background/session_recovery";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {throw new Error(message);}
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function main(): void {
  const sameInstance = decideSessionRecovery({
    status: "online",
    gatewayInstanceId: "gw-1",
    sessionInstanceId: "gw-1",
    alreadyRetried: false,
  });
  assertEqual(sameInstance.action, "keep", "online must keep the session");
  assert(sameInstance.action === "keep" && sameInstance.recovered === false, "an unchanged instance is not a recovery");

  const restarted = decideSessionRecovery({
    status: "online",
    gatewayInstanceId: "gw-2",
    sessionInstanceId: "gw-1",
    alreadyRetried: false,
  });
  assert(restarted.action === "keep", "online must keep the session");
  assert(restarted.action === "keep" && restarted.recovered === true, "a new instance id is a recovery");
  assert(restarted.action === "keep" && restarted.instanceId === "gw-2", "the new instance id must be reported back");

  const legacy = decideSessionRecovery({
    status: "online",
    gatewayInstanceId: "gw-2",
    sessionInstanceId: undefined,
    alreadyRetried: false,
  });
  assert(legacy.action === "keep" && legacy.recovered === true, "a legacy session without an id must adopt the gateway id");

  const firstUnauthorized = decideSessionRecovery({
    status: "unauthorized",
    gatewayInstanceId: "gw-2",
    sessionInstanceId: "gw-1",
    alreadyRetried: false,
  });
  assertEqual(firstUnauthorized.action, "retry", "a first 401 must be retried before expiring");

  const secondUnauthorized = decideSessionRecovery({
    status: "unauthorized",
    gatewayInstanceId: "gw-2",
    sessionInstanceId: "gw-1",
    alreadyRetried: true,
  });
  assert(secondUnauthorized.action === "expire", "a second 401 must expire the session");
  assert(secondUnauthorized.action === "expire" && secondUnauthorized.reason === "invalid_token", "401 must map to invalid_token");

  const offline = decideSessionRecovery({
    status: "offline",
    gatewayInstanceId: undefined,
    sessionInstanceId: "gw-1",
    alreadyRetried: false,
  });
  assert(offline.action === "expire", "offline must expire the session");
  assert(offline.action === "expire" && offline.reason === "gateway_unavailable", "offline must map to gateway_unavailable");

  const offlineRetried = decideSessionRecovery({
    status: "offline",
    gatewayInstanceId: undefined,
    sessionInstanceId: "gw-1",
    alreadyRetried: true,
  });
  assert(offlineRetried.action === "expire", "offline is not retried");

  console.log("PASS session recovery decisions across restarts");
}

main();
