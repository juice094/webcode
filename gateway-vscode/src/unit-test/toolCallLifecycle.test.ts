import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { InFlightCallRegistry } from '../gateway/inFlightCalls';
import { ToolConcurrencyGate } from '../gateway/toolConcurrency';
import { createToolCallHandler, type ToolCallHandlerOptions } from '../gateway/toolCallRoute';
import type { LocalTool, ToolExecutionContext, ToolResult } from '../tools';

const DEADLINE_MS = 30;

suite('Tool call lifecycle (batch C)', () => {
    test('removes the in-flight entry after a timeout and ends the call once', async () => {
        const registry = new InFlightCallRegistry(() => undefined);
        const endCalls: string[] = [];
        const pending = createDeferred<ToolResult>();

        const options = createOptions({
            toolCallTimeoutMs: DEADLINE_MS,
            localTool: createLocalTool(() => pending.promise),
            onToolCallStart: info => registry.start(info),
            onToolCallEnd: callId => {
                endCalls.push(callId);
                registry.end(callId);
            }
        });

        const response = await invokeHandler(createToolCallHandler(options), { name: 'slow_tool', arguments: {} });
        await settle();

        assert.strictEqual(response.statusCode, 504);
        assert.deepStrictEqual(registry.snapshot(), [], 'the snapshot must be empty after the call ends');
        assert.strictEqual(endCalls.length, 1, 'onToolCallEnd must run exactly once');

        pending.resolve({ content: [] });
        await settle();
        assert.strictEqual(endCalls.length, 1, 'settling late work must not end the call again');
    });

    test('removes the in-flight entry after a successful call', async () => {
        const registry = new InFlightCallRegistry(() => undefined);
        const options = createOptions({
            toolCallTimeoutMs: 0,
            localTool: createLocalTool(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] })),
            onToolCallStart: info => registry.start(info),
            onToolCallEnd: callId => registry.end(callId)
        });

        const response = await invokeHandler(createToolCallHandler(options), { name: 'slow_tool', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        assert.deepStrictEqual(registry.snapshot(), []);
    });

    test('queues the second call behind the gate instead of running it concurrently', async () => {
        const gate = new ToolConcurrencyGate(1);
        const started: string[] = [];
        const releases: Array<() => void> = [];

        const options = createOptions({
            concurrencyGate: gate,
            toolCallTimeoutMs: 0,
            localTool: createLocalTool(() => {
                started.push('call');
                return new Promise<ToolResult>(resolve => {
                    releases.push(() => resolve({ content: [] }));
                });
            })
        });

        const handler = createToolCallHandler(options);
        const first = invokeHandler(handler, { name: 'slow_tool', arguments: {} });
        await settle();
        const second = invokeHandler(handler, { name: 'slow_tool', arguments: {} });
        await settle();

        assert.strictEqual(started.length, 1, 'only one call may run at a time');
        assert.strictEqual(gate.pending, 1, 'the second call must be parked');

        releases.shift()?.();
        await settle();
        assert.strictEqual(started.length, 2, 'the parked call starts after a slot frees');
        releases.shift()?.();

        await Promise.all([first, second]);
    });
});

function createLocalTool(execute: () => Promise<ToolResult>): LocalTool {
    return {
        definition: {
            name: 'slow_tool',
            description: 'test tool',
            inputSchema: { type: 'object', properties: {} }
        },
        execute: () => execute()
    };
}

function createOptions(overrides: {
    concurrencyGate?: ToolConcurrencyGate;
    toolCallTimeoutMs: number;
    localTool: LocalTool;
    onToolCallStart?: ToolCallHandlerOptions['onToolCallStart'];
    onToolCallEnd?: ToolCallHandlerOptions['onToolCallEnd'];
}): ToolCallHandlerOptions {
    const localTools = new Map<string, LocalTool>();
    localTools.set(overrides.localTool.definition.name, overrides.localTool);

    return {
        ...(overrides.concurrencyGate ? { concurrencyGate: overrides.concurrencyGate } : {}),
        commandApprovalManager: new CommandApprovalManager(),
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getToolCallTimeoutMs: () => overrides.toolCallTimeoutMs,
        getToolDefinition: name => overrides.localTool.definition.name === name ? overrides.localTool.definition : null,
        getWorkspaceRoot: () => process.cwd(),
        localTools,
        log: () => undefined,
        ...(overrides.onToolCallStart ? { onToolCallStart: overrides.onToolCallStart } : {}),
        ...(overrides.onToolCallEnd ? { onToolCallEnd: overrides.onToolCallEnd } : {}),
        toolRouter: new Map()
    };
}

async function invokeHandler(
    handler: express.RequestHandler,
    body: Record<string, unknown>
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

    await Promise.resolve(handler(
        { body } as express.Request,
        response as unknown as express.Response,
        () => undefined
    ));
    return { body: responseBody, statusCode };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(innerResolve => { resolve = innerResolve; });
    return { promise, resolve };
}

function settle(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
