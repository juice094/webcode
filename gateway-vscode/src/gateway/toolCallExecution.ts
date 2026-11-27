import type { Response } from 'express';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { isBootstrapOnlyToolName } from '@webcode/shared';

import type { LocalTool, ToolExecutionContext } from '../tools';
import type { CompressionOutcome } from '../tools/resultCompression';
import { getErrorMessage } from './errorUtils';
import type { GatewayErrorLogger, GatewayLogger, RemoteToolRoute } from './types';
import type { GatewayRuntimeTraceSink } from './runtimeTrace';
import type { ApprovalAuditSink } from './approvalAudit';
import { auditEvent } from './approvalAuditEvents';
import { DEFAULT_MCP_TOOL_TIMEOUT_MS } from './serverConnector';
import {
    formatToolCallTimeoutMessage,
    runWithDeadline,
    ToolCallTimeoutError,
    type ToolCallScope
} from './toolCallDeadline';

export type ParsedToolCallRequest = {
    approvalToken?: string;
    args: Record<string, unknown>;
    name: string;
    internalCallId?: string;
};

/**
 * S4 事件流：一次工具调用的终态（与 tool/call 按 callId 配对）。
 * status 四态覆盖成功/失败/策略拒绝/客户端取消，保证每个 tool/call 都有对应 result。
 */
export type ToolCallResultInfo = {
    callId: string;
    toolName: string;
    status: 'success' | 'error' | 'rejected' | 'cancelled';
    durationMs: number;
    error?: string;
    result?: unknown;
};

export type ToolExecutionDeps = {
    audit?: ApprovalAuditSink;
    /** Compresses tool-result text per the configured policy; absent or never called means identity. */
    compressResult?: (text: string) => CompressionOutcome;
    error: GatewayErrorLogger;
    getToolCallTimeoutMs?: () => number;
    log: GatewayLogger;
    /** S4 event stream sink; omitted by the VS Code host. */
    onToolCallResult?: (info: ToolCallResultInfo) => void;
    trace?: GatewayRuntimeTraceSink;
};

export type ToolBackend =
    | { kind: 'local'; tool: LocalTool }
    | { kind: 'remote'; route: RemoteToolRoute };

export type ToolExecutionInput = {
    backend: ToolBackend;
    /** Stable id of this call inside the gateway (the event stream correlates on it). */
    callId: string;
    contextFactory: () => ToolExecutionContext;
    controller: AbortController;
    deps: ToolExecutionDeps;
    request: ParsedToolCallRequest;
    res: Response;
    toolStart: number;
};

const TRACE_EVIDENCE_ARGUMENTS = new Set(['path', 'customerId']);

/**
 * Runs one tool call through a single telemetry path.
 *
 * Local tools and remote MCP tools differ only in how the work is invoked, so
 * the deadline, trace events, audit events, timeout wording, and error mapping
 * live here once. Adding a new backend means adding a branch to `invoke`, not
 * copying this sequence.
 */
export async function executeWithTelemetry(input: ToolExecutionInput): Promise<void> {
    const { backend, callId, contextFactory, controller, deps, request, res, toolStart } = input;
    const label = backend.kind === 'local' ? 'local tool' : 'MCP tool';
    deps.log(`   🚀 Executing ${label}: ${request.name} ${previewArgs(request.args, backend.kind === 'local' ? 80 : 50)}`);
    deps.trace?.({
        event: 'tool_call_started',
        requestId: request.internalCallId,
        toolName: request.name,
        status: 'started',
        details: createTraceArgumentDetails(request.args)
    });

    try {
        const result = await runWithDeadline(
            resolveToolCallDeadlineMs(deps),
            signal => invokeBackend(backend, request, signal, contextFactory),
            { signal: controller.signal, onTimeout: error => controller.abort(error) }
        );
        const durationMs = Date.now() - toolStart;
        deps.audit?.(auditEvent('execution_finished', request, { status: 'success', durationMs }));
        deps.onToolCallResult?.({
            callId,
            toolName: request.name,
            status: 'success',
            durationMs,
            result
        });
        deps.log(`   ✅ Finished: ${request.name} (${durationMs}ms)`);
        deps.trace?.({
            event: 'tool_call_finished',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'success',
            durationMs
        });
        if (canRespond(res)) {
            // Bootstrap tools feed the init context (Available Tools / Skills);
            // their results are the single source of truth for tool names and
            // schemas, so they must never be summarized or truncated.
            const compressor = deps.compressResult && !isBootstrapOnlyToolName(request.name)
                ? deps.compressResult
                : undefined;
            res.json(compressor ? compressResultPayload(result, compressor) : result);
        }
    } catch (error: unknown) {
        handleExecutionError({ backend, callId, deps, error, request, res, toolStart });
    }
}

function invokeBackend(
    backend: ToolBackend,
    request: ParsedToolCallRequest,
    signal: AbortSignal,
    contextFactory: () => ToolExecutionContext
): Promise<unknown> {
    if (backend.kind === 'local') {
        return backend.tool.execute(request.args, contextFactory(), signal);
    }

    return backend.route.client.callTool(
        { name: backend.route.toolName, arguments: request.args ?? {} },
        undefined,
        { timeout: backend.route.toolTimeoutMs, signal }
    );
}

type ExecutionErrorInput = {
    backend: ToolBackend;
    callId: string;
    deps: ToolExecutionDeps;
    error: unknown;
    request: ParsedToolCallRequest;
    res: Response;
    toolStart: number;
};

