import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { createToolCallHandler, type ToolCallHandlerOptions } from '../gateway/toolCallRoute';
import { ToolConcurrencyGate } from '../gateway/toolConcurrency';
import {
    isWriteLockedTool,
    sessionTokenRef,
    WRITE_TOOL_NAMES,
    WriteLock,
    WRITE_LOCK_TIMEOUT_TEXT
} from '../gateway/writeLock';
import type { ApprovalAuditEvent } from '../gateway/approvalAudit';
import type { LocalTool, ToolExecutionContext, ToolResult } from '../tools';

suite('WriteLock', () => {
    test('write-class table covers exactly the mutating local tools', () => {
        assert.deepStrictEqual([...WRITE_TOOL_NAMES].sort(), [
            'edit_file',
            'execute_command',
            'run_in_terminal',
            'terminal_session',
            'write_file'
        ]);
        assert.strictEqual(isWriteLockedTool('write_file'), true);
        assert.strictEqual(isWriteLockedTool('read_file'), false);
        assert.strictEqual(isWriteLockedTool('search_code'), false);
        // Third-party MCP tools are read-class by default this release.
        assert.strictEqual(isWriteLockedTool('some-server:mutate_thing'), false);
    });

    test('serializes writers FIFO and grants the next waiter on release', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });
        const events: string[] = [];

        const first = lock.acquire('session-a').then(async result => {
            assert.deepStrictEqual(result, { status: 'acquired' });
            events.push('a-acquired');
            await settle();
            lock.release('session-a');
            events.push('a-released');
        });

        const second = lock.acquire('session-b').then(result => {
            assert.deepStrictEqual(result, { status: 'acquired' });
            events.push('b-acquired');
            lock.release('session-b');
        });

        await Promise.all([first, second]);
        assert.deepStrictEqual(events, ['a-acquired', 'a-released', 'b-acquired']);
        assert.strictEqual(lock.pending, 0);
        assert.strictEqual(lock.holder, null);
    });

    test('a queued writer times out with a retryable result and the holder keeps the lock', async () => {
        let now = 5_000;
        const lock = new WriteLock({ timeoutMs: 30, now: () => now });
        const audit: ApprovalAuditEvent[] = [];
        const audited = new WriteLock({ timeoutMs: 30, now: () => now, audit: event => audit.push(event) });

        assert.deepStrictEqual(await lock.acquire('session-a'), { status: 'acquired' });

        const waiting = lock.acquire('session-b');
        now += 31;
        const result = await waiting;
        assert.strictEqual(result.status, 'timeout');
        assert.strictEqual(result.waitMs, 31);
        assert.strictEqual(lock.holder, 'session-a', 'a timeout must not steal the lock');
        assert.strictEqual(lock.pending, 0);

        // The same sequence through the audited lock emits acquire + timeout.
        await audited.acquire('session-a');
        const auditedWait = audited.acquire('session-b');
        now += 31;
        await auditedWait;
        const names = audit.map(event => event.event);
        assert.ok(names.includes('write_lock_acquired'));
        assert.ok(names.includes('write_lock_timeout'));
    });

    test('releaseForTokens revokes the holder and its queued waiters', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });

        await lock.acquire('session-a');
        const waitingB = lock.acquire('session-b');
        const waitingC = lock.acquire('session-c');
        assert.strictEqual(lock.pending, 2);

        lock.releaseForTokens(['session-a', 'session-b']);

        assert.deepStrictEqual(await waitingB, { status: 'revoked' });
        assert.deepStrictEqual(await waitingC, { status: 'acquired' }, 'an unaffected waiter inherits the lock');
        lock.release('session-c');
    });

    test('an abort while queued cancels the waiter without executing', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });
        await lock.acquire('session-a');

        const controller = new AbortController();
        const waiting = lock.acquire('session-b', controller.signal);
        assert.strictEqual(lock.pending, 1);
        controller.abort();

        assert.deepStrictEqual(await waiting, { status: 'cancelled' });
        assert.strictEqual(lock.pending, 0);

        lock.release('session-a');
        assert.strictEqual(lock.holder, null);
    });

    test('the holder may re-enter its own lock without queueing', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });
        assert.deepStrictEqual(await lock.acquire('session-a'), { status: 'acquired' });
        assert.deepStrictEqual(await lock.acquire('session-a'), { status: 'acquired' });
        assert.strictEqual(lock.pending, 0);
        lock.release('session-a');
        lock.release('session-a');
        assert.strictEqual(lock.holder, null);
    });

    test('audit events carry a session digest and lock state but never secrets or arguments', async () => {
        const audit: ApprovalAuditEvent[] = [];
        const lock = new WriteLock({ timeoutMs: 60_000, audit: event => audit.push(event) });

        await lock.acquire('session-a');
        await lock.acquire('session-a');
        lock.release('session-a');

        assert.ok(audit.length >= 3);
        for (const event of audit) {
            assert.strictEqual(event.sessionRef, sessionTokenRef('session-a'));
            assert.ok(!('token' in event), 'the raw token must never reach the audit log');
            assert.ok(!('args' in event) && !('command' in event), 'tool arguments must never reach the audit log');
        }
        assert.strictEqual(audit[0].event, 'write_lock_acquired');
        assert.strictEqual(audit[1].event, 'write_lock_acquired');
        assert.strictEqual(audit[2].event, 'write_lock_released');
    });
});

