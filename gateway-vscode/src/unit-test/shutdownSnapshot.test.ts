import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    ARGS_PREVIEW_MAX_CHARS,
    SHUTDOWN_SNAPSHOT_MAX_BYTES,
    SHUTDOWN_SNAPSHOT_TTL_MS,
    buildArgsPreview,
    digestToolArguments,
    readShutdownSnapshot,
    shutdownSnapshotPath,
    writeShutdownSnapshot,
    type InFlightToolCall,
    type ShutdownSnapshot
} from '../extension/shutdownSnapshot';

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-snapshot-'));
}

function createCall(index: number, argsPreview?: string): InFlightToolCall {
    return {
        callId: `call-${index}`,
        serverId: 'internal',
        toolName: 'execute_command',
        startedAt: '2026-10-22T02:10:00.000Z',
        elapsedMs: 1234,
        argsDigest: digestToolArguments({ index }),
        argsPreview
    };
}

function createSnapshot(inFlight: InFlightToolCall[], savedAt = new Date().toISOString()): ShutdownSnapshot {
    return {
        schemaVersion: 1,
        savedAt,
        reason: 'deactivate',
        workspaceId: 'ws-a',
        workspaceName: 'webcode',
        sessionWasActive: true,
        inFlight
    };
}

suite('Shutdown snapshot', () => {
    test('writes and reads a snapshot round trip', () => {
        const filePath = shutdownSnapshotPath(createTempDir(), 'ws-a');
        const snapshot = createSnapshot([createCall(1, 'npm run build')]);

        assert.strictEqual(writeShutdownSnapshot(filePath, snapshot), true);
        const loaded = readShutdownSnapshot(filePath);
        assert.ok(loaded);
        assert.strictEqual(loaded?.workspaceId, 'ws-a');
        assert.strictEqual(loaded?.inFlight.length, 1);
        assert.strictEqual(loaded?.inFlight[0].argsPreview, 'npm run build');
    });

    test('treats a snapshot older than the TTL as absent', () => {
        const filePath = shutdownSnapshotPath(createTempDir(), 'ws-a');
        const savedAt = new Date(Date.now() - SHUTDOWN_SNAPSHOT_TTL_MS - 1000).toISOString();
        writeShutdownSnapshot(filePath, createSnapshot([createCall(1)], savedAt));

        assert.strictEqual(readShutdownSnapshot(filePath), null);

        const fresh = new Date(Date.now() - 60_000).toISOString();
        writeShutdownSnapshot(filePath, createSnapshot([createCall(1)], fresh));
        assert.ok(readShutdownSnapshot(filePath), 'a one-minute-old snapshot must still load');
    });

    test('redacts credentials and caps the argument preview', () => {
        const preview = buildArgsPreview({
            command: 'curl -H "Authorization: Bearer abc"',
            token: 'super-secret-token',
            nested: { password: 'hunter2', apiKey: 'k-123' },
            blob: 'x'.repeat(500)
        });

        assert.ok(preview);
        const rendered = preview;
        assert.ok(!rendered.includes('super-secret-token'), rendered);
        assert.ok(!rendered.includes('hunter2'), rendered);
        assert.ok(!rendered.includes('k-123'), rendered);
        assert.ok(rendered.includes('[redacted]'), rendered);
        assert.ok(rendered.length <= ARGS_PREVIEW_MAX_CHARS, `preview too long: ${rendered.length}`);
    });

    test('drops trailing calls instead of exceeding the byte budget', () => {
        const filePath = shutdownSnapshotPath(createTempDir(), 'ws-a');
        const calls = Array.from({ length: 200 }, (_item, index) => createCall(index, 'y'.repeat(100)));

        assert.strictEqual(writeShutdownSnapshot(filePath, createSnapshot(calls)), true);
        const size = fs.statSync(filePath).size;
        assert.ok(size <= SHUTDOWN_SNAPSHOT_MAX_BYTES, `snapshot is ${size} bytes`);

        const loaded = readShutdownSnapshot(filePath);
        assert.ok(loaded);
        assert.ok((loaded?.inFlight.length ?? 0) < calls.length, 'the snapshot must be trimmed');
        assert.ok((loaded?.inFlight.length ?? 0) > 0, 'it must keep at least one call');
    });

    test('digest is stable for equal arguments and never contains them', () => {
        const first = digestToolArguments({ command: 'ls', token: 'abc' });
        const second = digestToolArguments({ command: 'ls', token: 'abc' });
        const different = digestToolArguments({ command: 'ls', token: 'abd' });

        assert.strictEqual(first, second);
        assert.notStrictEqual(first, different);
        assert.match(first, /^[0-9a-f]{64}$/);
        assert.ok(!first.includes('abc'));
    });
});
