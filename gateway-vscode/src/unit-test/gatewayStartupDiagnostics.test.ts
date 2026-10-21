import './vscodeStub';

import * as assert from 'assert';
import { BRIDGE_PROTOCOL_VERSION, PROTOCOL } from '@webcode/shared';
import type * as vscode from 'vscode';

import { GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';
import type { ResolvedAiSiteConfig } from '../platforms';

const BRIDGE_EXTENSION_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
const TEST_EXTENSION_VERSION = '1.3.0';
const IDLE_TIMEOUT_NEVER_MS = 60 * 60 * 1000;
const TEST_PORT = 45411;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

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

suite('Gateway startup diagnostics', () => {
    test('logs the resolved deadlines that the gateway is actually enforcing', async function () {
        this.timeout(15000);
        const lines: string[] = [];
        const manager = createGatewayManager(lines);

        try {
            await manager.start(createTestConfig({
                toolCallMs: 1234,
                commandExecutionMs: 4321,
                bridgeRequestMs: 5678,
                bridgeCodeTtlMs: 90000,
                approvalTtlMs: 95000,
                browserLaunchWaitMs: 7000
            }));

            const line = lines.find(entry => entry.includes('timeouts:'));
            assert.ok(line, 'expected a timeouts line, got lines: ' + JSON.stringify(lines));
            if (!line) {
                return;
            }
            assert.match(line, /toolCallMs=1234/);
            assert.match(line, /commandExecutionMs=4321/);
            assert.match(line, /bridgeRequestMs=5678/);
            assert.match(line, /bridgeCodeTtlMs=90000/);
            assert.match(line, /approvalTtlMs=95000/);
            assert.match(line, /browserLaunchWaitMs=7000/);
            assert.match(line, new RegExp('idleTimeoutMs=' + IDLE_TIMEOUT_NEVER_MS));
        } finally {
            await manager.stop();
        }
    });

    test('reports build identity on the authenticated status route only', async function () {
        this.timeout(15000);
        const lines: string[] = [];
        const manager = createGatewayManager(lines);

        try {
            const started = await manager.start(createTestConfig({}));
            const port = started.port;
            const token = await redeemBridgeToken(manager, port);

            const authorized = await fetch('http://127.0.0.1:' + port + '/v1/status', {
                headers: { [PROTOCOL.authHeaderLowerName]: token }
            });
            assert.strictEqual(authorized.status, 200);
            const body = await authorized.json() as Record<string, unknown>;

            assert.strictEqual(body.ok, true);
            assert.strictEqual(body.version, TEST_EXTENSION_VERSION);
            assert.strictEqual(body.bridgeProtocolVersion, BRIDGE_PROTOCOL_VERSION);
            const startedAt = body.startedAt;
            assert.strictEqual(typeof startedAt, 'string');
            assert.ok(
                typeof startedAt === 'string' && Number.isFinite(Date.parse(startedAt)),
                'startedAt must be an ISO timestamp, got ' + JSON.stringify(startedAt)
            );

            assert.ok('buildHash' in body, 'buildHash must always be present, null when no descriptor was packaged');
            const buildHash = body.buildHash;
            assert.ok(
                buildHash === null || (typeof buildHash === 'string' && SHA256_PATTERN.test(buildHash)),
                'buildHash must be a sha256 digest or null, got ' + JSON.stringify(buildHash)
            );

            const anonymous = await fetch('http://127.0.0.1:' + port + '/v1/status');
            assert.strictEqual(anonymous.status, 403, 'status must stay behind the session token gate');
        } finally {
            await manager.stop();
        }
    });
});

function createGatewayManager(lines: string[]): GatewayManager {
    const outputChannel = {
        appendLine: (line: string) => { lines.push(line); },
        append: (line: string) => { lines.push(line); }
    } as unknown as vscode.OutputChannel;
    const context = {
        extension: { packageJSON: { version: TEST_EXTENSION_VERSION } }
    } as unknown as vscode.ExtensionContext;

    return new GatewayManager(outputChannel, process.cwd(), context);
}

type TestTimeouts = Pick<
    GatewayConfig,
    'toolCallMs' | 'commandExecutionMs' | 'bridgeRequestMs' | 'browserLaunchWaitMs' | 'bridgeCodeTtlMs' | 'approvalTtlMs'
>;

function createTestConfig(timeouts: TestTimeouts): GatewayConfig {
    return {
        port: TEST_PORT,
        idleTimeoutMs: IDLE_TIMEOUT_NEVER_MS,
        mcpServers: {},
        allowedOrigins: [],
        aiSites: [TEST_SITE],
        ...timeouts
    };
}

async function redeemBridgeToken(manager: GatewayManager, port: number): Promise<string> {
    const bridgeCode = manager.issueBridgeCode(TEST_SITE.id, TEST_SITE.address);
    const response = await fetch('http://127.0.0.1:' + port + '/v1/bridge/redeem', {
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
