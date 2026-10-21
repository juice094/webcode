import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runDeactivate, type DeactivateSession } from '../extension/deactivateSession';
import { digestToolArguments, readShutdownSnapshot, type InFlightToolCall } from '../extension/shutdownSnapshot';

type Call = { name: string };

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-deactivate-'));
}

function createCall(): InFlightToolCall {
    return {
        callId: 'call-1',
        serverId: 'internal',
        toolName: 'execute_command',
        startedAt: '2026-10-22T02:10:00.000Z',
        elapsedMs: 900,
        argsDigest: digestToolArguments({ command: 'npm run build' }),
        argsPreview: '{"command":"npm run build"}'
    };
}

function createSession(options: {
    calls: Call[];
    inFlight: InFlightToolCall[];
    stopThrows?: boolean;
    snapshotPath: string;
}): DeactivateSession {
    return {
        manager: {
            getInFlightToolCalls: () => options.inFlight,
            hasActiveBridgeSession: () => true,
            markShuttingDown: () => { options.calls.push({ name: 'shutdown' }); },
            stop: (stopOptions) => {
                options.calls.push({ name: `stop:fast=${stopOptions.fast}:preserve=${stopOptions.preserveBridgeSession}` });
                return options.stopThrows ? Promise.reject(new Error('stop failed')) : Promise.resolve();
            }
        },
        logger: {
            info: () => { options.calls.push({ name: 'log:info' }); },
            error: () => { options.calls.push({ name: 'log:error' }); }
        },
        snapshotPath: options.snapshotPath,
        workspaceId: 'ws-a',
        workspaceName: 'webcode'
    };
}

suite('Deactivate sequence', () => {
    test('stops accepting work, writes the snapshot, then stops fast with the session kept', async () => {
        const calls: Call[] = [];
        const snapshotPath = path.join(createTempDir(), 'state', 'shutdown-ws-a.json');
        let clock = Date.now();
        const session = createSession({ calls, inFlight: [createCall()], snapshotPath });

        const outcome = await runDeactivate(session, () => { clock += 50; return clock; });

        assert.deepStrictEqual(
            calls.map(call => call.name),
            ['shutdown', 'stop:fast=true:preserve=true', 'log:info']
        );
        assert.strictEqual(outcome.snapshotWritten, true);
        assert.strictEqual(outcome.inFlight, 1);
        assert.strictEqual(outcome.durationMs, 50);

        const snapshot = readShutdownSnapshot(snapshotPath);
        assert.ok(snapshot);
        assert.strictEqual(snapshot?.reason, 'deactivate');
        assert.strictEqual(snapshot?.sessionWasActive, true);
        assert.strictEqual(snapshot?.inFlight[0].toolName, 'execute_command');
    });

    test('still stops the gateway and logs when the snapshot cannot be written', async () => {
        const calls: Call[] = [];
        const blockedPath = path.join(createTempDir(), 'state', 'shutdown-ws-a.json');
        fs.mkdirSync(blockedPath, { recursive: true });
        const session = createSession({ calls, inFlight: [createCall()], snapshotPath: blockedPath });

        const outcome = await runDeactivate(session, () => 2000);

        assert.strictEqual(outcome.snapshotWritten, false);
        assert.ok(calls.some(call => call.name === 'stop:fast=true:preserve=true'));
        assert.ok(calls.some(call => call.name === 'log:info'), 'the outcome must still be logged');
    });

    test('reports a stop failure without throwing out of deactivate', async () => {
        const calls: Call[] = [];
        const snapshotPath = path.join(createTempDir(), 'shutdown-ws-a.json');
        const session = createSession({ calls, inFlight: [], snapshotPath, stopThrows: true });

        const outcome = await runDeactivate(session, () => 3000);

        assert.ok(calls.some(call => call.name === 'log:error'), 'the stop failure must be logged');
        assert.strictEqual(outcome.inFlight, 0);
    });
});
