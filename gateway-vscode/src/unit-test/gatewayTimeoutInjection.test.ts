import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';
import * as vscode from 'vscode';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { CommandApprovalManager, DEFAULT_APPROVAL_TTL_MS } from '../gateway/commandApproval';
import { BridgeSessionManager, DEFAULT_BRIDGE_CODE_TTL_MS } from '../gateway/bridgeSession';
import { readBrowserLaunchWaitMs } from '../extension/browserExtensionManager';
import { DEFAULT_MCP_TOOL_TIMEOUT_MS, resolveServerToolTimeoutMs } from '../gateway/serverConnector';
import { createToolCallHandler } from '../gateway/toolCallRoute';
import { DEFAULT_BROWSER_LAUNCH_WAIT_MS } from '../gateway/timeouts';
import type { RemoteToolRoute } from '../gateway/types';
import type { ToolExecutionContext } from '../tools';

const LAUNCH = { siteId: 'chatgpt', targetUrl: 'https://chatgpt.com/' };
const MCP_TIMEOUT_FIXTURE_MS = 1234;
const REMOTE_TOOL_NAME = 'srv:fast';

suite('Gateway timeout injection', () => {
    test('keeps the 60 second default bridge code TTL', () => {
        let now = 0;
        const manager = new BridgeSessionManager(undefined, () => now);
        const code = manager.issueBridgeCode(LAUNCH);

        now = DEFAULT_BRIDGE_CODE_TTL_MS - 1;
        assert.ok(manager.getBridgeLaunch(code), 'a code issued with the default TTL must still be valid inside it');

        now = DEFAULT_BRIDGE_CODE_TTL_MS;
        assert.strictEqual(manager.getBridgeLaunch(code), null);
    });

    test('applies a configured bridge code TTL without extending codes already issued', () => {
        let now = 0;
        const manager = new BridgeSessionManager(100, () => now);
        const shortLived = manager.issueBridgeCode(LAUNCH);

        manager.setBridgeCodeTtlMs(1000);
        now = 101;
        assert.strictEqual(
            manager.getBridgeLaunch(shortLived),
            null,
            'a retargeted TTL must not extend a code that was already issued'
        );

        const longLived = manager.issueBridgeCode(LAUNCH);
        now = 1000;
        assert.ok(manager.getBridgeLaunch(longLived));

        now = 1101;
        assert.strictEqual(manager.getBridgeLaunch(longLived), null);
    });

    test('keeps the 2 minute default approval TTL and applies a configured one', () => {
        let now = 0;
        const defaults = new CommandApprovalManager(undefined, () => now);
        const defaultChallenge = defaults.issueChallenge('fingerprint');
        assert.strictEqual(defaultChallenge.expiresAt - now, DEFAULT_APPROVAL_TTL_MS);

        const manager = new CommandApprovalManager(undefined, () => now);
        manager.setTtlMs(30);
        const pending = manager.issueChallenge('fingerprint');
        now += 31;
        assert.strictEqual(manager.approveChallenge(pending.challengeId), null);

        const challenge = manager.issueChallenge('fingerprint');
        const grant = manager.approveChallenge(challenge.challengeId);
        assert.ok(grant);
        assert.strictEqual(grant.expiresAt - now, 30);

        now += 31;
        assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint'), false);
    });

    test('defaults the per-server tool timeout to the MCP SDK request timeout', () => {
        // The MCP SDK falls back to DEFAULT_REQUEST_TIMEOUT_MSEC (60000 ms) when
        // a request carries no timeout; the server setting defaults to the same.
        assert.strictEqual(DEFAULT_MCP_TOOL_TIMEOUT_MS, 60_000);
        assert.strictEqual(resolveServerToolTimeoutMs({}), DEFAULT_MCP_TOOL_TIMEOUT_MS);
        assert.strictEqual(resolveServerToolTimeoutMs({ toolTimeoutMs: MCP_TIMEOUT_FIXTURE_MS }), MCP_TIMEOUT_FIXTURE_MS);
        assert.strictEqual(resolveServerToolTimeoutMs({ toolTimeoutMs: 0 }), DEFAULT_MCP_TOOL_TIMEOUT_MS);
        assert.strictEqual(resolveServerToolTimeoutMs({ toolTimeoutMs: -5 }), DEFAULT_MCP_TOOL_TIMEOUT_MS);
        assert.strictEqual(resolveServerToolTimeoutMs({ toolTimeoutMs: Number.NaN }), DEFAULT_MCP_TOOL_TIMEOUT_MS);
    });

    test('passes the per-server timeout to the MCP client call', async () => {
        const calls: unknown[][] = [];
        const response = await invokeRemoteTool(calls, MCP_TIMEOUT_FIXTURE_MS);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(calls.length, 1);
        assert.deepStrictEqual(calls[0][0], { name: 'fast', arguments: {} });
        assert.strictEqual(calls[0][1], undefined);
        const callOptions = readCallOptions(calls[0]);
        assert.strictEqual(callOptions?.timeout, MCP_TIMEOUT_FIXTURE_MS);
        assert.ok(callOptions?.signal instanceof AbortSignal, 'the call must carry an abort signal');
    });

    test('leaves the MCP request timeout unset when the route has none', async () => {
        const calls: unknown[][] = [];
        const response = await invokeRemoteTool(calls, undefined);

        assert.strictEqual(response.statusCode, 200);
        const callOptions = readCallOptions(calls[0]);
        assert.strictEqual(callOptions?.timeout, undefined);
        assert.ok(callOptions?.signal instanceof AbortSignal, 'the call must carry an abort signal');
    });

    test('reports an MCP request timeout with the same deadline wording', async () => {
        const sdkTimeout = Object.assign(new Error('Request timed out'), {
            code: ErrorCode.RequestTimeout
        });
        const response = await invokeRemoteTool(
            [],
            MCP_TIMEOUT_FIXTURE_MS,
            () => Promise.reject(sdkTimeout)
        );

        assert.strictEqual(response.statusCode, 504);
        const text = readContentText(response.body);
        assert.ok(text.includes(`timed out after ${MCP_TIMEOUT_FIXTURE_MS} ms`), text);
        assert.ok(text.includes('MCP request deadline'), text);
        assert.ok(text.includes('abort request was sent to the MCP server'), text);
    });

    test('reads the browser launch wait from the gateway settings', () => {
        const workspaceStub = vscode.workspace as unknown as { getConfiguration: () => unknown };
        const original = workspaceStub.getConfiguration;

        try {
            workspaceStub.getConfiguration = () => ({ get: () => 30_000 });
            assert.strictEqual(readBrowserLaunchWaitMs(), 30_000);

            workspaceStub.getConfiguration = () => ({ get: () => undefined });
            assert.strictEqual(readBrowserLaunchWaitMs(), DEFAULT_BROWSER_LAUNCH_WAIT_MS);

            workspaceStub.getConfiguration = () => ({ get: () => 'soon' });
            assert.strictEqual(readBrowserLaunchWaitMs(), DEFAULT_BROWSER_LAUNCH_WAIT_MS);
        } finally {
            workspaceStub.getConfiguration = original;
        }
    });
});