function handleExecutionError(input: ExecutionErrorInput): void {
    const { backend, callId, deps, error, request, res, toolStart } = input;

    if (error instanceof ToolCallTimeoutError) {
        deps.audit?.(auditEvent('execution_finished', request, { status: 'error', error: 'timeout' }));
        deps.onToolCallResult?.({
            callId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            error: 'timeout'
        });
        sendToolTimeout(res, request, error.deadlineMs, {
            scope: backend.kind === 'local' ? 'local' : 'mcp',
            toolStart
        }, deps);
        return;
    }

    if (backend.kind === 'remote' && isMcpRequestTimeout(error)) {
        // The MCP SDK enforces its own tools/call deadline; report it with the
        // same wording as the gateway deadline instead of a raw SDK error.
        deps.onToolCallResult?.({
            callId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            error: 'mcp-request-timeout'
        });
        sendToolTimeout(res, request, backend.route.toolTimeoutMs ?? DEFAULT_MCP_TOOL_TIMEOUT_MS, {
            scope: 'mcp-request',
            toolStart
        }, deps);
        return;
    }

    const errorText = getErrorMessage(error);
    deps.audit?.(auditEvent('execution_finished', request, { status: 'error', error: errorText }));
    deps.onToolCallResult?.({
        callId,
        toolName: request.name,
        status: 'error',
        durationMs: Date.now() - toolStart,
        error: errorText
    });
    deps.error(`Tool execution failed: ${request.name}`, error);
    deps.trace?.({
        event: 'tool_call_finished',
        requestId: request.internalCallId,
        toolName: request.name,
        status: 'error',
        durationMs: Date.now() - toolStart,
        details: { error: getErrorMessage(error) }
    });
    sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
}

/**
 * S4 事件流：策略拒绝/取消路径的收尾。调用方已经发过 tool/call，这里补一条
 * tool/result，保证每个调用都有配对结果（成功/失败/拒绝/取消四态闭合）。
 */
export function rejectToolCallResult(
    onResult: ((info: ToolCallResultInfo) => void) | undefined,
    call: { callId: string; toolName: string; toolStart: number },
    status: 'rejected' | 'cancelled',
    error?: string
): void {
    onResult?.({
        callId: call.callId,
        toolName: call.toolName,
        status,
        durationMs: Date.now() - call.toolStart,
        ...(error === undefined ? {} : { error })
    });
}

export function sendToolError(res: Response, status: number, text: string): void {
    if (!canRespond(res)) {
        return;
    }
    res.status(status).json({
        isError: true,
        content: [{ type: 'text', text }]
    });
}

export function sendToolTimeout(
    res: Response,
    request: ParsedToolCallRequest,
    deadlineMs: number,
    timing: { scope: ToolCallScope; toolStart: number },
    deps: Pick<ToolExecutionDeps, 'log' | 'trace'>
): void {
    const message = formatToolCallTimeoutMessage(request.name, deadlineMs, timing.scope);
    deps.log(`   ⏱️ ${message}`);
    deps.trace?.({
        event: 'tool_call_finished',
        requestId: request.internalCallId,
        toolName: request.name,
        status: 'error',
        durationMs: Date.now() - timing.toolStart,
        details: { error: message, timedOut: true }
    });
    sendToolError(res, 504, message);
}

export function createTraceArgumentDetails(args: Record<string, unknown>): Record<string, unknown> {
    const evidenceArguments: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        if (!TRACE_EVIDENCE_ARGUMENTS.has(key)) {
            continue;
        }
        if (typeof value === 'string') {
            evidenceArguments[key] = value.slice(0, 200);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            evidenceArguments[key] = value;
        }
    }
    return {
        argumentKeys: Object.keys(args).sort(),
        arguments: evidenceArguments
    };
}

function resolveToolCallDeadlineMs(deps: ToolExecutionDeps): number {
    return deps.getToolCallTimeoutMs?.() ?? 0;
}

function isMcpRequestTimeout(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && (error as { code?: unknown }).code === ErrorCode.RequestTimeout;
}

function previewArgs(args: Record<string, unknown>, limit: number): string {
    const rendered = JSON.stringify(args ?? {});
    return rendered.length <= limit ? rendered : `${rendered.slice(0, limit)}…`;
}

/** A closed or already-answered response must not be written to again. */
function canRespond(res: Response): boolean {
    return res.headersSent !== true && res.writableEnded !== true && res.destroyed !== true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The single chokepoint where tool-result text is compressed before the
 * result travels back to the AI (local tools and remote MCP tools converge
 * here). Text items the compressor leaves untouched are returned as-is; only
 * a real change marks the payload `compressed` with the hit rules and the
 * before/after character counts, so the model can audit what was elided.
 */
function compressResultPayload(result: unknown, compress: (text: string) => CompressionOutcome): unknown {
    if (!isRecord(result) || !Array.isArray(result.content)) {
        return result;
    }

    let changed = false;
    const rules = new Set<string>();
    let totalInputChars = 0;
    let totalOutputChars = 0;
    const items: unknown[] = result.content;
    const content = items.map(item => {
        if (!isRecord(item) || item.type !== 'text' || typeof item.text !== 'string') {
            return item;
        }
        const outcome = compress(item.text);
        if (outcome.text === item.text) {
            return item;
        }
        changed = true;
        for (const rule of outcome.appliedRules) {
            rules.add(rule);
        }
        totalInputChars += outcome.inputChars;
        totalOutputChars += outcome.outputChars;
        return { ...item, text: outcome.text };
    });

    if (!changed) {
        return result;
    }
    return {
        ...result,
        content,
        compressed: true,
        compression: {
            rules: [...rules],
            inputChars: totalInputChars,
            outputChars: totalOutputChars
        }
    };
}
