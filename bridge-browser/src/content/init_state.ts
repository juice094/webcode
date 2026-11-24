/**
 * Session-scoped flag: the gateway init payload has been assembled at least
 * once in this page session. Protocol-error feedback uses it to decide whether
 * re-showing the initialization call format can help (pre-init) or would only
 * invite a redundant re-init (post-init). Resets on page reload, which is
 * acceptable: the hint is labelled as pre-init-only either way.
 */
let gatewayInitCompleted = false;

export function markGatewayInitCompleted(): void {
  gatewayInitCompleted = true;
}

export function isGatewayInitCompleted(): boolean {
  return gatewayInitCompleted;
}
