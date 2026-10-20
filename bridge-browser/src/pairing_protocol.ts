/**
 * Messages used by the popup to discover local gateways and request a pairing.
 *
 * Kept apart from the content-script message union on purpose: these messages
 * are only legitimate from the extension's own pages (popup / service worker),
 * never from a web page, so the background router checks them before the general
 * content-script gate. See background/messages.ts for the sender rule.
 */

export interface DiscoverGatewaysMessageRequest {
  type: "DISCOVER_GATEWAYS";
}

export interface RequestConnectMessageRequest {
  type: "REQUEST_CONNECT";
  /** Port of the workspace the user picked from the discovery list. */
  port: number;
  /** Page whose origin is asking for the pairing; defaults to the active tab. */
  tabId?: number;
  /** Known site id, when the caller already has one. The gateway can infer it. */
  siteId?: string;
}

export type PairingMessageRequest = DiscoverGatewaysMessageRequest | RequestConnectMessageRequest;

export interface DiscoveredGateway {
  port: number;
  workspaceName: string | null;
  sessionActive: boolean;
}

export type PairingErrorCode =
  | "declined"
  | "rate-limited"
  | "no-workspace"
  | "unknown-site"
  | "forbidden-origin"
  | "unsupported-media-type"
  | "invalid-request"
  | "unreachable"
  | "version-mismatch"
  | "invalid-response"
  | "invalid-sender"
  | "no-tab"
  | "invalid-port"
  | "unavailable";

export interface DiscoverGatewaysResponse {
  success: boolean;
  gateways?: DiscoveredGateway[];
  error?: string;
}

export interface RequestConnectResponse {
  success: boolean;
  targetUrl?: string;
  error?: string;
  code?: PairingErrorCode;
}

export function isPairingMessageRequest(value: unknown): value is PairingMessageRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "DISCOVER_GATEWAYS") {
    return true;
  }
  if (record.type !== "REQUEST_CONNECT") {
    return false;
  }

  return typeof record.port === "number" &&
    Number.isInteger(record.port) &&
    (record.tabId === undefined || (typeof record.tabId === "number" && Number.isInteger(record.tabId))) &&
    (record.siteId === undefined || typeof record.siteId === "string");
}
