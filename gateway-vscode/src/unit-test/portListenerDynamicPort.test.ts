import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';
import type { Server as HttpServer } from 'http';
import * as net from 'net';

import { listenOnAvailablePort } from '../gateway/portListener';
import type { GatewayConfig } from '../gateway/types';

function createConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
    return {
        port: 0,
        idleTimeoutMs: 60 * 60 * 1000,
        mcpServers: {},
        allowedOrigins: [],
        aiSites: [],
        ...overrides
    };
}

/** Minimal express-like app whose listen() forwards to a real net server. */
function createApp(): express.Express {
    return {
        listen(port: number, host: string, callback: () => void): HttpServer {
            const server = net.createServer();
            server.listen(port, host, callback);
            return server as unknown as HttpServer;
        }
    } as unknown as express.Express;
}

function closeServer(server: HttpServer | undefined): Promise<void> {
    return new Promise(resolve => {
        if (!server) {
            resolve();
            return;
        }
        server.close(() => resolve());
    });
}

suite('portListener dynamic port (port 0)', () => {
    test('reports the OS-assigned port instead of the requested 0', async () => {
        let boundPort: number | undefined;
        let server: HttpServer | undefined;

        try {
            const result = await listenOnAvailablePort({
                app: createApp(),
                config: createConfig({ port: 0 }),
                log: () => undefined,
                trace: () => undefined,
                onBound: (port, bound) => { boundPort = port; server = bound; }
            });

            assert.notStrictEqual(result.port, 0, 'StartResult must carry the real port');
            assert.ok(result.port > 0 && result.port < 65536, `unexpected port ${result.port}`);
            assert.strictEqual(boundPort, result.port, 'onBound must receive the same port as StartResult');
        } finally {
            await closeServer(server);
        }
    });

    test('binds on loopback and releases the port when the server closes', async () => {
        let server: HttpServer | undefined;
        let port = 0;

        try {
            const result = await listenOnAvailablePort({
                app: createApp(),
                config: createConfig({ port: 0 }),
                log: () => undefined,
                trace: () => undefined,
                onBound: (_port, bound) => { server = bound; }
            });
            port = result.port;
        } finally {
            await closeServer(server);
        }

        // Once the gateway server is closed, the port must be free again.
        const probe = net.createServer();
        await new Promise<void>((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(port, '127.0.0.1', () => {
                probe.close(() => resolve());
            });
        });
    });
});