suite('Cross-browser write lock in the tool call route', () => {
    test('a write from a second browser waits FIFO, then runs after the first releases', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });
        const gate = new ToolConcurrencyGate(2);
        const started: string[] = [];
        const blocking = createBlockingTool('write_file', session => started.push(session));

        const options = createOptions({
            concurrencyGate: gate,
            lock,
            localTool: blocking.tool
        });

        const handler = createToolCallHandler(options);
        const first = invokeHandler(handler, { name: 'write_file', arguments: {} }, 'session-a');
        await settle();
        const second = invokeHandler(handler, { name: 'write_file', arguments: {} }, 'session-b');
        await settle();

        assert.deepStrictEqual(started, ['session-a'], 'the second browser must wait for the write lock');
        assert.strictEqual(lock.pending, 1);

        blocking.releases.shift()?.();
        await first;
        await settle();
        assert.deepStrictEqual(started, ['session-a', 'session-b'], 'the queued writer runs FIFO once the lock frees');

        blocking.releases.shift()?.();
        await second;
    });

    test('a queued write from another browser times out with a retryable 423', async () => {
        const lock = new WriteLock({ timeoutMs: 40 });
        const blocking = createBlockingTool('execute_command');

        const options = createOptions({
            lock,
            localTool: blocking.tool
        });

        const handler = createToolCallHandler(options);
        const first = invokeHandler(handler, { name: 'execute_command', arguments: { command: 'pnpm build' } }, 'session-a');
        await settle();

        const second = await invokeHandler(
            handler,
            { name: 'execute_command', arguments: { command: 'pnpm test' } },
            'session-b'
        );

        assert.strictEqual(second.statusCode, 423);
        const body = second.body as { isError: boolean; content: Array<{ text: string }> };
        assert.strictEqual(body.isError, true);
        assert.strictEqual(body.content[0].text, WRITE_LOCK_TIMEOUT_TEXT);
        assert.ok(body.content[0].text.includes('另一浏览器正在写入'), 'the retryable text must name the cross-browser cause');

        blocking.releases.shift()?.();
        await first;
    });

    test('read-class calls from other browsers proceed while a write holds the lock', async () => {
        const lock = new WriteLock({ timeoutMs: 60_000 });
        const blocking = createBlockingTool('write_file');

        const options = createOptions({
            lock,
            localTool: blocking.tool
        });
        options.localTools.set('read_file', createLocalTool('read_file', () => Promise.resolve({ content: [] })));
        options.getToolDefinition = name => {
            const tool = options.localTools.get(name);
            return tool ? tool.definition : null;
        };

        const handler = createToolCallHandler(options);
        const writing = invokeHandler(handler, { name: 'write_file', arguments: {} }, 'session-a');
        await settle();
        assert.strictEqual(lock.holder, 'session-a');

        const reading = await invokeHandler(handler, { name: 'read_file', arguments: {} }, 'session-b');
        assert.strictEqual(reading.statusCode, 200, 'reads must not wait behind a write lock');

        blocking.releases.shift()?.();
        await writing;
    });
});

function createRelease(resolve: (value: ToolResult) => void): () => void {
    return () => resolve({ content: [] });
}

/** A write tool whose execution blocks until the test releases it. */
function createBlockingTool(name: string, onStart?: (session: string) => void): { tool: LocalTool; releases: Array<() => void> } {
    const releases: Array<() => void> = [];
    const tool = createLocalTool(name, session => {
        onStart?.(session);
        return new Promise<ToolResult>(resolve => releases.push(createRelease(resolve)));
    });
    return { tool, releases };
}

function createLocalTool(name: string, execute: (session: string) => Promise<ToolResult>): LocalTool {
    return {
        definition: {
            name,
            description: `test tool ${name}`,
            inputSchema: { type: 'object', properties: {}, additionalProperties: true }
        },
        // The session label reaches the tool through a closure in createOptions;
        // execute itself only receives args per the LocalTool contract.
        execute: () => execute(currentSession())
    };
}

let activeSession = 'session-a';
function currentSession(): string {
    return activeSession;
}

function createOptions(overrides: {
    concurrencyGate?: ToolConcurrencyGate;
    lock: WriteLock;
    localTool: LocalTool;
}): ToolCallHandlerOptions {
    const localTools = new Map<string, LocalTool>();
    localTools.set(overrides.localTool.definition.name, overrides.localTool);

    return {
        ...(overrides.concurrencyGate ? { concurrencyGate: overrides.concurrencyGate } : {}),
        commandApprovalManager: new CommandApprovalManager(),
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getToolCallTimeoutMs: () => 0,
        getToolDefinition: name => overrides.localTool.definition.name === name ? overrides.localTool.definition : null,
        getWorkspaceRoot: () => process.cwd(),
        localTools,
        log: () => undefined,
        toolRouter: new Map(),
        writeLock: overrides.lock
    };
}

async function invokeHandler(
    handler: express.RequestHandler,
    body: Record<string, unknown>,
    sessionToken: string
): Promise<{ body: unknown; statusCode: number }> {
    let responseBody: unknown;
    let statusCode = 200;
    const response = {
        status(code: number) {
            statusCode = code;
            return response;
        },
        json(value: unknown) {
            responseBody = value;
            return response;
        }
    };

    activeSession = sessionToken;
    await Promise.resolve(handler(
        {
            body,
            bridgeSession: { token: sessionToken, siteId: 'chatgpt', connectedAt: 0, lastSeenAt: 0 }
        } as unknown as express.Request,
        response as unknown as express.Response,
        () => undefined
    ));
    return { body: responseBody, statusCode };
}

function settle(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
