import './vscodeStub';

import * as assert from 'assert';
import { BRIDGE_PROTOCOL_VERSION, PROTOCOL } from '@webcode/shared';
import type * as vscode from 'vscode';

import { GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';
import type { SessionTokenSource } from '../extension/sessionToken';
import type { ResolvedAiSiteConfig } from '../platforms';

const BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
const TEST_EXTENSION_VERSION = '1.3.0';
const IDLE_TIMEOUT_NEVER_MS = 60 * 60 * 1000;
const PERSISTED_TOKEN = 'persisted-bridge-token-0123456789abcdef';

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

function createProvider(token = PERSISTED_TOKEN): SessionTokenSource {
    return {
        mode: 'secret-storage',
        get: () => Promise.resolve(token),
        rotate: () => Promise.resolve(`${token}-rotated`)
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
    test('keeps the same bridge token valid after a stop and a fresh start', async function () {
        this.timeout(20000);
        const provider = createProvider();
        const first = createManager();
        first.setResumeState({ tokenProvider: provider, lastInterrupted: null });
        let port: number;

        try {
            const started = await first.start(createTestConfig(45530));
            port = started.port;
            const token = await redeemBridgeToken(first, port);
            assert.strictEqual(token, PERSISTED_TOKEN, 'redemption must return the seeded token');
            assert.strictEqual((await requestStatus(port, token)).status, 200);
        } finally {
            await first.stop();
        }

        // A brand-new manager models the next extension host: same persisted
        // source, no in-memory state.
        const second = createManager();
        second.setResumeState({ tokenProvider: provider, lastInterrupted: null });
        try {
            const restarted = await second.start(createTestConfig(port));
            assert.strictEqual(
                (await requestStatus(restarted.port, PERSISTED_TOKEN)).status,
                200,
                'the tab token must still be accepted after a restart'
            );
        } finally {
            await second.stop();
        }
    });

    test('still revokes the token on restart when no persisted source is configured', async function () {
        this.timeout(20000);
        const first = createManager();
        let port: number;
        let token: string;

        try {
            const started = await first.start(createTestConfig(45531));
            port = started.port;
            token = await redeemBridgeToken(first, port);
            assert.notStrictEqual(token, PERSISTED_TOKEN);
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
        manager.setResumeState({ tokenProvider: createProvider(), lastInterrupted: null });

        try {
            const started = await manager.start(createTestConfig(45532));
            manager.markShuttingDown();

            const response = await requestStatus(started.port, PERSISTED_TOKEN);
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
        manager.setResumeState({ tokenProvider: createProvider(), lastInterrupted });

        try {
            const started = await manager.start(createTestConfig(45533));
            assert.strictEqual(typeof started.instanceId, 'string');
            const body = (await requestStatus(started.port, PERSISTED_TOKEN)).body ?? {};
            const firstInstanceId = typeof body.gatewayInstanceId === 'string' ? body.gatewayInstanceId : null;
            assert.ok(firstInstanceId, 'status must expose the gateway instance id');
            assert.deepStrictEqual(body.lastInterrupted, lastInterrupted);

            const restarted = await manager.start(createTestConfig(started.port), { preserveBridgeSession: true });
            const after = (await requestStatus(restarted.port, PERSISTED_TOKEN)).body ?? {};
            assert.notStrictEqual(after.gatewayInstanceId, firstInstanceId, 'a restart must change the instance id');
        } finally {
            await manager.stop();
        }
    });
});
