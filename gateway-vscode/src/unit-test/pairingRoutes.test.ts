import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import express from 'express';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { BRIDGE_EXTENSION_ORIGIN } from '../gateway/bridgeRoute';
import {
    PING_SCHEMA_VERSION,
    SESSION_REQUEST_LIMIT_PER_MINUTE,
    registerPairingRoutes,
    type PairingRoutesOptions
} from '../gateway/pairingRoutes';
import type { ResolvedAiSiteConfig } from '../platforms';

const SITE: ResolvedAiSiteConfig = {
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
const OTHER_SITE: ResolvedAiSiteConfig = { ...SITE, id: 'other', name: 'Other', address: 'https://other.example/' };
const WORKSPACE_ROOT = path.join(os.tmpdir(), 'webcode-pairing-workspace');
const CODE_TTL_MS = 120_000;

suite('Gateway pairing routes', () => {
    test('ping exposes discovery fields and nothing sensitive', async () => {
        const server = await startPairingServer({});

        try {
            const response = await fetch(`${server.baseUrl}/v1/ping`);
            const body = await response.json() as Record<string, unknown>;

            assert.strictEqual(response.status, 200);
            assert.strictEqual(body.schema, PING_SCHEMA_VERSION);
            assert.strictEqual(body.bridgeProtocolVersion, BRIDGE_PROTOCOL_VERSION);
            assert.strictEqual(body.workspaceName, path.basename(WORKSPACE_ROOT));
            assert.strictEqual(body.port, server.port);
            assert.strictEqual(body.sessionActive, false);
            assert.deepStrictEqual(Object.keys(body).sort(), [
                'bridgeProtocolVersion',
                'port',
                'product',
                'schema',
                'sessionActive',
                'workspaceId',
                'workspaceName'
            ]);

            const raw = JSON.stringify(body);
            assert.ok(!raw.includes(WORKSPACE_ROOT), 'ping must not expose the workspace path');
            assert.ok(!('token' in body), 'ping must not expose a session token');
            assert.ok(!('bridgeCode' in body), 'ping must not expose a launch code');
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('ping reports a null workspace name when no folder is open', async () => {
        const server = await startPairingServer({ getWorkspaceRoot: () => null });

        try {
            const body = await (await fetch(`${server.baseUrl}/v1/ping`)).json() as Record<string, unknown>;
            assert.strictEqual(body.workspaceName, null);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('rejects non-JSON pairing requests with 415', async () => {
        const server = await startPairingServer({});

        try {
            const response = await postPairing(server.baseUrl, { requestOrigin: SITE.address }, {
                contentType: 'text/plain'
            });
            assert.strictEqual(response.status, 415);
            assert.deepStrictEqual(await response.json(), { error: 'unsupported-media-type' });
            assert.strictEqual(server.issued.length, 0);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('rejects callers that are neither the bridge extension nor a configured site', async () => {
        const server = await startPairingServer({});

        try {
            const response = await postPairing(server.baseUrl, { requestOrigin: SITE.address }, {
                origin: 'https://evil.example'
            });
            assert.strictEqual(response.status, 403);
            assert.deepStrictEqual(await response.json(), { error: 'forbidden-origin' });
            assert.strictEqual(server.issued.length, 0);
            assert.strictEqual(server.prompts.length, 0, 'no prompt for an untrusted origin');
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('rejects a body origin that differs from the calling site origin', async () => {
        const server = await startPairingServer({});

        try {
            const response = await postPairing(server.baseUrl, { requestOrigin: OTHER_SITE.address }, {
                origin: 'https://chatgpt.com'
            });
            assert.strictEqual(response.status, 403);
            assert.deepStrictEqual(await response.json(), { error: 'forbidden-origin' });
            assert.strictEqual(server.issued.length, 0);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('rejects unknown site ids and mismatched pairs', async () => {
        const server = await startPairingServer({});

        try {
            const unknown = await postPairing(server.baseUrl, {
                siteId: 'not-configured',
                requestOrigin: SITE.address
            });
            assert.strictEqual(unknown.status, 403);
            assert.deepStrictEqual(await unknown.json(), { error: 'unknown-site' });

            const mismatched = await postPairing(server.baseUrl, {
                siteId: OTHER_SITE.id,
                requestOrigin: SITE.address
            });
            assert.strictEqual(mismatched.status, 403);
            assert.deepStrictEqual(await mismatched.json(), { error: 'unknown-site' });
            assert.strictEqual(server.issued.length, 0);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('issues a launch code only after the user approves', async () => {
        const server = await startPairingServer({});

        try {
            const response = await postPairing(server.baseUrl, { requestOrigin: SITE.address });
            const body = await response.json() as Record<string, unknown>;

            assert.strictEqual(response.status, 200);
            assert.strictEqual(body.bridgeCode, 'stub-bridge-code');
            assert.strictEqual(body.targetUrl, 'https://chatgpt.com/');
            assert.strictEqual(body.expiresInMs, CODE_TTL_MS);
            assert.deepStrictEqual(server.issued, [{ siteId: SITE.id, targetUrl: 'https://chatgpt.com/' }]);
            assert.strictEqual(server.prompts.length, 1);
            assert.strictEqual(server.prompts[0].requestOrigin, 'https://chatgpt.com');
            assert.strictEqual(server.prompts[0].workspaceName, path.basename(WORKSPACE_ROOT));
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('issues no code when the user declines or the modal is dismissed', async () => {
        const server = await startPairingServer({
            requestUserConfirmation: () => Promise.resolve(undefined as unknown as boolean)
        });

        try {
            const response = await postPairing(server.baseUrl, { siteId: SITE.id, requestOrigin: SITE.address });
            assert.strictEqual(response.status, 403);
            assert.deepStrictEqual(await response.json(), { error: 'declined' });
            assert.strictEqual(server.issued.length, 0);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('refuses to pair when no workspace folder is open', async () => {
        const server = await startPairingServer({ getWorkspaceRoot: () => null });

        try {
            const response = await postPairing(server.baseUrl, { requestOrigin: SITE.address });
            assert.strictEqual(response.status, 409);
            assert.deepStrictEqual(await response.json(), { error: 'no-workspace' });
            assert.strictEqual(server.issued.length, 0);
            assert.strictEqual(server.prompts.length, 0, 'no prompt without a workspace to pair with');
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('rate limits a burst per origin and advertises Retry-After', async () => {
        const server = await startPairingServer({
            requestUserConfirmation: () => Promise.resolve(false)
        });

        try {
            const statuses: number[] = [];
            for (let attempt = 0; attempt < SESSION_REQUEST_LIMIT_PER_MINUTE + 1; attempt += 1) {
                const response = await postPairing(server.baseUrl, { requestOrigin: SITE.address });
                statuses.push(response.status);
                if (response.status === 429) {
                    const retryAfter = Number(response.headers.get('retry-after'));
                    assert.ok(retryAfter >= 1, `Retry-After should be a positive number of seconds, got ${retryAfter}`);
                    assert.deepStrictEqual(await response.json(), { error: 'rate-limited' });
                }
            }

            assert.deepStrictEqual(
                statuses.slice(0, SESSION_REQUEST_LIMIT_PER_MINUTE),
                new Array(SESSION_REQUEST_LIMIT_PER_MINUTE).fill(403),
                'requests inside the window are handled normally (here: declined)'
            );
            assert.strictEqual(statuses[SESSION_REQUEST_LIMIT_PER_MINUTE], 429);
        } finally {
            await closeServer(server.httpServer);
        }
    });
});

type PairingHarness = {
    baseUrl: string;
    httpServer: HttpServer;
    port: number;
    issued: Array<{ siteId: string; targetUrl: string }>;
    prompts: Array<{ siteName: string; requestOrigin: string; workspaceName: string }>;
};

async function startPairingServer(overrides: Partial<PairingRoutesOptions>): Promise<PairingHarness> {
    const issued: PairingHarness['issued'] = [];
    const prompts: PairingHarness['prompts'] = [];
    let port = 0;

    const app = express();
    app.use(express.json());
    registerPairingRoutes(app, {
        getAiSites: () => [SITE, OTHER_SITE],
        getBridgeCodeTtlMs: () => CODE_TTL_MS,
        getPort: () => port,
        getWorkspaceRoot: () => WORKSPACE_ROOT,
        hasActiveSession: () => false,
        issueBridgeCode: (siteId, targetUrl) => {
            issued.push({ siteId, targetUrl });
            return 'stub-bridge-code';
        },
        requestUserConfirmation: prompt => {
            prompts.push(prompt);
            return Promise.resolve(true);
        },
        log: () => undefined,
        ...overrides
    });

    const httpServer = await new Promise<HttpServer>(resolve => {
        const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = httpServer.address() as AddressInfo;
    port = address.port;
    return { baseUrl: `http://127.0.0.1:${port}`, httpServer, port, issued, prompts };
}

function postPairing(
    baseUrl: string,
    body: Record<string, unknown>,
    init: { contentType?: string; origin?: string } = {}
): Promise<Response> {
    return fetch(`${baseUrl}/v1/session/request`, {
        method: 'POST',
        headers: {
            'Content-Type': init.contentType ?? 'application/json',
            Origin: init.origin ?? BRIDGE_EXTENSION_ORIGIN
        },
        body: JSON.stringify(body)
    });
}

function closeServer(server: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
