import './vscodeStub';

import * as assert from 'assert';
import type * as vscode from 'vscode';

import { GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';

const TEST_EXTENSION_VERSION = '1.0.1';

/**
 * The watchdog internals (inFlightRequestCount / watchdogPostponements) are
 * private; tests adjust them through these typed views instead of growing
 * the production API surface.
 */
type WatchdogInternals = {
    inFlightRequestCount: number;
    watchdogPostponements: number;
};

suite('GatewayManager idle watchdog', () => {
    test('postpones shutdown while requests are in flight and logs the postponement', async function () {
        this.timeout(10000);
        const logs: string[] = [];
        let autoStops = 0;
        const manager = createGatewayManager(logs, () => { autoStops += 1; });

        try {
            const { port } = await manager.start(createTestConfig(43455, 300));
            internals(manager).inFlightRequestCount = 1;

            const postponed = await waitFor(() => hasLog(logs, 'Postponing idle shutdown (1/3)'), 3000);
            assert.ok(postponed, 'watchdog should log the first postponement');
            assert.strictEqual(internals(manager).watchdogPostponements, 1);
            assert.strictEqual(autoStops, 0, 'gateway must not auto-stop while a request is in flight');
            assert.strictEqual(await isGatewayReachable(port), true);
        } finally {
            await manager.stop();
        }
    });

    test('forces shutdown after exhausting the postponement budget', async function () {
        this.timeout(10000);
        const logs: string[] = [];
        let autoStops = 0;
        const manager = createGatewayManager(logs, () => { autoStops += 1; });

        try {
            const { port } = await manager.start(createTestConfig(43465, 150));
            internals(manager).inFlightRequestCount = 1;

            const stopped = await waitFor(() => autoStops === 1, 5000);
            assert.ok(stopped, 'watchdog should force shutdown after 3 postponements');
            assert.ok(hasLog(logs, 'Postponing idle shutdown (3/3)'));
            assert.ok(hasLog(logs, 'Forcing idle shutdown'));

            const unreachable = await waitFor(() => isGatewayGone(port), 3000);
            assert.ok(unreachable, 'gateway port should stop accepting connections');
        } finally {
            await manager.stop();
        }
    });

    test('shuts down on the first idle timeout when nothing is in flight', async function () {
        this.timeout(10000);
        const logs: string[] = [];
        let autoStops = 0;
        const manager = createGatewayManager(logs, () => { autoStops += 1; });

        try {
            const { port } = await manager.start(createTestConfig(43475, 150));

            const stopped = await waitFor(() => autoStops === 1, 3000);
            assert.ok(stopped, 'watchdog should stop the gateway on the first idle timeout');
            assert.ok(hasLog(logs, 'Shutting down'));
            assert.ok(!hasLog(logs, 'Postponing idle shutdown'));

            const unreachable = await waitFor(() => isGatewayGone(port), 3000);
            assert.ok(unreachable, 'gateway port should stop accepting connections');
        } finally {
            await manager.stop();
        }
    });
});

function internals(manager: GatewayManager): WatchdogInternals {
    return manager as unknown as WatchdogInternals;
}

function createGatewayManager(logs: string[], onAutoStop: () => void): GatewayManager {
    const outputChannel = {
        appendLine: (line: string) => { logs.push(line); }
    } as unknown as vscode.OutputChannel;
    const context = {
        extension: { packageJSON: { version: TEST_EXTENSION_VERSION } }
    } as unknown as vscode.ExtensionContext;

    return new GatewayManager(outputChannel, process.cwd(), context, onAutoStop);
}

function createTestConfig(port: number, idleTimeoutMs: number): GatewayConfig {
    return {
        port,
        idleTimeoutMs,
        mcpServers: {},
        allowedOrigins: [],
        aiSites: []
    };
}

function hasLog(logs: string[], fragment: string): boolean {
    return logs.some(line => line.includes(fragment));
}

async function isGatewayGone(port: number): Promise<boolean> {
    return !(await isGatewayReachable(port));
}

async function isGatewayReachable(port: number): Promise<boolean> {
    try {
        // Any HTTP response (including 403 from the auth middleware) proves
        // the server is still listening; a rejected fetch means it stopped.
        await fetch(`http://127.0.0.1:${port}/v1/status`);
        return true;
    } catch {
        return false;
    }
}

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }

    return false;
}
