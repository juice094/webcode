import * as assert from 'assert';
import express from 'express';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { isAllowedBridgeRedemptionOrigin, registerBridgeRoute } from '../gateway/bridgeRoute';
import { BridgeSessionManager } from '../gateway/bridgeSession';
import type { ResolvedAiSiteConfig } from '../platforms';

const CHROME_WEB_STORE_BRIDGE_ORIGIN = 'chrome-extension://kghhldphcmpiimophipabdhldfipgiio';
// Fixture only: the redemption route forwards whatever the gateway resolved.
const BROWSER_REQUEST_DEADLINE_MS = 300 * 1000;

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

suite('Bridge route security', () => {
    test('allows only the shared browser bridge origin to redeem launch codes', () => {
        assert.strictEqual(isAllowedBridgeRedemptionOrigin(CHROME_WEB_STORE_BRIDGE_ORIGIN), true);
        assert.strictEqual(isAllowedBridgeRedemptionOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
        assert.strictEqual(isAllowedBridgeRedemptionOrigin(`${CHROME_WEB_STORE_BRIDGE_ORIGIN}/`), false);
        assert.strictEqual(isAllowedBridgeRedemptionOrigin(undefined), false);
    });

    test('rejects unauthorized redemption origins without consuming the launch code', async () => {
        const sessions = new BridgeSessionManager();
        const server = await startBridgeServer(sessions, () => undefined);

        try {
            const bridgeCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });

            const missingOriginResponse = await redeemBridgeCode(server.baseUrl, bridgeCode, '1.0.1', BRIDGE_PROTOCOL_VERSION, null);
            assert.strictEqual(missingOriginResponse.status, 403);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const foreignExtensionResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION,
                'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
            );
            assert.strictEqual(foreignExtensionResponse.status, 403);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const bridgeResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(bridgeResponse.status, 200);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('redeems a launch code once without placing the API token in the page', async () => {
        const sessions = new BridgeSessionManager();
        let activityCount = 0;
        const server = await startBridgeServer(sessions, () => {
            activityCount += 1;
        });

        try {
            const bridgeCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });
            const bridgeResponse = await fetch(`${server.baseUrl}/bridge?bridgeCode=${bridgeCode}`);
            const bridgeHtml = await bridgeResponse.text();

            assert.strictEqual(bridgeResponse.status, 200);
            assert.strictEqual(bridgeResponse.headers.get('referrer-policy'), 'no-referrer');
            assert.match(bridgeResponse.headers.get('cache-control') ?? '', /no-store/);
            assert.doesNotMatch(bridgeHtml, new RegExp(bridgeCode));
            assert.match(bridgeHtml, /bridge-upgrade-required/);
            assert.match(bridgeHtml, /id="port-warning"/);
            assert.match(bridgeHtml, new RegExp(`"bridgeProtocolVersion":${BRIDGE_PROTOCOL_VERSION}`));
            assert.strictEqual(activityCount, 0);

            const protocolMismatchResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION - 1,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(protocolMismatchResponse.status, 409);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const mismatchResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '0.0.0',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(mismatchResponse.status, 409);
            assert.ok(sessions.getBridgeLaunch(bridgeCode));

            const redeemResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            const redemption = await redeemResponse.json() as Record<string, unknown>;
            const sessionToken = redemption.token;

            assert.strictEqual(redeemResponse.status, 200);
            assert.strictEqual(redemption.success, true);
            assert.strictEqual(redemption.siteId, TEST_SITE.id);
            assert.strictEqual(redemption.targetUrl, TEST_SITE.address);
            assert.strictEqual(redemption.idleTimeoutMs, 30 * 60 * 1000);
            assert.strictEqual(redemption.bridgeProtocolVersion, BRIDGE_PROTOCOL_VERSION);
            assert.strictEqual(typeof sessionToken, 'string');
            assert.notStrictEqual(sessionToken, bridgeCode);
            assert.strictEqual(sessions.isSessionTokenValid(sessionToken as string), true);
            assert.strictEqual(activityCount, 1);

            const reusedResponse = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(reusedResponse.status, 410);
            assert.strictEqual(activityCount, 1);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('accepts browser extensions at or above the shared minimum version', async () => {
        const sessions = new BridgeSessionManager();
        const server = await startBridgeServer(sessions, () => undefined);

        try {
            const newerExtensionCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });
            const newerExtensionResponse = await redeemBridgeCode(
                server.baseUrl,
                newerExtensionCode,
                '9.9.9',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(newerExtensionResponse.status, 200);

            const belowMinimumCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });
            const belowMinimumResponse = await redeemBridgeCode(
                server.baseUrl,
                belowMinimumCode,
                '0.9.9',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(belowMinimumResponse.status, 409);
            assert.ok(sessions.getBridgeLaunch(belowMinimumCode));
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('reports a live browser session only after a successful redemption', async () => {
        const sessions = new BridgeSessionManager();
        let activated = 0;
        const server = await startBridgeServer(sessions, () => undefined, 0, () => {
            activated += 1;
        });

        try {
            const bridgeCode = sessions.issueBridgeCode({
                siteId: TEST_SITE.id,
                targetUrl: TEST_SITE.address
            });

            const rejected = await redeemBridgeCode(server.baseUrl, bridgeCode, '1.0.1', BRIDGE_PROTOCOL_VERSION, null);
            assert.strictEqual(rejected.status, 403);
            assert.strictEqual(activated, 0, 'a rejected redemption must not report a connection');

            const accepted = await redeemBridgeCode(
                server.baseUrl,
                bridgeCode,
                '1.0.1',
                BRIDGE_PROTOCOL_VERSION,
                CHROME_WEB_STORE_BRIDGE_ORIGIN
            );
            assert.strictEqual(accepted.status, 200);
            assert.strictEqual(activated, 1);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('sends the browser request deadline when one is configured', async () => {
        const sessions = new BridgeSessionManager();
        const server = await startBridgeServer(sessions, () => undefined, BROWSER_REQUEST_DEADLINE_MS);

        try {
            const redemption = await redeemOnce(server.baseUrl, sessions);
            assert.strictEqual(redemption.bridgeRequestMs, BROWSER_REQUEST_DEADLINE_MS);
        } finally {
            await closeServer(server.httpServer);
        }
    });

    test('omits the browser request deadline when it is disabled', async () => {
        const sessions = new BridgeSessionManager();
        const server = await startBridgeServer(sessions, () => undefined, 0);

        try {
            const redemption = await redeemOnce(server.baseUrl, sessions);
            assert.strictEqual(
                'bridgeRequestMs' in redemption,
                false,
                'a disabled deadline must not appear in the redemption payload'
            );
        } finally {
            await closeServer(server.httpServer);
        }
    });
});

async function startBridgeServer(
    sessions: BridgeSessionManager,
    recordActivity: () => void,
    bridgeRequestMs: number = 0,
    onSessionActivated?: () => void
): Promise<{ baseUrl: string; httpServer: HttpServer }> {
    const app = express();
    app.use(express.json());
    registerBridgeRoute(app, {
        activateSession: () => sessions.activateSession(),
        consumeBridgeCode: code => sessions.consumeBridgeCode(code),
        getBridgeLaunch: code => sessions.getBridgeLaunch(code),
        getAiSites: () => [TEST_SITE],
        getExtensionVersion: () => '1.0.1',
        getGatewayInstanceId: () => 'test-gateway-instance',
        getIdleTimeoutMs: () => 30 * 60 * 1000,
        getBridgeRequestMs: () => bridgeRequestMs,
        getWorkspaceRoot: () => null,
        log: () => undefined,
        recordActivity,
        onSessionActivated
    });

    const httpServer = await new Promise<HttpServer>((resolve) => {
        const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = httpServer.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        httpServer
    };
}

async function redeemOnce(baseUrl: string, sessions: BridgeSessionManager): Promise<Record<string, unknown>> {
    const bridgeCode = sessions.issueBridgeCode({
        siteId: TEST_SITE.id,
        targetUrl: TEST_SITE.address
    });
    const response = await redeemBridgeCode(
        baseUrl,
        bridgeCode,
        '1.0.1',
        BRIDGE_PROTOCOL_VERSION,
        CHROME_WEB_STORE_BRIDGE_ORIGIN
    );
    assert.strictEqual(response.status, 200);
    return await response.json() as Record<string, unknown>;
}

function redeemBridgeCode(
    baseUrl: string,
    bridgeCode: string,
    browserExtensionVersion: string,
    bridgeProtocolVersion = BRIDGE_PROTOCOL_VERSION,
    origin: string | null = CHROME_WEB_STORE_BRIDGE_ORIGIN
): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (origin) {
        headers.Origin = origin;
    }
    return fetch(`${baseUrl}/v1/bridge/redeem`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ bridgeCode, browserExtensionVersion, bridgeProtocolVersion })
    });
}

function closeServer(server: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
