import './vscodeStub';

import * as assert from 'assert';
import { BRIDGE_PROTOCOL_VERSION, PROTOCOL } from '@webcode/shared';
import type * as vscode from 'vscode';

import { GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';
import {
    sessionTokenKey,
    type BridgeSessionPersistence,
    type SecretStorageLike,
    type StoredBridgeSession
} from '../extension/sessionToken';
import type { ResolvedAiSiteConfig } from '../platforms';

const BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
const TEST_EXTENSION_VERSION = '1.6.0';
const IDLE_TIMEOUT_NEVER_MS = 60 * 60 * 1000;
const LEGACY_TOKEN = 'legacy-persisted-bridge-token-0123456789abcdef';

/**
 * Port 0 lets the OS pick a free port. Hard-coded ports are unreliable on
 * Windows, where Hyper-V/WSL2 reserve dynamic port ranges that netstat does
 * not show but that reject bind() with EADDRINUSE.
 */
const DYNAMIC_PORT = 0;

const TEST_SITE: ResolvedAiSiteConfig = {
    id: 'chatgpt',
    name: 'ChatGPT',
    address: 'https://chatgpt.com/',
    showQuickLaunch: true,
    browser: 'isolated-edge',
    selectors: {
        messageBlocks: '.message',
        codeBlocks: 'pre code',
        inputArea: 'textarea',
        sendButton: 'button.send',
        stopButton: 'button.stop'
    }
};

type MemoryStore = BridgeSessionPersistence & { rows: StoredBridgeSession[] | null };

/** Models workspaceState: the table survives across manager instances. */
function createMemoryStore(): MemoryStore {
    const store: MemoryStore = {
        rows: null,
        load: () => Promise.resolve(store.rows ? store.rows.map(row => ({ ...row })) : null),
        save: sessions => {
            store.rows = sessions.map(row => ({ ...row }));
            return Promise.resolve();
        }
    };
    return store;
}

type FakeSecrets = SecretStorageLike & { values: Map<string, string> };

function createFakeSecrets(initial?: string): FakeSecrets {
    const values = new Map<string, string>();
    if (initial) {
        values.set(sessionTokenKey('ws-a'), initial);
    }
    return {
        values,
        get: key => Promise.resolve(values.get(key)),
        delete: key => {
            values.delete(key);
            return Promise.resolve();
        }
    };
}

function createManager(): GatewayManager {
    const outputChannel = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
    const context = {
        extension: { packageJSON: { version: TEST_EXTENSION_VERSION } }
    } as unknown as vscode.ExtensionContext;
    return new GatewayManager(outputChannel, process.cwd(), context);
}

function createTestConfig(port: number): GatewayConfig {
    return {
        port,
        idleTimeoutMs: IDLE_TIMEOUT_NEVER_MS,
        mcpServers: {},
        allowedOrigins: [],
        aiSites: [TEST_SITE]
    };
}

type StatusResponse = {
    status: number;
    retryAfter: string | null;
    body: Record<string, unknown> | null;
};

async function requestStatus(port: number, token?: string): Promise<StatusResponse> {
    return withConnectionRetry(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/status`, {
            headers: token ? { [PROTOCOL.authHeaderLowerName]: token } : {}
        });
        const body = parseJsonObject(await response.text());
        return { status: response.status, retryAfter: response.headers.get('retry-after'), body };
    });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
    try {
        const parsed: unknown = text ? JSON.parse(text) : null;
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

async function redeemBridgeToken(manager: GatewayManager, port: number): Promise<string> {
    const bridgeCode = manager.issueBridgeCode(TEST_SITE.id, TEST_SITE.address);
    const response = await fetch(`http://127.0.0.1:${port}/v1/bridge/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BRIDGE_EXTENSION_ORIGIN },
        body: JSON.stringify({
            bridgeCode,
            browserExtensionVersion: TEST_EXTENSION_VERSION,
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION
        })
    });
    const body = await response.json() as { token?: unknown };
    assert.strictEqual(typeof body.token, 'string');
    return body.token as string;
}

function isConnectionReset(error: unknown): boolean {
    // Same undici caveat as gatewayLifecycle.test.ts: a destroyed keep-alive
    // socket surfaces as UND_ERR_SOCKET, not ECONNRESET.
    const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
    const code = cause?.code;
    return code === 'ECONNRESET'
        || code === 'EPIPE'
        || code === 'UND_ERR_SOCKET'
        || code === 'UND_ERR_CLOSED';
}

async function withConnectionRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error: unknown) {
        if (!isConnectionReset(error)) {
            throw error;
        }
        return operation();
    }
}

