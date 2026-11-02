import * as crypto from 'crypto';

import type { StoredBridgeSession } from '../extension/sessionToken';

export const UNKNOWN_SITE_ID = 'unknown';

/**
 * One connected browser. Every redemption mints a fresh token and registers a
 * new record, so N isolated browser instances can hold independent sessions
 * against the same gateway (and the same workspace) at once. `lastSeenAt` is
 * refreshed by the auth middleware on every authenticated request, so a tab
 * that stops talking eventually becomes sweepable (see
 * `setIdleTimeoutMs`; 0 disables expiry).
 */
export interface BridgeSessionRecord {
    token: string;
    siteId: string;
    connectedAt: number;
    lastSeenAt: number;
}

type RandomSecretFactory = () => string;

function createRandomSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
}

/**
 * Owns the Map<token, session> table. Persistence and sweeping orchestration
 * live with the owner (GatewayManager): the registry is a synchronous,
 * unit-testable core that reports which tokens it revoked so the owner can
 * release their write locks and persist the new table.
 */
export class BridgeSessionRegistry {
    private readonly sessions = new Map<string, BridgeSessionRecord>();
    private idleTimeoutMs = 0;

    constructor(
        private readonly now: () => number = Date.now,
        private readonly createSecret: RandomSecretFactory = createRandomSecret
    ) { }

    /** 0 disables idle expiry. */
    setIdleTimeoutMs(idleTimeoutMs: number): void {
        this.idleTimeoutMs = Math.max(0, idleTimeoutMs);
    }

    /** Mints a fresh token and registers a new session for it. */
    register(siteId: string | undefined): BridgeSessionRecord {
        this.sweepExpired();
        let token = this.createSecret();
        while (this.sessions.has(token)) {
            token = this.createSecret();
        }
        const timestamp = this.now();
        const record: BridgeSessionRecord = {
            token,
            siteId: siteId?.trim() ? siteId : UNKNOWN_SITE_ID,
            connectedAt: timestamp,
            lastSeenAt: timestamp
        };
        this.sessions.set(token, record);
        return record;
    }

    /**
     * Registers a token minted elsewhere (legacy persisted token, restored
     * session table). Never mints, never overwrites an existing record, and
     * never reports the session as freshly connected.
     */
    importToken(token: string, siteId?: string): BridgeSessionRecord {
        const existing = this.sessions.get(token);
        if (existing) {
            return existing;
        }
        const timestamp = this.now();
        const record: BridgeSessionRecord = {
            token,
            siteId: siteId?.trim() ? siteId : UNKNOWN_SITE_ID,
            connectedAt: timestamp,
            lastSeenAt: timestamp
        };
        this.sessions.set(token, record);
        return record;
    }

    /**
     * Auth-middleware lookup: a hit refreshes `lastSeenAt` and returns the
     * session for request attribution (write-lock ownership); a miss is null.
     */
    lookup(token: string | undefined): BridgeSessionRecord | null {
        if (!token) {
            return null;
        }
        const record = this.sessions.get(token);
        if (!record) {
            return null;
        }
        record.lastSeenAt = this.now();
        return record;
    }

    /** Live session count after an expiry sweep. */
    count(): number {
        this.sweepExpired();
        return this.sessions.size;
    }

    hasSessions(): boolean {
        return this.count() > 0;
    }

    /**
     * Revokes every session, returning the revoked tokens so the owner can
     * force-release their write locks. Used by the disconnect-browsers
     * command (the rotate-all semantic the single-token era promised).
     */
    revokeAll(): string[] {
        const revoked = [...this.sessions.keys()];
        this.sessions.clear();
        return revoked;
    }

    /** Restores a persisted session table (e.g. from workspaceState). */
    restore(records: readonly StoredBridgeSession[]): void {
        for (const record of records) {
            this.sessions.set(record.token, { ...record });
        }
        this.sweepExpired();
    }

    /** Serializes the live table for persistence; stable order across saves. */
    snapshot(): StoredBridgeSession[] {
        this.sweepExpired();
        return [...this.sessions.values()]
            .sort((left, right) => left.connectedAt - right.connectedAt || left.token.localeCompare(right.token))
            .map(record => ({ ...record }));
    }

    clear(): void {
        this.sessions.clear();
    }

    /** Drops sessions silent for longer than the idle timeout; 0 never expires. */
    sweepExpired(): string[] {
        if (this.idleTimeoutMs <= 0) {
            return [];
        }
        const cutoff = this.now() - this.idleTimeoutMs;
        const revoked: string[] = [];
        for (const [token, record] of this.sessions) {
            if (record.lastSeenAt <= cutoff) {
                this.sessions.delete(token);
                revoked.push(token);
            }
        }
        return revoked;
    }
}
