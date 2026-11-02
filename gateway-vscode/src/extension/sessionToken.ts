/**
 * Browser session persistence for one workspace.
 *
 * The single-latched-token era kept one token in SecretStorage
 * (`webcode.bridgeToken.<workspaceId>`), which made the first browser hold the
 * gateway forever and blocked every later pairing. The session table now lives
 * in `workspaceState` (a Memento), so N browser sessions survive a restart
 * together. SecretStorage is kept only as a read-once migration source: on the
 * first start after the upgrade the legacy token is imported as one session
 * and the old key is deleted, so it cannot resurrect after a disconnect.
 */

export const SESSION_TOKEN_KEY_PREFIX = 'webcode.bridgeToken.';
export const SESSION_STATE_KEY_PREFIX = 'webcode.bridgeSessions.';

/** Shape of one row in the persisted session table. */
export interface StoredBridgeSession {
    token: string;
    siteId: string;
    connectedAt: number;
    lastSeenAt: number;
}

/** Narrow view of `vscode.Memento` so tests can pass an in-memory double. */
export interface MementoLike {
    get(key: string): unknown;
    update(key: string, value: unknown): PromiseLike<void> | void;
}

/** Narrow view of `vscode.SecretStorage` so tests can pass an in-memory double. */
export interface SecretStorageLike {
    get(key: string): PromiseLike<string | undefined>;
    delete(key: string): PromiseLike<void>;
}

/** Anything the session manager can hand a restored/imported token to. */
export type SessionTokenTarget = {
    setSessionToken(token: string): void;
};

export interface BridgeSessionPersistence {
    /** Returns the stored table, or null when nothing valid is stored. */
    load(): Promise<StoredBridgeSession[] | null>;
    save(sessions: readonly StoredBridgeSession[]): Promise<void>;
}

export interface CreateSessionStoreOptions {
    memento: MementoLike;
    workspaceId: string;
}

export function sessionTokenKey(workspaceId: string): string {
    return `${SESSION_TOKEN_KEY_PREFIX}${workspaceId}`;
}

export function sessionStateKey(workspaceId: string): string {
    return `${SESSION_STATE_KEY_PREFIX}${workspaceId}`;
}

/**
 * Persists the session table under `webcode.bridgeSessions.<workspaceId>`.
 * Values are validated on load: anything malformed is treated as "no table"
 * rather than crashing the gateway start.
 */
export function createWorkspaceSessionStore(options: CreateSessionStoreOptions): BridgeSessionPersistence {
    const key = sessionStateKey(options.workspaceId);
    return {
        load: () => Promise.resolve(normalizeStoredSessions(options.memento.get(key))),
        save: async sessions => {
            await options.memento.update(key, sessions.map(session => ({ ...session })));
        }
    };
}

function normalizeStoredSessions(raw: unknown): StoredBridgeSession[] | null {
    if (!Array.isArray(raw)) {
        return null;
    }
    const sessions: StoredBridgeSession[] = [];
    for (const entry of raw) {
        if (!isStoredSession(entry)) {
            return null;
        }
        sessions.push({ ...entry });
    }
    return sessions;
}

function isStoredSession(value: unknown): value is StoredBridgeSession {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.token === 'string' && record.token.length > 0
        && typeof record.siteId === 'string'
        && typeof record.connectedAt === 'number' && Number.isFinite(record.connectedAt)
        && typeof record.lastSeenAt === 'number' && Number.isFinite(record.lastSeenAt);
}

export interface MigrateLegacySessionOptions {
    secrets: SecretStorageLike;
    workspaceId: string;
    log?: (message: string) => void;
}

/**
 * One-time import of the legacy single token. When SecretStorage still holds
 * `webcode.bridgeToken.<workspaceId>` (a tab connected before the upgrade may
 * still present it), the token is registered as a session and the old key is
 * deleted, so a later cold start cannot resurrect it after a disconnect.
 * Returns true when a legacy token was imported.
 */
export async function migrateLegacySessionToken(
    target: SessionTokenTarget,
    options: MigrateLegacySessionOptions
): Promise<boolean> {
    const key = sessionTokenKey(options.workspaceId);
    let legacyToken: string | undefined;
    try {
        legacyToken = await options.secrets.get(key);
    } catch (error: unknown) {
        options.log?.(`Failed to read the legacy bridge session token: ${formatError(error)}`);
        return false;
    }

    if (typeof legacyToken !== 'string' || !legacyToken.trim()) {
        return false;
    }

    target.setSessionToken(legacyToken);
    try {
        await options.secrets.delete(key);
    } catch (error: unknown) {
        // The import still stands; the key will be retried (and ignored when
        // the session table already holds the token) on the next start.
        options.log?.(`Migrated the legacy bridge session token but could not delete ${key}: ${formatError(error)}`);
        return true;
    }
    options.log?.('Migrated the legacy single bridge token into the session table.');
    return true;
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