/** Reads the third callTool argument, which carries the timeout and signal. */
function readCallOptions(call: unknown[]): { signal?: AbortSignal; timeout?: number } | undefined {
    const options = call[2];
    return typeof options === 'object' && options !== null
        ? options as { signal?: AbortSignal; timeout?: number }
        : undefined;
}

async function invokeRemoteTool(
    calls: unknown[][],
    toolTimeoutMs: number | undefined,
    callTool?: () => Promise<unknown>
): Promise<{ body: unknown; statusCode: number }> {
    const route: RemoteToolRoute = {
        client: {
            callTool: callTool ?? ((...args: unknown[]) => {
                calls.push(args);
                return Promise.resolve({ content: [] });
            })
        } as unknown as RemoteToolRoute['client'],
        definition: {
            name: REMOTE_TOOL_NAME,
            description: 'remote test tool',
            inputSchema: { type: 'object', properties: {} }
        },
        serverId: 'srv',
        toolName: 'fast',
        toolTimeoutMs
    };

    const options = {
        commandApprovalManager: new CommandApprovalManager(),
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getToolCallTimeoutMs: () => 0,
        getToolDefinition: (name: string) => name === REMOTE_TOOL_NAME ? route.definition : null,
        getWorkspaceRoot: () => process.cwd(),
        localTools: new Map(),
        log: () => undefined,
        toolRouter: new Map([[REMOTE_TOOL_NAME, route]])
    };

    return invokeHandler(createToolCallHandler(options), {
        name: REMOTE_TOOL_NAME,
        arguments: {}
    });
}

function readContentText(body: unknown): string {
    const content = (body as { content?: unknown }).content;
    if (!Array.isArray(content) || content.length === 0) {
        return '';
    }
    const first = content[0] as { text?: unknown };
    return typeof first.text === 'string' ? first.text : '';
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
