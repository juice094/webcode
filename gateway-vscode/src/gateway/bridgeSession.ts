import * as crypto from 'crypto';

import type { StoredBridgeSession } from '../extension/sessionToken';
import { BridgeSessionRegistry, type BridgeSessionRecord } from './sessionRegistry';

export const DEFAULT_BRIDGE_CODE_TTL_MS = 60 * 1000;

const MAX_PENDING_BRIDGE_CODES = 64;

export interface PendingBridgeLaunch {
    siteId: string;
    targetUrl: string;
}

/**
 * Identity a redeeming browser reports about itself. Currently only the site
 * it launched for; kept as an interface so future attributes (browser label,
 * profile) do not change every call site.
 */
export interface BrowserSessionIdentity {
    siteId?: string;
}

export type { BridgeSessionRecord };

type PendingBridgeCode = PendingBridgeLaunch & {
    expiresAt: number;
};

type RandomSecretFactory = () => string;

function createRandomSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Owns the short-lived launch codes and the browser session table of the
 * current gateway lifecycle. Launch codes are safe to place in a URL because
 * they expire quickly and can be consumed only once.
 *
 * Sessions are multi-tenant: every redemption mints a NEW token and registers
 * a session in the registry (see sessionRegistry.ts), so any number of
 * isolated browser instances can pair with the same gateway at once. The
 * table is restored from the persisted source on every start (see
 * GatewayManager.restoreBridgeSessions), which keeps connected tabs working
 * across a window reload or extension restart without a new launch code.
 * Revoking a token (clear, idle sweep, or a full-table rotation) is what
 * actually invalidates a connected tab.
 *
 * The code TTL is retargetable so a hot reload can apply
 * webcodeGateway.timeouts.bridgeCodeTtlSeconds without recreating the manager
 * (recreating it would revoke the sessions being preserved).
 */
export class BridgeSessionManager {
    private readonly pendingCodes = new Map<string, PendingBridgeCode>();
    private readonly sessions: BridgeSessionRegistry;
    private readonly createSecret: RandomSecretFactory;

    constructor(
        private bridgeCodeTtlMs = DEFAULT_BRIDGE_CODE_TTL_MS,
        private readonly now: () => number = Date.now,
        createSecret: RandomSecretFactory = createRandomSecret
    ) {
        this.createSecret = createSecret;
        this.sessions = new BridgeSessionRegistry(now, createSecret);
    }

    /**
     * Applies a new TTL to codes issued from now on. Codes already issued keep
     * the expiry they were created with, so a configuration reload never extends
     * a launch code that is already in flight.
     */
    setBridgeCodeTtlMs(ttlMs: number): void {
        this.bridgeCodeTtlMs = ttlMs;
    }

    /** TTL applied to codes issued from now on. */
    getBridgeCodeTtlMs(): number {
        return this.bridgeCodeTtlMs;
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
     * Registers a token resolved from the persisted source (session table or,
     * on first start after the upgrade, the legacy single token). Called on
     * every start; importing never mints and never resets an existing record.
     */
    setSessionToken(token: string): void {
        this.sessions.importToken(token);
    }

    importSessions(records: readonly StoredBridgeSession[]): void {
        this.sessions.restore(records);
    }

    listSessions(): StoredBridgeSession[] {
        return this.sessions.snapshot();
    }

    /**
     * Mints a fresh token for every redemption and registers it as a new
     * session, so each browser instance holds its own token.
     */
    activateSession(identity: BrowserSessionIdentity = {}): string {
        return this.sessions.register(identity.siteId).token;
    }

    /**
     * Auth-middleware lookup: a hit refreshes `lastSeenAt` and returns the
     * session for request attribution (write-lock ownership); a miss is null.
     */
    lookupSession(token: string | undefined): BridgeSessionRecord | null {
        return this.sessions.lookup(token);
    }

    isSessionTokenValid(token: string | undefined): boolean {
        return this.sessions.lookup(token) !== null;
    }

    /** Live session count after an idle-expiry sweep. */
    getSessionCount(): number {
        return this.sessions.count();
    }

    /** True while any browser tab holds a session token for this lifecycle. */
    hasActiveSession(): boolean {
        return this.sessions.hasSessions();
    }

    /**
     * Rotates the whole session table, revoking every connected tab. Returns
     * the revoked tokens so the owner can force-release their write locks.
     * This is the disconnect-browsers semantic.
     */
    rotateAllSessions(): string[] {
        return this.sessions.revokeAll();
    }

    /** 0 disables idle expiry. */
    setSessionIdleTimeoutMs(idleTimeoutMs: number): void {
        this.sessions.setIdleTimeoutMs(idleTimeoutMs);
    }

    /** Drops sessions silent past the idle timeout; returns revoked tokens. */
    sweepExpiredSessions(): string[] {
        return this.sessions.sweepExpired();
    }

    clear(): void {
        this.pendingCodes.clear();
        this.sessions.clear();
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
