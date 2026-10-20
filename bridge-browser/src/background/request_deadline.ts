/**
 * Single-request deadline for calls from the bridge to the local gateway.
 *
 * The deadline comes from the VS Code extension through session.bridgeRequestMs
 * during bridge redemption; 0 or a missing value means "wait as long as the
 * request takes". Only the current request is affected and no state is kept
 * between requests, so an idle MV3 service worker can still be suspended.
 */
export interface RequestDeadline {
  /** 0 when no deadline was configured. */
  timeoutMs: number;
  signal: AbortSignal | undefined;
  timedOut: () => boolean;
  dispose: () => void;
}

const DISABLED_DEADLINE: RequestDeadline = {
  timeoutMs: 0,
  signal: undefined,
  timedOut: () => false,
  dispose: () => undefined,
};

export function createRequestDeadline(timeoutMs: number | undefined): RequestDeadline {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DISABLED_DEADLINE;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    timeoutMs,
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => clearTimeout(timer),
  };
}

/** Error text for a deadline that fired before the gateway answered. */
export function formatRequestTimeout(timeoutMs: number, detail?: string): string {
  const suffix = detail ? ` ${detail}` : "";
  return `Request timed out after ${timeoutMs} ms.${suffix}`;
}
