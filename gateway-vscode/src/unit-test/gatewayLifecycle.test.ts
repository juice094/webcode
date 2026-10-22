import './vscodeStub';

import * as assert from 'assert';
import { BRIDGE_PROTOCOL_VERSION, PROTOCOL } from '@webcode/shared';
import type * as vscode from 'vscode';

import { GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';
import type { ResolvedAiSiteConfig } from '../platforms';

const BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
const TEST_EXTENSION_VERSION = '1.0.1';
const IDLE_TIMEOUT_NEVER_MS = 60 * 60 * 1000;

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

suite('GatewayManager lifecycle', () => {
    test('allocates distinct ports and isolates bridge tokens across instances', async function () {
        this.timeout(15000);
        const managerA = createGatewayManager();
        const managerB = createGatewayManager();

        try {
            const resultA = await managerA.start(createTestConfig(41235));
            const resultB = await managerB.start(createTestConfig(41235));
            assert.notStrictEqual(resultA.port, resultB.port);

            const tokenA = await redeemBridgeToken(managerA, resultA.port);
            assert.strictEqual(await requestInitStatus(resultA.port, tokenA), 200);
            assert.strictEqual(await requestInitStatus(resultB.port, tokenA), 403);

            const tokenB = await redeemBridgeToken(managerB, resultB.port);
            assert.notStrictEqual(tokenA, tokenB);
            assert.strictEqual(await requestInitStatus(resultB.port, tokenB), 200);
            assert.strictEqual(await requestInitStatus(resultA.port, tokenB), 403);
        } finally {
            await managerA.stop();
            await managerB.stop();
        }
    });

    test('preserves the bridge session token on hot reload and revokes it on cold restart', async function () {
        this.timeout(15000);
        const manager = createGatewayManager();

        try {
            const first = await manager.start(createTestConfig(42355));
            const token = await redeemBridgeToken(manager, first.port);
            assert.strictEqual(await requestInitStatus(first.port, token), 200);

            const hotRestart = await manager.start(
                createTestConfig(first.port),
                { preserveBridgeSession: true }
            );
            assert.strictEqual(
                await requestInitStatus(hotRestart.port, token),
                200,
                'hot configuration reloads must keep the existing bridge session token valid'
            );

            const coldRestart = await manager.start(createTestConfig(hotRestart.port));
            assert.strictEqual(
                await requestInitStatus(coldRestart.port, token),
                403,
                'cold restarts must revoke the previous bridge session token'
            );
        } finally {
            await manager.stop();
        }
    });
});

function createGatewayManager(): GatewayManager {
    const outputChannel = {
        appendLine: () => undefined
    } as unknown as vscode.OutputChannel;
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

async function redeemBridgeToken(manager: GatewayManager, port: number): Promise<string> {
    const bridgeCode = manager.issueBridgeCode(TEST_SITE.id, TEST_SITE.address);
    const response = await fetch(`http://127.0.0.1:${port}/v1/bridge/redeem`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: BRIDGE_EXTENSION_ORIGIN
        },
        body: JSON.stringify({
            bridgeCode,
            browserExtensionVersion: TEST_EXTENSION_VERSION,
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION
        })
    });
    assert.strictEqual(response.status, 200);

    const body = await response.json() as { token?: unknown };
    assert.strictEqual(typeof body.token, 'string');
    return body.token as string;
}

async function requestInitStatus(port: number, token: string): Promise<number> {
    return withConnectionRetry(async () => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/init`, {
            headers: { [PROTOCOL.authHeaderLowerName]: token }
        });
        // Drain the body: an unread body leaves undici's HTTP parser paused, and
        // the next stop()/listen() cycle destroys that socket.
        await response.arrayBuffer();
        return response.status;
    });
}

/**
 * One retry for an idempotent GET whose pooled connection was destroyed by the
 * restart under test. stop() then listen() on the same port closes the previous
 * server, which tears down the idle keep-alive socket undici still holds;
 * browsers retry an idempotent GET on a fresh connection, undici does not.
 * A second failure is real and is reported.
 */
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

function isConnectionReset(error: unknown): boolean {
    // undici reports a destroyed keep-alive socket as `UND_ERR_SOCKET` with the
    // message "other side closed", not as a Node ECONNRESET. Only matching the
    // Node codes made this retry a no-op on CI.
    const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
    const code = cause?.code;
    return code === 'ECONNRESET'
        || code === 'EPIPE'
        || code === 'UND_ERR_SOCKET'
        || code === 'UND_ERR_CLOSED';
}
