import { BRIDGE_PORT_RANGE_END, BRIDGE_PORT_RANGE_START } from '@webcode/shared';

import type { DiscoveredGateway } from '../pairing_protocol';

/**
 * Discovery probes every port the bridge extension can talk to. One loopback
 * round trip per port, 1.5 s each: a cold gateway answers in milliseconds, so
 * the timeout only guards against a port that accepts but never replies.
 */
export const PING_TIMEOUT_MS = 1500;
export const LAST_GATEWAY_PORT_KEY = "lastGatewayPort";

export function bridgePortRange(): number[] {
  const ports: number[] = [];
  for (let port = BRIDGE_PORT_RANGE_START; port <= BRIDGE_PORT_RANGE_END; port += 1) {
    ports.push(port);
  }
  return ports;
}

/** Validates one /v1/ping payload; anything unexpected is treated as "not a gateway". */
export function parsePingResponse(value: unknown, port: number): DiscoveredGateway | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.schema !== 1 || typeof record.product !== "string") {
    return null;
  }
  if (record.workspaceName !== null && typeof record.workspaceName !== "string") {
    return null;
  }
  if (typeof record.sessionActive !== "boolean") {
    return null;
  }

  return {
    port,
    workspaceName: record.workspaceName,
    sessionActive: record.sessionActive,
  };
}

/** Preferred workspace first (last successful port), then ascending port order. */
export function sortGateways(gateways: DiscoveredGateway[], preferredPort: number | null): DiscoveredGateway[] {
  return [...gateways].sort((left, right) => {
    if (left.port === preferredPort && right.port !== preferredPort) {return -1;}
    if (right.port === preferredPort && left.port !== preferredPort) {return 1;}
    return left.port - right.port;
  });
}

export async function discoverGateways(): Promise<DiscoveredGateway[]> {
  const preferredPort = await readPreferredPort();
  const results = await Promise.allSettled(bridgePortRange().map(probeGateway));
  const gateways: DiscoveredGateway[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      gateways.push(result.value);
    }
  }

  const sorted = sortGateways(gateways, preferredPort);
  const first = sorted[0];
  if (first) {
    await chrome.storage.local.set({ [LAST_GATEWAY_PORT_KEY]: first.port });
  }
  return sorted;
}

async function readPreferredPort(): Promise<number | null> {
  const stored = await chrome.storage.local.get([LAST_GATEWAY_PORT_KEY]);
  const value = stored[LAST_GATEWAY_PORT_KEY];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

async function probeGateway(port: number): Promise<DiscoveredGateway | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/ping`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return parsePingResponse(await response.json(), port);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
