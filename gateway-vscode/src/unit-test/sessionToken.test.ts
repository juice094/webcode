import * as assert from 'assert';

import {
    createWorkspaceSessionStore,
    migrateLegacySessionToken,
    sessionStateKey,
    sessionTokenKey,
    type MementoLike,
    type SecretStorageLike,
    type StoredBridgeSession
} from '../extension/sessionToken';

type FakeMemento = MementoLike & { values: Map<string, unknown> };

function createFakeMemento(): FakeMemento {
    const values = new Map<string, unknown>();
    return {
        values,
        get: key => values.get(key),
        update: (key, value) => {
            values.set(key, value);
            return Promise.resolve();
        }
    };
}

type FakeSecrets = SecretStorageLike & { values: Map<string, string> };

function createFakeSecrets(): FakeSecrets {
    const values = new Map<string, string>();
    return {
        values,
        get: key => Promise.resolve(values.get(key)),
        delete: key => {
            values.delete(key);
            return Promise.resolve();
        }
    };
}

function createTarget(): { setSessionToken: (token: string) => void; tokens: string[] } {
    const tokens: string[] = [];
    return {
        tokens,
        setSessionToken: token => {
            tokens.push(token);
        }
    };
}

const SESSION_ROW: StoredBridgeSession = {
    token: 'token-one',
    siteId: 'chatgpt',
    connectedAt: 1000,
    lastSeenAt: 2000
};

suite('Bridge session store', () => {
    test('returns null when nothing is stored', async () => {
        const store = createWorkspaceSessionStore({ memento: createFakeMemento(), workspaceId: 'ws-a' });
        assert.strictEqual(await store.load(), null);
    });

    test('round-trips the session table under the workspace key', async () => {
        const memento = createFakeMemento();
        const store = createWorkspaceSessionStore({ memento, workspaceId: 'ws-a' });

        await store.save([SESSION_ROW]);
        assert.deepStrictEqual(await store.load(), [SESSION_ROW]);
        assert.ok(memento.values.has(sessionStateKey('ws-a')), 'the table must be stored per workspace');

        // A second store instance models the next extension host.
        const nextHost = createWorkspaceSessionStore({ memento, workspaceId: 'ws-a' });
        assert.deepStrictEqual(await nextHost.load(), [SESSION_ROW], 'the table must survive a restart');
    });

    test('isolates session tables per workspace', async () => {
        const memento = createFakeMemento();
        await createWorkspaceSessionStore({ memento, workspaceId: 'ws-a' }).save([SESSION_ROW]);

        const other = createWorkspaceSessionStore({ memento, workspaceId: 'ws-b' });
        assert.strictEqual(await other.load(), null);
    });

    test('treats a malformed stored table as absent instead of crashing', async () => {
        const memento = createFakeMemento();
        memento.values.set(sessionStateKey('ws-a'), [{ token: 42 }]);
        const store = createWorkspaceSessionStore({ memento, workspaceId: 'ws-a' });
        assert.strictEqual(await store.load(), null);
    });
});

suite('Legacy single-token migration', () => {
    test('imports the legacy SecretStorage token as a session and deletes the old key', async () => {
        const secrets = createFakeSecrets();
        secrets.values.set(sessionTokenKey('ws-a'), 'legacy-token');
        const target = createTarget();

        const migrated = await migrateLegacySessionToken(target, { secrets, workspaceId: 'ws-a' });

        assert.strictEqual(migrated, true);
        assert.deepStrictEqual(target.tokens, ['legacy-token']);
        assert.ok(!secrets.values.has(sessionTokenKey('ws-a')), 'the legacy key must be retired after the import');
    });

    test('does nothing when no legacy token exists', async () => {
        const secrets = createFakeSecrets();
        const target = createTarget();

        const migrated = await migrateLegacySessionToken(target, { secrets, workspaceId: 'ws-a' });

        assert.strictEqual(migrated, false);
        assert.deepStrictEqual(target.tokens, []);
    });
});
