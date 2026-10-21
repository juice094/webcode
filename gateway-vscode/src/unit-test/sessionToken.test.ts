import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    createSessionTokenSource,
    sessionTokenKey,
    type SecretStorageLike
} from '../extension/sessionToken';

type FakeSecrets = SecretStorageLike & { values: Map<string, string> };

function createFakeSecrets(options: { failOnGet?: boolean; failOnStore?: boolean } = {}): FakeSecrets {
    const values = new Map<string, string>();
    return {
        values,
        get: (key: string) => {
            if (options.failOnGet) {
                return Promise.reject(new Error('secret storage unavailable'));
            }
            return Promise.resolve(values.get(key));
        },
        store: (key: string, value: string) => {
            if (options.failOnStore) {
                return Promise.reject(new Error('secret storage read-only'));
            }
            values.set(key, value);
            return Promise.resolve();
        },
        delete: (key: string) => {
            values.delete(key);
            return Promise.resolve();
        }
    };
}

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-token-'));
}

suite('Bridge session token source', () => {
    test('generates once, persists, and survives a restart', async () => {
        const secrets = createFakeSecrets();
        const first = await createSessionTokenSource({ secrets, workspaceId: 'ws-a' });
        const initial = await first.get();

        assert.strictEqual(first.mode, 'secret-storage');
        assert.ok(initial.length >= 32, 'token must be long enough to be unguessable');
        assert.strictEqual(secrets.values.get(sessionTokenKey('ws-a')), initial);

        // A second source instance models the next extension host.
        const second = await createSessionTokenSource({ secrets, workspaceId: 'ws-a' });
        assert.strictEqual(await second.get(), initial, 'a restart must reuse the persisted token');
    });

    test('isolates tokens per workspace', async () => {
        const secrets = createFakeSecrets();
        const a = await createSessionTokenSource({ secrets, workspaceId: 'ws-a' });
        const b = await createSessionTokenSource({ secrets, workspaceId: 'ws-b' });

        assert.notStrictEqual(await a.get(), await b.get());
        assert.strictEqual(secrets.values.size, 2);
    });

    test('rotate issues a new token and persists it', async () => {
        const secrets = createFakeSecrets();
        const source = await createSessionTokenSource({ secrets, workspaceId: 'ws-a' });
        const initial = await source.get();
        const rotated = await source.rotate();

        assert.notStrictEqual(rotated, initial);
        assert.strictEqual(await source.get(), rotated);
        assert.strictEqual(secrets.values.get(sessionTokenKey('ws-a')), rotated);

        const nextHost = await createSessionTokenSource({ secrets, workspaceId: 'ws-a' });
        assert.strictEqual(await nextHost.get(), rotated);
    });

    test('falls back to a derived token when SecretStorage is unavailable', async () => {
        const storageDir = createTempDir();
        const secrets = createFakeSecrets({ failOnGet: true });
        const first = await createSessionTokenSource({ secrets, workspaceId: 'ws-a', storageDir });
        const token = await first.get();

        assert.strictEqual(first.mode, 'derived');
        assert.ok(fs.existsSync(path.join(storageDir, 'machine-secret')), 'the machine secret must be persisted');

        const second = await createSessionTokenSource({ secrets, workspaceId: 'ws-a', storageDir });
        assert.strictEqual(await second.get(), token, 'the derived token must be stable across hosts');
    });

    test('falls back to an in-memory token when nothing can be persisted', async () => {
        const first = await createSessionTokenSource({ workspaceId: 'ws-a' });
        const token = await first.get();

        assert.strictEqual(first.mode, 'memory');
        assert.notStrictEqual(await first.rotate(), token);

        const second = await createSessionTokenSource({ workspaceId: 'ws-a' });
        assert.notStrictEqual(await second.get(), token, 'without persistence a new host gets a new token');
    });
});
