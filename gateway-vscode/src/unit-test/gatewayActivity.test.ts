import * as assert from 'assert';
import express from 'express';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import { PROTOCOL } from '@webcode/shared';

import { createAuthMiddleware, createGatewayActivityMiddleware, isGatewayActivityRequest } from '../gateway/middleware';

const VALID_TOKEN = 'session-token';

suite('Gateway activity exemption', () => {
    test('treats the bridge health probe as activity only for authenticated callers', async () => {
        assert.strictEqual(isGatewayActivityRequest('GET', '/v1/status'), true);
        assert.strictEqual(isGatewayActivityRequest('GET', '/v1/init'), true);
        assert.strictEqual(isGatewayActivityRequest('GET', '/v1/unknown'), false);

        let activityCount = 0;
        const server = await startActivityServer(() => {
            activityCount += 1;
        });

        try {
            // Mounted in the same order as GatewayManager: auth first, activity
            // second, so an anonymous status poll never reaches the watchdog.
            const anonymous = await fetch(`${server.baseUrl}/v1/status`);
            assert.strictEqual(anonymous.status, 403);
            assert.strictEqual(activityCount, 0, 'an anonymous health check must not count as activity');

            const authenticated = await fetch(`${server.baseUrl}/v1/status`, {
                headers: { [PROTOCOL.authHeaderName]: VALID_TOKEN }
            });
            assert.strictEqual(authenticated.status, 200);
            assert.strictEqual(activityCount, 1, 'an authenticated health check must count as activity');

            const unknown = await fetch(`${server.baseUrl}/v1/unknown`, {
                headers: { [PROTOCOL.authHeaderName]: VALID_TOKEN }
            });
            assert.strictEqual(unknown.status, 404);
            assert.strictEqual(activityCount, 1, 'unrelated routes must not extend the idle window');
        } finally {
            await closeServer(server.httpServer);
        }
    });
});

async function startActivityServer(
    onActivity: () => void
): Promise<{ baseUrl: string; httpServer: HttpServer }> {
    const app = express();
    app.use(createAuthMiddleware(token => token === VALID_TOKEN, () => undefined));
    app.use(createGatewayActivityMiddleware(onActivity));
    app.get('/v1/status', (_req, res) => {
        res.json({ ok: true });
    });

    const httpServer = await new Promise<HttpServer>(resolve => {
        const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    });
    const address = httpServer.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${address.port}`, httpServer };
}

function closeServer(server: HttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}
