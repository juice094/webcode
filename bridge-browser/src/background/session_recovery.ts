/**
 * Decides what to do when a health probe of the gateway comes back.
 *
 * The gateway can now hand back the same session token after a restart, so a
 * probe that fails is no longer automatically fatal:
 *
 * - `online` → keep the session; `recovered` is true when the gateway reports a
 *   different instance id than the one this tab paired with, which is how the
 *   UI knows the tab just survived a restart.
 * - `unauthorized` → retry once (the token may have been rotated mid-flight, or
 *   the request may have raced a restart); only a second 401 expires the session.
 * - `offline` → the gateway is gone; expire with the existing reason so the tab
 *   shows the disconnect hint.
 */
export type GatewayProbeStatus = 'online' | 'offline' | 'unauthorized';

export type SessionRecoveryDecision =
    | { action: 'keep'; instanceId?: string; recovered: boolean }
    | { action: 'retry' }
    | { action: 'expire'; reason: 'invalid_token' | 'gateway_unavailable' };

export function decideSessionRecovery(input: {
    status: GatewayProbeStatus;
    gatewayInstanceId?: string;
    sessionInstanceId?: string;
    alreadyRetried: boolean;
}): SessionRecoveryDecision {
    if (input.status === 'online') {
        const changed = Boolean(input.gatewayInstanceId) && input.gatewayInstanceId !== input.sessionInstanceId;
        return { action: 'keep', instanceId: input.gatewayInstanceId, recovered: changed };
    }

    if (input.status === 'unauthorized' && !input.alreadyRetried) {
        return { action: 'retry' };
    }

    return {
        action: 'expire',
        reason: input.status === 'unauthorized' ? 'invalid_token' : 'gateway_unavailable'
    };
}
