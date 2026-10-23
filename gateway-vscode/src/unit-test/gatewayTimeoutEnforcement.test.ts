import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { runWithDeadline } from '../gateway/toolCallDeadline';
import { createToolCallHandler } from '../gateway/toolCallRoute';
import { MAX_COMMAND_EXECUTION_MS, MIN_COMMAND_EXECUTION_MS } from '../gateway/timeouts';
import type { RemoteToolRoute } from '../gateway/types';
import { executeCommandTool } from '../tools/executeCommandTool';
import type { LocalTool, ToolExecutionContext, ToolResult } from '../tools';

// Fixtures only: the policy numbers live in ../gateway/timeouts.
const TOOL_CALL_DEADLINE_MS = 40;
const DISABLED_DEADLINE_MS = 0;
const SLOW_TOOL_DELAY_MS = TOOL_CALL_DEADLINE_MS * 4;
const SLOW_COMMAND = 'sleep 2';
const REMOTE_TOOL_NAME = 'srv:slow';

suite('Gateway timeout enforcement', () => {
    test('aborts an overrunning local tool at the deadline', async () => {
        const pending = createDeferred<ToolResult>();
        let receivedSignal: AbortSignal | undefined;
        const options = createHandlerOptions({
            toolCallTimeoutMs: TOOL_CALL_DEADLINE_MS,
            localTool: createLocalTool((_signal?: AbortSignal) => {
                receivedSignal = _signal;
                return pending.promise;
            })
        });

        const response = await invokeHandler(createToolCallHandler(options), {
            name: 'slow_tool',
            arguments: {}
        });

        assert.strictEqual(response.statusCode, 504);
        const text = readContentText(response.body);
        assert.ok(text.includes(`timed out after ${TOOL_CALL_DEADLINE_MS} ms`), text);
        assert.ok(text.includes('aborted the call'), text);
        assert.ok(text.includes('signalled to terminate'), text);
        assert.strictEqual(receivedSignal?.aborted, true, 'the deadline must abort the tool signal');

        // Settling the abandoned work later must not throw, answer twice, or
        // surface as an unhandled rejection.
        pending.resolve({ content: [{ type: 'text', text: 'late result' }] });
        await settle();
        assert.strictEqual(response.statusCode, 504);
    });

    test('aborts the signal when the client disconnects', async () => {
        const pending = createDeferred<ToolResult>();
        let receivedSignal: AbortSignal | undefined;
        const options = createHandlerOptions({
            toolCallTimeoutMs: DISABLED_DEADLINE_MS,
            localTool: createLocalTool((signal?: AbortSignal) => {
                receivedSignal = signal;
                return pending.promise;
            })
        });

        const handler = createToolCallHandler(options);
        const response = createFakeResponse();
        const run = Promise.resolve(handler(
            { body: { name: 'slow_tool', arguments: {} } } as express.Request,
            response as unknown as express.Response,
            () => undefined
        ));

        await settle();
        response.emitClose();
        await settle();

        assert.strictEqual(receivedSignal?.aborted, true, 'a disconnect must abort the tool signal');
        pending.resolve({ content: [] });
        await run;
    });

    test('applies the same deadline to remote MCP tools and aborts them', async () => {
        const pending = createDeferred<unknown>();
        let receivedSignal: AbortSignal | undefined;
        const callTool = (_params: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => {
            receivedSignal = options?.signal;
            return pending.promise;
        };
        const options = createHandlerOptions({
            toolCallTimeoutMs: TOOL_CALL_DEADLINE_MS,
            remoteRoute: createRemoteRoute(callTool)
        });

        const response = await invokeHandler(createToolCallHandler(options), {
            name: REMOTE_TOOL_NAME,
            arguments: {}
        });

        assert.strictEqual(response.statusCode, 504);
        const text = readContentText(response.body);
        assert.ok(text.includes(`timed out after ${TOOL_CALL_DEADLINE_MS} ms`), text);
        assert.ok(text.includes('abort request was sent to the MCP server'), text);
        assert.strictEqual(receivedSignal?.aborted, true, 'the deadline must abort the MCP call');

        pending.resolve({ content: [] });
        await settle();
    });

    test('leaves the tool call untouched when the deadline is disabled', async () => {
        const work = Promise.resolve<ToolResult>({ content: [{ type: 'text', text: 'done' }] });
        assert.strictEqual(
            runWithDeadline(DISABLED_DEADLINE_MS, () => work),
            work,
            'a disabled deadline must not wrap the work promise'
        );

        const slowWork = async () => {
            await delay(SLOW_TOOL_DELAY_MS);
            return { content: [{ type: 'text', text: 'done' }] };
        };
        const options = createHandlerOptions({
            toolCallTimeoutMs: DISABLED_DEADLINE_MS,
            localTool: createLocalTool(slowWork)
        });

        const response = await invokeHandler(createToolCallHandler(options), {
            name: 'slow_tool',
            arguments: {}
        });

        assert.strictEqual(response.statusCode, 200);
        assert.ok(readContentText(response.body).includes('done'));
    });

    test('execute_command stops the run at the deadline injected through the tool context', async () => {
        const context = createCommandContext(MIN_COMMAND_EXECUTION_MS);
        const result = await executeCommandTool.execute({ command: SLOW_COMMAND }, context);

        assert.strictEqual(result.isError, true);
        const text = readToolText(result);
        assert.ok(text.includes(`timed out after ${MIN_COMMAND_EXECUTION_MS} ms`), text);
        assert.ok(text.includes('may still be running'), text);
        assert.strictEqual(readPayloadBoolean(text, 'timedOut'), true);
    });

    test('execute_command exposes the injected deadline as its schema default', () => {
        const definition = executeCommandTool.getDefinition?.({
            commandShellPath: undefined,
            commandExecutionMs: MAX_COMMAND_EXECUTION_MS
        });
        assert.ok(definition, 'execute_command must build a definition from its context');

        const properties = (definition.inputSchema as {
            properties: Record<string, Record<string, unknown>>;
        }).properties;
        assert.strictEqual(properties.timeout.default, MAX_COMMAND_EXECUTION_MS);
        assert.strictEqual(properties.timeout.maximum, MAX_COMMAND_EXECUTION_MS);
        assert.ok(String(properties.timeout.description).includes(`Default: ${MAX_COMMAND_EXECUTION_MS}.`));
    });
});

function createLocalTool(execute: (signal?: AbortSignal) => Promise<ToolResult>): LocalTool {
    return {
        definition: {
            name: 'slow_tool',
            description: 'test tool that outlives the deadline',
            inputSchema: { type: 'object', properties: {} }
        },
        execute: (args, context, signal) => execute(signal)
    };
}

function createRemoteRoute(
    callTool: (params: unknown, schema: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
): RemoteToolRoute {
    return {
        client: { callTool } as unknown as RemoteToolRoute['client'],
        definition: {
            name: REMOTE_TOOL_NAME,
            description: 'remote tool that outlives the deadline',
            inputSchema: { type: 'object', properties: {} }
        },
        serverId: 'srv',
        toolName: 'slow'
    };
}

/**
 * Fake response that can emit `close`, which a real express response does. The
 * handler uses that event to abort a call whose client went away.
 */
function createFakeResponse(): {
    status: (code: number) => unknown;
    json: (value: unknown) => unknown;
    once: (event: string, listener: () => void) => void;
    emitClose: () => void;
    statusCode: number;
} {
    const listeners: Array<() => void> = [];
    const response = {
        statusCode: 200,
        status(code: number) {
            response.statusCode = code;
            return response;
        },
        json(value: unknown) {
            void value;
            return response;
        },
        once(event: string, listener: () => void) {
            if (event === 'close') {
                listeners.push(listener);
            }
        },
        emitClose() {
            for (const listener of listeners) {
                listener();
            }
        }
    };
    return response;
}

function createHandlerOptions(params: {
    toolCallTimeoutMs: number;
    localTool?: LocalTool;
    remoteRoute?: RemoteToolRoute;
}) {
    const localTools = new Map<string, LocalTool>();
    if (params.localTool) {
        localTools.set(params.localTool.definition.name, params.localTool);
    }

    const toolRouter = new Map<string, RemoteToolRoute>();
    if (params.remoteRoute) {
        toolRouter.set(REMOTE_TOOL_NAME, params.remoteRoute);
    }

    return {
        commandApprovalManager: new CommandApprovalManager(),
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getToolCallTimeoutMs: () => params.toolCallTimeoutMs,
        getToolDefinition: (name: string) => params.localTool?.definition.name === name
            ? params.localTool.definition
            : params.remoteRoute?.definition.name === name
                ? params.remoteRoute.definition
                : null,
        getWorkspaceRoot: () => process.cwd(),
        localTools,
        log: () => undefined,
        toolRouter
    };
}

function createCommandContext(commandExecutionMs: number): ToolExecutionContext {
    return {
        workspaceRoot: process.cwd(),
        commandAllowedRoots: [],
        commandExecutionMs
    } as unknown as ToolExecutionContext;
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

function readContentText(body: unknown): string {
    const content = readRecord(body).content;
    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map(entry => readRecord(entry).text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}

function readToolText(result: ToolResult): string {
    return result.content
        .map(entry => entry.text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}

function readPayloadBoolean(text: string, key: string): unknown {
    try {
        return readRecord(JSON.parse(text))[key];
    } catch {
        return undefined;
    }
}

function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : {};
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(innerResolve => {
        resolve = innerResolve;
    });

    return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function settle(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
