import {
    migrateLegacySessionToken,
    type BridgeSessionPersistence,
    type SecretStorageLike
} from '../extension/sessionToken';
import type { BridgeSessionManager } from './bridgeSession';
import type { GatewayErrorLogger, GatewayLogger } from './types';
import type { WriteLock } from './writeLock';

/** How often the per-session idle sweep runs while the gateway is up. */
export const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

export interface SessionMaintenanceDeps {
    log: GatewayLogger;
    error: GatewayErrorLogger;
    /** Fired after the session table changed outside a redemption. */
    onChanged?: () => void;
}

export interface SessionPersistenceState {
    sessionStore?: BridgeSessionPersistence | null;
    legacySecrets?: SecretStorageLike | null;
    workspaceId?: string;
}

/**
 * Session-table persistence, idle sweep, and disconnect-all, kept out of
 * GatewayManager so the manager file stays inside the repository's line
 * budget. The owner (GatewayManager) supplies the session manager, the write
 * lock, and logging; every path that mutates the table funnels through here
 * so lock release and persistence cannot drift apart.
 */
export class SessionMaintenance {
    private persistence: BridgeSessionPersistence | null = null;
    private legacySecrets: SecretStorageLike | null = null;
    private workspaceId: string | null = null;
    private sweepTimer: NodeJS.Timeout | null = null;

    constructor(
        private readonly sessions: BridgeSessionManager,
        private readonly writeLock: WriteLock,
        private readonly deps: SessionMaintenanceDeps
    ) { }

    configure(state: SessionPersistenceState): void {
        this.persistence = state.sessionStore ?? null;
        this.legacySecrets = state.legacySecrets ?? null;
        this.workspaceId = state.workspaceId ?? null;
    }

    /** Fired after the session table changed outside a redemption. */
    setOnChanged(handler: (() => void) | null): void {
        this.deps.onChanged = handler ?? undefined;
    }

    /**
     * Restart continuity for the multi-session table: the workspaceState
     * store is the primary source and restores every connected tab at once.
     * When nothing is stored (first start after the upgrade), the legacy
     * SecretStorage single token is imported as one session and its key is
     * deleted so a later cold start cannot resurrect it.
     */
    async restore(): Promise<void> {
        if (this.persistence) {
            try {
                const stored = await this.persistence.load();
                if (stored && stored.length > 0) {
                    this.sessions.importSessions(stored);
                    this.deps.log(`🔐 Restored ${stored.length} browser session(s) from the persisted session table.`);
                    return;
                }
            } catch (error: unknown) {
                this.deps.error('Failed to load the persisted bridge session table.', error);
            }
        }

        if (this.legacySecrets && this.workspaceId) {
            await migrateLegacySessionToken(this.sessions, {
                secrets: this.legacySecrets,
                workspaceId: this.workspaceId,
                log: message => this.deps.log(message)
            });
        }
    }

    /** Fire-and-forget: losing a session-table save must never break a request. */
    persist(): void {
        if (!this.persistence) {
            return;
        }
        this.persistence.save(this.sessions.listSessions()).catch(error => {
            this.deps.error('Failed to persist the bridge session table.', error);
        });
    }

    /**
     * Runs the per-session idle sweep while the gateway is up, so expired
     * sessions release their write locks and disappear from the ping count
     * even when no request happens to arrive for them.
     */
    startSweep(): void {
        this.stopSweep();
        this.sweepTimer = setInterval(() => this.sweepExpired(), SESSION_SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    stopSweep(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
    }

    /** Lazy sweep used by the auth middleware; returns the revoked tokens. */
    sweepExpired(): string[] {
        return this.handleExpired(this.sessions.sweepExpiredSessions());
    }

    /**
     * Rotates the whole session table (the disconnect-browsers command): all
     * connected tabs must re-pair. Returns how many sessions were revoked.
     */
    disconnectAll(): number {
        const revoked = this.sessions.rotateAllSessions();
        this.writeLock.releaseForTokens(revoked);
        this.persist();
        this.deps.log(`🔌 Disconnected ${revoked.length} browser session(s); every tab must re-pair.`);
        this.deps.onChanged?.();
        return revoked.length;
    }

    /** Shared tail of every sweep: release locks, persist, log, refresh UI. */
    private handleExpired(revoked: string[]): string[] {
        if (revoked.length === 0) {
            return revoked;
        }
        this.writeLock.releaseForTokens(revoked);
        this.persist();
        this.deps.log(`🧹 Swept ${revoked.length} idle browser session(s).`);
        this.deps.onChanged?.();
        return revoked;
    }
}
