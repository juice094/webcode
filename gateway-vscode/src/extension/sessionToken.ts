import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Where the bridge session token comes from.
 *
 * The token used to be a random string held only in memory, so every window
 * reload or extension restart invalidated it and forced a browser re-pair.
 * It is now stable per workspace:
 *
 * - `secret-storage` (preferred): random token stored in VS Code SecretStorage
 *   under `webcode.bridgeToken.<workspaceId>`. Encrypted by the OS keyring,
 *   revocable per workspace, blast radius limited to one workspace.
 * - `derived` (fallback when SecretStorage is unavailable): HMAC-SHA256 over a
 *   machine secret kept in `globalStorage/machine-secret`. Revoking means
 *   rotating the machine secret, which invalidates every workspace.
 * - `memory` (last resort, no persistence possible): the pre-Plan-D behavior,
 *   random per session; a warning is logged once.
 */
export const SESSION_TOKEN_KEY_PREFIX = 'webcode.bridgeToken.';
export const MACHINE_SECRET_FILE_NAME = 'machine-secret';

const TOKEN_BYTES = 32;
const MACHINE_SECRET_BYTES = 32;

export type SessionTokenMode = 'secret-storage' | 'derived' | 'memory';

export interface SessionTokenSource {
    readonly mode: SessionTokenMode;
    /** Current token; generates and persists one on first use. */
    get(): Promise<string>;
    /** Issues a new token and persists it, invalidating the previous one. */
    rotate(): Promise<string>;
}

/** Narrow view of `vscode.SecretStorage` so tests can pass an in-memory double. */
export interface SecretStorageLike {
    // VS Code returns Thenable, so accept anything awaitable.
    get(key: string): PromiseLike<string | undefined>;
    store(key: string, value: string): PromiseLike<void>;
    delete(key: string): PromiseLike<void>;
}

export interface SessionTokenSourceOptions {
    secrets?: SecretStorageLike;
    workspaceId: string;
    /** Directory for the derived-mode machine secret, usually globalStorage. */
    storageDir?: string;
    log?: (message: string) => void;
}

/** Anything that can hold the active bridge token (the session manager). */
export type SessionTokenTarget = {
    setSessionToken(token: string): void;
};

export function sessionTokenKey(workspaceId: string): string {
    return `${SESSION_TOKEN_KEY_PREFIX}${workspaceId}`;
}

function createRandomToken(): string {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function deriveToken(machineSecret: string, workspaceId: string): string {
    return crypto
        .createHmac('sha256', machineSecret)
        .update(sessionTokenKey(workspaceId))
        .digest('base64url');
}

function readMachineSecret(filePath: string): string {
    try {
        const existing = fs.readFileSync(filePath, 'utf8').trim();
        if (existing) {
            return existing;
        }
    } catch {
        // fall through and create one
    }

    const secret = crypto.randomBytes(MACHINE_SECRET_BYTES).toString('base64url');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
    return secret;
}

/**
 * Resolves the persisted token and hands it to the session manager. Called on
 * every gateway start; a failure is logged but never blocks the start (the
 * session manager simply keeps its in-memory token).
 */
export async function seedSessionToken(
    target: SessionTokenTarget,
    provider: SessionTokenSource | null,
    log?: (message: string) => void
): Promise<void> {
    if (!provider) {
        return;
    }
    try {
        target.setSessionToken(await provider.get());
    } catch (error: unknown) {
        log?.(`Failed to resolve the bridge session token: ${formatError(error)}`);
    }
}

/** Rotates the persisted token, invalidating every connected tab. */
export async function rotateSessionToken(
    target: SessionTokenTarget,
    provider: SessionTokenSource | null
): Promise<boolean> {
    if (!provider?.rotate) {
        return false;
    }
    target.setSessionToken(await provider.rotate());
    return true;
}

export async function createSessionTokenSource(options: SessionTokenSourceOptions): Promise<SessionTokenSource> {
    const { secrets, workspaceId, storageDir, log } = options;
    const key = sessionTokenKey(workspaceId);
    const machineSecretPath = storageDir ? path.join(storageDir, MACHINE_SECRET_FILE_NAME) : undefined;

    if (secrets) {
        try {
            const stored = await secrets.get(key);
            if (typeof stored === 'string' && stored.trim()) {
                return createStoredSource(secrets, key, stored);
            }
            const fresh = createRandomToken();
            await secrets.store(key, fresh);
            return createStoredSource(secrets, key, fresh);
        } catch (error: unknown) {
            log?.(`Session token storage unavailable, falling back to a derived token: ${formatError(error)}`);
        }
    }

    if (machineSecretPath) {
        try {
            const machineSecret = readMachineSecret(machineSecretPath);
            return {
                mode: 'derived',
                get: () => Promise.resolve(deriveToken(machineSecret, workspaceId)),
                rotate: () => {
                    const rotated = crypto.randomBytes(MACHINE_SECRET_BYTES).toString('base64url');
                    fs.writeFileSync(machineSecretPath, `${rotated}\n`, { encoding: 'utf8', mode: 0o600 });
                    return Promise.resolve(deriveToken(rotated, workspaceId));
                }
            };
        } catch (error: unknown) {
            log?.(`Derived token fallback failed: ${formatError(error)}`);
        }
    }

    log?.('Bridge session token cannot be persisted; connected tabs will need one re-pair after a restart.');
    let memoryToken = createRandomToken();
    return {
        mode: 'memory',
        get: () => Promise.resolve(memoryToken),
        rotate: () => {
            memoryToken = createRandomToken();
            return Promise.resolve(memoryToken);
        }
    };
}

function createStoredSource(secrets: SecretStorageLike, key: string, initial: string): SessionTokenSource {
    let token = initial;
    return {
        mode: 'secret-storage',
        get: () => Promise.resolve(token),
        rotate: async () => {
            token = createRandomToken();
            await secrets.store(key, token);
            return token;
        }
    };
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
