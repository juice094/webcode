export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_IDLE_TIMEOUT_MINUTES = 5;
export const MAX_IDLE_TIMEOUT_MINUTES = 240;

const MILLISECONDS_PER_MINUTE = 60 * 1000;

export function resolveIdleTimeoutMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_IDLE_TIMEOUT_MINUTES;
    }

    return Math.min(
        MAX_IDLE_TIMEOUT_MINUTES,
        Math.max(MIN_IDLE_TIMEOUT_MINUTES, Math.trunc(value))
    );
}

export function resolveIdleTimeoutMs(value: unknown): number {
    return resolveIdleTimeoutMinutes(value) * MILLISECONDS_PER_MINUTE;
}

export function formatIdleTimeoutMinutes(idleTimeoutMs: number): string {
    return String(Math.round(idleTimeoutMs / MILLISECONDS_PER_MINUTE));
}

export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30;
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 0;
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 1_440;

/**
 * Per-session idle expiry: a browser session that has not issued any
 * authenticated request for this long is swept (its write lock is
 * force-released and later requests get 403 so the bridge runs its
 * session_recovery flow). 0 disables expiry, matching the gateway-wide idle
 * timeout convention.
 */
export function resolveSessionIdleTimeoutMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES;
    }

    return Math.min(
        MAX_SESSION_IDLE_TIMEOUT_MINUTES,
        Math.max(MIN_SESSION_IDLE_TIMEOUT_MINUTES, Math.trunc(value))
    );
}
