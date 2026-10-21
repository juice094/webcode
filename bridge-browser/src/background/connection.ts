import { BRANDING, BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { type HandshakeMessageRequest, type HandshakeResponse, isStoredSession } from '../types';
import type { PairingErrorCode } from '../pairing_protocol';
import { describePairingError, readPairingErrorCode } from './pairing_errors';
import { updateBadge } from './badge';
import {
  getBridgeRedemptionError,
  normalizeRedeemedBridgeSession,
  type RedeemedBridgeSession,
} from './bridge_redemption';
import { fetchInitDataFromGateway } from './init_sync';
import { getSessionPresetSettings } from './presets';
import { clearSessionExpiryCheck, scheduleSessionExpiryCheck } from './session_health';
import { removeSession, saveSession } from './sessions';

interface HandshakeParams {
  port: number;
  bridgeCode: string;
  bridgeProtocolVersion: number;
  force?: boolean;
  vscodeExtensionVersion: string;
  browserExtensionVersion: string;
}

type BridgeRedemptionResult =
  | { success: true; session: RedeemedBridgeSession }
  | { success: false; error: string };

const BRIDGE_REDEMPTION_TIMEOUT_MS = 5000;

export async function handleHandshake(
  request: HandshakeMessageRequest,
  tabId: number | null | undefined
): Promise<HandshakeResponse> {
  const params = getHandshakeParams(request);

  if (!tabId) {return { success: false, error: "No Tab ID" };}
  if (!params) {
    return { success: false, error: "Invalid handshake parameters" };
  }

  if (!params.force) {
    const conflictTabId = await findConflictTabId(params.port, tabId);
    if (conflictTabId) {
      try {
        const tab = await chrome.tabs.get(parseInt(conflictTabId, 10));
        if (tab) {
          return { success: false, error: "BUSY", conflictTabId };
        }
      } catch {
        const staleTabId = parseInt(conflictTabId, 10);
        await removeSession(staleTabId);
        await clearSessionExpiryCheck(staleTabId);
      }
    }
  }

  const redemption = await redeemBridgeCode(
    params.port,
    params.bridgeCode,
    params.browserExtensionVersion,
    params.bridgeProtocolVersion
  );
  if (!redemption.success) {
    return redemption;
  }
  const session = redemption.session;
  if (session.vscodeExtensionVersion !== params.browserExtensionVersion) {
    return { success: false, error: "VS Code and browser extension versions do not match." };
  }
  if (session.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return { success: false, error: "VS Code and browser bridge protocol versions do not match." };
  }

  await bindSession(tabId, {
    port: params.port,
    token: session.token,
    workspaceId: session.workspaceId,
    siteId: session.siteId,
    targetOrigin: session.targetOrigin,
    targetUrl: session.targetUrl,
    idleTimeoutMs: session.idleTimeoutMs,
    bridgeRequestMs: session.bridgeRequestMs,
    gatewayInstanceId: session.gatewayInstanceId,
  });
  return { success: true, targetUrl: session.targetUrl };
}

interface BindSessionOptions {
  port: number;
  token: string;
  workspaceId: string;
  siteId: string;
  targetOrigin: string;
  targetUrl: string;
  idleTimeoutMs: number;
  bridgeRequestMs?: number;
  /** Absent when an older gateway did not report its instance id. */
  gatewayInstanceId?: string;
}

export async function bindSession(tabId: number, options: BindSessionOptions) {
  const presetSettings = await getSessionPresetSettings();
  const lastGatewayActivityAt = Date.now();
  const session = {
    port: options.port,
    token: options.token,
    showLog: false,
    autoSend: true,
    autoApproveTools: presetSettings.defaultApprovalMode === "never-ask",
    approvalMode: presetSettings.defaultApprovalMode,
    workspaceId: options.workspaceId,
    lastGatewayActivityAt,
    gatewayIdleTimeoutMs: options.idleTimeoutMs,
    bridgeRequestMs: options.bridgeRequestMs,
    siteId: options.siteId,
    targetOrigin: options.targetOrigin,
    targetUrl: options.targetUrl,
    gatewayInstanceId: options.gatewayInstanceId,
  };
  await saveSession(tabId, session);
  scheduleSessionExpiryCheck(tabId, lastGatewayActivityAt, options.idleTimeoutMs);
  console.log(`${BRANDING.logPrefix} Tab ${tabId} bound to Port ${options.port} [Workspace: ${options.workspaceId}]`);
  updateBadge(tabId, true);
  // [Sync] Notify Content Script
  void chrome.tabs.sendMessage(tabId, {
    type: "STATUS_UPDATE",
    connected: true,
    workspaceId: options.workspaceId,
    siteId: options.siteId,
    autoSend: session.autoSend,
    autoApproveTools: session.autoApproveTools,
    approvalMode: session.approvalMode,
  }).catch(ignoreRuntimeError);
  // 不再 await，避免网关初始化请求阻塞握手响应
  void fetchInitDataFromGateway(options.port, options.token, options.bridgeRequestMs);
}

function ignoreRuntimeError(_error: unknown): void {
  void chrome.runtime.lastError;
}

function getHandshakeParams(request: HandshakeMessageRequest): HandshakeParams | null {
  if (
    !isValidPort(request.port) ||
    !isNonEmptyString(request.bridgeCode) ||
    !isCompatibleExtensionVersions(request)
  ) {
    return null;
  }

  return {
    port: request.port,
    bridgeCode: request.bridgeCode,
    bridgeProtocolVersion: request.bridgeProtocolVersion,
    force: request.force,
    vscodeExtensionVersion: request.vscodeExtensionVersion,
    browserExtensionVersion: request.browserExtensionVersion,
  };
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65535;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCompatibleExtensionVersions(request: HandshakeMessageRequest): boolean {
  const currentBrowserVersion = chrome.runtime.getManifest().version;

  return isNonEmptyString(request.vscodeExtensionVersion) &&
    isNonEmptyString(request.browserExtensionVersion) &&
    request.bridgeProtocolVersion === BRIDGE_PROTOCOL_VERSION &&
    request.vscodeExtensionVersion === currentBrowserVersion &&
    request.browserExtensionVersion === currentBrowserVersion;
}

async function redeemBridgeCode(
  port: number,
  bridgeCode: string,
  browserExtensionVersion: string,
  bridgeProtocolVersion: number
): Promise<BridgeRedemptionResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRIDGE_REDEMPTION_TIMEOUT_MS);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/bridge/redeem`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridgeCode, browserExtensionVersion, bridgeProtocolVersion }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        error: getBridgeRedemptionError(body),
      };
    }

    const session = normalizeRedeemedBridgeSession(body);
    return session
      ? { success: true, session }
      : { success: false, error: "Gateway returned an invalid bridge session." };
  } catch {
    return { success: false, error: "Gateway bridge redemption failed." };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findConflictTabId(port: number, tabId: number): Promise<string | null> {
  const all = await chrome.storage.local.get(null) as Record<string, unknown>;
  for (const [key, val] of Object.entries(all)) {
    if (isConflictingSession(key, val, port, tabId)) {
      return key.replace("session_", "");
    }
  }

  return null;
}

function isConflictingSession(key: string, value: unknown, port: number, tabId: number): boolean {
  return key.startsWith("session_") &&
    isStoredSession(value) &&
    value.port === port &&
    key !== `session_${tabId}`;
}

export type RequestConnectionParams = {
  tabId: number;
  port: number;
  requestOrigin: string;
  siteId?: string;
};

export type RequestConnectionResult =
  | { success: true; targetUrl: string }
  | { success: false; error: string; code: PairingErrorCode };

/**
 * Pairing without the /bridge page: ask the gateway for a launch code, redeem it
 * and bind this tab directly. The gateway shows a modal in VS Code, so this call
 * deliberately has no client deadline: the user may take a while to answer.
 */
export async function requestBridgeConnection(
  params: RequestConnectionParams
): Promise<RequestConnectionResult> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${params.port}/v1/session/request`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestOrigin: params.requestOrigin,
        ...(params.siteId ? { siteId: params.siteId } : {}),
      }),
    });
  } catch {
    return { success: false, error: "Could not reach the VS Code gateway.", code: "unreachable" };
  }

  if (!response.ok) {
    const code = await readPairingErrorCode(response);
    return { success: false, error: describePairingError(code), code };
  }

  const payload = await readPairingPayload(response);
  if (!payload) {
    return { success: false, error: "The gateway returned an invalid pairing response.", code: "invalid-response" };
  }

  const redemption = await redeemBridgeCode(
    params.port,
    payload.bridgeCode,
    chrome.runtime.getManifest().version,
    BRIDGE_PROTOCOL_VERSION
  );
  if (!redemption.success) {
    return { success: false, error: redemption.error, code: "invalid-response" };
  }

  const session = redemption.session;
  if (session.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    return {
      success: false,
      error: "VS Code and browser bridge protocol versions do not match.",
      code: "version-mismatch",
    };
  }

  await bindSession(params.tabId, {
    port: params.port,
    token: session.token,
    workspaceId: session.workspaceId,
    siteId: session.siteId,
    targetOrigin: session.targetOrigin,
    targetUrl: session.targetUrl,
    idleTimeoutMs: session.idleTimeoutMs,
    bridgeRequestMs: session.bridgeRequestMs,
  });

  return { success: true, targetUrl: session.targetUrl };
}

async function readPairingPayload(response: Response): Promise<{ bridgeCode: string } | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      return null;
    }
    const bridgeCode = (body as Record<string, unknown>).bridgeCode;
    const targetUrl = (body as Record<string, unknown>).targetUrl;
    return typeof bridgeCode === "string" && bridgeCode && typeof targetUrl === "string"
      ? { bridgeCode }
      : null;
  } catch {
    return null;
  }
}