suite('Gateway resume across restarts', () => {
    test('keeps redeemed sessions valid after a stop and a fresh start', async function () {
        this.timeout(20000);
        const store = createMemoryStore();
        const first = createManager();
        first.setResumeState({ sessionStore: store, lastInterrupted: null });
        let port: number;
        let token: string;

        try {
            const started = await first.start(createTestConfig(DYNAMIC_PORT));
            port = started.port;
            token = await redeemBridgeToken(first, port);
            assert.strictEqual((await requestStatus(port, token)).status, 200);
        } finally {
            await first.stop();
        }

        // A brand-new manager models the next extension host: same persisted
        // table, no in-memory state.
        const second = createManager();
        second.setResumeState({ sessionStore: store, lastInterrupted: null });
        try {
            const restarted = await second.start(createTestConfig(port));
            assert.strictEqual(
                (await requestStatus(restarted.port, token)).status,
                200,
                'the redeemed session must still be accepted after a restart'
            );
        } finally {
            await second.stop();
        }
    });

    test('imports the legacy SecretStorage token as a session on first start', async function () {
        this.timeout(20000);
        const store = createMemoryStore();
        const secrets = createFakeSecrets(LEGACY_TOKEN);
        const manager = createManager();
        manager.setResumeState({
            sessionStore: store,
            legacySecrets: secrets,
            workspaceId: 'ws-a',
            lastInterrupted: null
        });

        try {
            const started = await manager.start(createTestConfig(DYNAMIC_PORT));

            assert.strictEqual(
                (await requestStatus(started.port, LEGACY_TOKEN)).status,
                200,
                'a tab holding the pre-upgrade token must stay connected'
            );
            assert.ok(!secrets.values.has(sessionTokenKey('ws-a')), 'the legacy key must be retired after the import');

            const freshToken = await redeemBridgeToken(manager, started.port);
            assert.notStrictEqual(freshToken, LEGACY_TOKEN, 'redemption must mint a new token, not reuse the legacy one');
            assert.strictEqual((await requestStatus(started.port, freshToken)).status, 200);
        } finally {
            await manager.stop();
        }
    });

    test('still revokes sessions on restart when no persisted source is configured', async function () {
        this.timeout(20000);
        const first = createManager();
        let port: number;
        let token: string;

        try {
            const started = await first.start(createTestConfig(DYNAMIC_PORT));
            port = started.port;
            token = await redeemBridgeToken(first, port);
        } finally {
            await first.stop();
        }

        const second = createManager();
        try {
            const restarted = await second.start(createTestConfig(port));
            assert.strictEqual(
                (await requestStatus(restarted.port, token)).status,
                403,
                'without a persisted source the old behavior stays: cold start revokes'
            );
        } finally {
            await second.stop();
        }
    });

    test('rejects new work with 503 while shutting down', async function () {
        this.timeout(20000);
        const manager = createManager();
        manager.setResumeState({ sessionStore: createMemoryStore(), lastInterrupted: null });

        try {
            const started = await manager.start(createTestConfig(DYNAMIC_PORT));
            const token = await redeemBridgeToken(manager, started.port);
            manager.markShuttingDown();

            const response = await requestStatus(started.port, token);
            assert.strictEqual(response.status, 503);
            assert.strictEqual(response.retryAfter, '2');
        } finally {
            await manager.stop();
        }
    });

    test('reports a new instance id on every start and the interrupted call count', async function () {
        this.timeout(20000);
        const manager = createManager();
        const lastInterrupted = { count: 2, savedAt: '2026-10-22T02:10:00.000Z' };
        manager.setResumeState({ sessionStore: createMemoryStore(), lastInterrupted });

        try {
            const started = await manager.start(createTestConfig(DYNAMIC_PORT));
            assert.strictEqual(typeof started.instanceId, 'string');
            const token = await redeemBridgeToken(manager, started.port);
            const body = (await requestStatus(started.port, token)).body ?? {};
            const firstInstanceId = typeof body.gatewayInstanceId === 'string' ? body.gatewayInstanceId : null;
            assert.ok(firstInstanceId, 'status must expose the gateway instance id');
            assert.deepStrictEqual(body.lastInterrupted, lastInterrupted);

            const restarted = await manager.start(createTestConfig(started.port), { preserveBridgeSession: true });
            const after = (await requestStatus(restarted.port, token)).body ?? {};
            assert.notStrictEqual(after.gatewayInstanceId, firstInstanceId, 'a restart must change the instance id');
        } finally {
            await manager.stop();
        }
    });
});
