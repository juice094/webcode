import * as crypto from 'crypto';

export const DEFAULT_BRIDGE_CODE_TTL_MS = 60 * 1000;

const MAX_PENDING_BRIDGE_CODES = 64;

export interface PendingBridgeLaunch {
    siteId: string;
    targetUrl: string;
}

type PendingBridgeCode = PendingBridgeLaunch & {
    expiresAt: number;
};

type RandomSecretFactory = () => string;

function createRandomSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Owns the short-lived launch codes and the browser session token shared by the
 * current gateway lifecycle. Launch codes are safe to place in a URL because they
 * expire quickly and can be consumed only once. The API session token is returned
 * only by the redemption response. It is revoked when the gateway stops or
 * cold-restarts, and preserved across hot configuration reloads so connected
 * browser tabs keep working (see GatewayLifecycleOptions.preserveBridgeSession).
 *
 * The token itself now outlives the process: the extension resolves it from a
 * persisted source (see extension/sessionToken.ts) and seeds it here on every
 * start, so a window reload or extension restart does not force a browser
 * re-pair. `clear()` still revokes the in-memory token, but a later start
 * re-seeds the same persisted value; `rotate()` at the source is what actually
 * invalidates connected tabs.
 *
 * The code TTL is retargetable so a hot reload can apply
 * webcodeGateway.timeouts.bridgeCodeTtlSeconds without recreating the manager
 * (recreating it would revoke the session token being preserved).
 */
export class BridgeSessionManager {
    private readonly pendingCodes = new Map<string, PendingBridgeCode>();
    private activeSessionToken: string | null = null;

    constructor(
        private bridgeCodeTtlMs = DEFAULT_BRIDGE_CODE_TTL_MS,
        private readonly now: () => number = Date.now,
        private readonly createSecret: RandomSecretFactory = createRandomSecret
    ) { }

    /**
     * Applies a new TTL to codes issued from now on. Codes already issued keep
     * the expiry they were created with, so a configuration reload never extends
     * a launch code that is already in flight.
     */
    setBridgeCodeTtlMs(ttlMs: number): void {
        this.bridgeCodeTtlMs = ttlMs;
    }

    issueBridgeCode(launch: PendingBridgeLaunch): string {
        this.cleanupExpiredCodes();
        this.enforcePendingCodeLimit();

        let code = this.createSecret();
        while (this.pendingCodes.has(code)) {
            code = this.createSecret();
        }

        this.pendingCodes.set(code, {
            ...launch,
            expiresAt: this.now() + this.bridgeCodeTtlMs
        });
        return code;
    }

    getBridgeLaunch(code: string): PendingBridgeLaunch | null {
        this.cleanupExpiredCodes();
        const pending = this.pendingCodes.get(code);
        return pending ? { siteId: pending.siteId, targetUrl: pending.targetUrl } : null;
    }

    consumeBridgeCode(code: string): PendingBridgeLaunch | null {
        this.cleanupExpiredCodes();
        const pending = this.pendingCodes.get(code);
        if (!pending) {
            return null;
        }

        this.pendingCodes.delete(code);
        return {
            siteId: pending.siteId,
            targetUrl: pending.targetUrl
        };
    }

    /**
     * Seeds the token resolved from the persisted source. Called on every start,
     * including cold restarts, which is what makes a reconnecting tab keep
     * working without a new launch code.
     */
    setSessionToken(token: string): void {
        this.activeSessionToken = token;
    }

    activateSession(): string {
        this.activeSessionToken ??= this.createSecret();
        return this.activeSessionToken;
    }

    isSessionTokenValid(token: string | undefined): boolean {
        return Boolean(token && this.activeSessionToken && token === this.activeSessionToken);
    }

    /** True while a browser tab holds a session token for this lifecycle. */
    hasActiveSession(): boolean {
        return this.activeSessionToken !== null;
    }

    /** TTL applied to codes issued from now on. */
    getBridgeCodeTtlMs(): number {
        return this.bridgeCodeTtlMs;
    }

    clear(): void {
        this.pendingCodes.clear();
        this.activeSessionToken = null;
    }

    private cleanupExpiredCodes(): void {
        const now = this.now();
        for (const [code, pending] of this.pendingCodes) {
            if (pending.expiresAt <= now) {
                this.pendingCodes.delete(code);
            }
        }
    }

    private enforcePendingCodeLimit(): void {
        while (this.pendingCodes.size >= MAX_PENDING_BRIDGE_CODES) {
            const oldestCode = this.pendingCodes.keys().next().value;
            if (!oldestCode) {
                return;
            }
            this.pendingCodes.delete(oldestCode);
        }
    }
}
