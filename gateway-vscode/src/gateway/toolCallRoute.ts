import type express from 'express';
import type { Response } from 'express';
import { type ToolExecutionTransportPayload } from '@webcode/shared';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import {
    formatToolArgumentValidationError,
    validateToolArguments
} from '../schemaValidation';
import type {
    LocalTool,
    ToolDefinition,
    ToolExecutionContext
} from '../tools';
import { getErrorMessage } from './errorUtils';
import { resolveLocalPathArguments } from './pathArguments';
import type { GatewayErrorLogger, GatewayLogger, RemoteToolRoute } from './types';
import type { GatewayRuntimeTraceSink } from './runtimeTrace';
import type { CommandApprovalManager } from './commandApproval';
import type { ApprovalAuditSink } from './approvalAudit';
import { auditEvent } from './approvalAuditEvents';
import { DEFAULT_MCP_TOOL_TIMEOUT_MS } from './serverConnector';
import { DEFAULT_TOOL_CALL_MS } from './timeouts';
import {
    formatToolCallTimeoutMessage,
    runWithDeadline,
    ToolCallTimeoutError,
    type ToolCallScope
} from './toolCallDeadline';

export type ToolCallHandlerOptions = {
    audit?: ApprovalAuditSink;
    commandApprovalManager: CommandApprovalManager;
    createToolExecutionContext: () => ToolExecutionContext;
    error: GatewayErrorLogger;
    getToolCallTimeoutMs?: () => number;
    getToolDefinition: (name: string) => ToolDefinition | null;
    getWorkspaceRoot: () => string | null;
    localTools: Map<string, LocalTool>;
    log: GatewayLogger;
    /** Reports a tool call that is now executing (used by the shutdown snapshot). */
    onToolCallStart?: (info: { callId: string; toolName: string; args: Record<string, unknown> }) => void;
    /** Reports that a previously started call finished or was abandoned. */
    onToolCallEnd?: (callId: string) => void;
    trace?: GatewayRuntimeTraceSink;
    toolRouter: Map<string, RemoteToolRoute>;
};

type ParsedToolCallRequest = {
    approvalToken?: string;
    args: Record<string, unknown>;
    name: string;
    internalCallId?: string;
};

const TRACE_EVIDENCE_ARGUMENTS = new Set(['path', 'customerId']);

export function createToolCallHandler(options: ToolCallHandlerOptions): express.RequestHandler {
    return async (req, res) => {
        const toolStart = Date.now();
        const parsed = parseToolCallRequest(req.body, res, options);

        if (!parsed) {
            return;
        }

        options.trace?.({
            event: 'tool_call_received',
            requestId: parsed.internalCallId,
            toolName: parsed.name,
            status: 'started'
        });

        const callId = parsed.internalCallId ?? `call-${toolStart}`;
        options.onToolCallStart?.({ callId, toolName: parsed.name, args: parsed.args });
        // `res.once` is absent on the minimal fake responses used by the route
        // unit tests; the hook is optional there, so only wire it on a real one.
        if (options.onToolCallEnd && typeof res.once === 'function') {
            res.once('close', () => options.onToolCallEnd?.(callId));
        }

        const localTool = options.localTools.get(parsed.name);
        if (localTool) {
            return executeLocalTool(localTool, parsed, toolStart, res, options);
        }

        const route = options.toolRouter.get(parsed.name);
        if (!route) {
            return sendToolError(
                res,
                404,
                `Tool '${parsed.name}' not found. Third-party MCP tools must be called as 'server:tool'.`
            );
        }

        try {
            resolveLocalPathArguments(route, parsed.args, options.getWorkspaceRoot());
        } catch (error: unknown) {
            const errorText = getErrorMessage(error);
            options.log(`   ⛔ Rejected unsafe local path arguments for ${parsed.name}: ${errorText}`);
            return sendToolError(res, 400, errorText);
        }

        return executeRemoteTool(route, parsed, toolStart, res, options);
    };
}

export function createToolPreflightHandler(options: ToolCallHandlerOptions): express.RequestHandler {
    return async (req, res) => {
        const parsed = parseToolCallRequest(req.body, res, options);
        if (!parsed) {
            return;
        }

        const localTool = options.localTools.get(parsed.name);
        if (!localTool?.assessRisk) {
            return res.json({ risk: { level: 'allowed', reasons: [] } });
        }

        try {
            const context = options.createToolExecutionContext();
            const preflight = await localTool.assessRisk(parsed.args, context);
            const { level, reasons } = preflight.assessment;
            options.audit?.(auditEvent('preflight_assessed', parsed, { level, reasons }));
            if (level !== 'requires_confirmation') {
                return res.json({ risk: preflight.assessment });
            }

            const challenge = options.commandApprovalManager.issueChallenge(preflight.fingerprint);
            options.audit?.(auditEvent('challenge_issued', parsed, { level, challengeId: challenge.challengeId }));
            return res.json({
                risk: preflight.assessment,
                challenge: {
                    id: challenge.challengeId,
                    expires_at: challenge.expiresAt
                }
            });
        } catch (error: unknown) {
            return sendToolError(res, 400, getErrorMessage(error));
        }
    };
}

export function createToolApprovalHandler(
    commandApprovalManager: CommandApprovalManager,
    audit?: ApprovalAuditSink
): express.RequestHandler {
    return (req, res) => {
        const challengeId = isRecord(req.body) && typeof req.body.challenge_id === 'string'
            ? req.body.challenge_id.trim()
            : '';
        if (!challengeId) {
            return sendToolError(res, 400, 'Invalid command approval request: challenge_id is required.');
        }

        const grant = commandApprovalManager.approveChallenge(challengeId);
        if (!grant) {
            audit?.(auditEvent('grant_rejected', null, { challengeId }));
            return sendToolError(res, 410, 'Command approval challenge is invalid or expired.');
        }

        audit?.(auditEvent('grant_issued', null, { challengeId }));

        return res.json({
            approval_token: grant.approvalToken,
            expires_at: grant.expiresAt
        });
    };
}

function parseToolCallRequest(
    body: unknown,
    res: Response,
    options: ToolCallHandlerOptions
): ParsedToolCallRequest | null {
    const payload = body as (Partial<ToolExecutionTransportPayload> & { approval_token?: unknown }) | null;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        sendToolError(res, 400, 'Invalid tool call request: request body must be a JSON object.');
        return null;
    }

    if (typeof payload.name !== 'string' || payload.name.trim() === '') {
        sendToolError(res, 400, 'Invalid tool call request: "name" must be a non-empty string.');
        return null;
    }

    const name = payload.name;
    const rawArgs = payload.arguments ?? {};
    const toolDefinition = options.getToolDefinition(name);

    if (!toolDefinition) {
        sendToolError(res, 404, `Tool '${name}' not found.`);
        return null;
    }

    const argumentErrors = validateToolArguments(rawArgs, toolDefinition.inputSchema);
    if (argumentErrors.length > 0) {
        const errorText = formatToolArgumentValidationError(name, toolDefinition.inputSchema, argumentErrors);
        options.log(`   ⛔ Rejected invalid arguments for ${name}: ${argumentErrors.join(' ')}`);
        sendToolError(res, 400, errorText);
        return null;
    }

    const internalCallId = readOptionalString(payload.internal_call_id);
    const approvalToken = readOptionalString(payload.approval_token);
    return { approvalToken, args: rawArgs, internalCallId, name };
}

async function executeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        const context = options.createToolExecutionContext();
        const authorized = await authorizeLocalTool(localTool, request, context, res, options);
        if (!authorized) {
            return;
        }

        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 80);
        options.log(`   🚀 Executing local tool: ${request.name} ${argsPreview}`);
        options.trace?.({
            event: 'tool_call_started',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'started',
            details: createTraceArgumentDetails(request.args)
        });
        const result = await runWithDeadline(
            resolveToolCallDeadlineMs(options),
            () => localTool.execute(request.args, context)
        );
        const toolDuration = Date.now() - toolStart;
        options.audit?.(auditEvent('execution_finished', request, { status: 'success', durationMs: toolDuration }));
        options.log(`   ✅ Finished local tool: ${request.name} (${toolDuration}ms)`);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'success',
            durationMs: toolDuration
        });
        return res.json(result);
    } catch (error: unknown) {
        if (error instanceof ToolCallTimeoutError) {
            options.audit?.(auditEvent('execution_finished', request, { status: 'error', error: 'timeout' }));
            return sendToolTimeout(res, request, error.deadlineMs, { scope: 'local', toolStart }, options);
        }

        options.audit?.(auditEvent('execution_finished', request, {
            status: 'error',
            error: getErrorMessage(error)
        }));
        options.error(`Local tool execution failed: ${request.name}`, error);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            details: { error: getErrorMessage(error) }
        });
        return sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
    }
}

async function executeRemoteTool(
    route: RemoteToolRoute,
    request: ParsedToolCallRequest,
    toolStart: number,
    res: Response,
    options: ToolCallHandlerOptions
) {
    try {
        const argsPreview = JSON.stringify(request.args ?? {}).slice(0, 50) + '...';
        options.log(`   🚀 Executing MCP tool: ${request.name} ${argsPreview}`);
        options.trace?.({
            event: 'tool_call_started',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'started',
            details: createTraceArgumentDetails(request.args)
        });
        const result = await runWithDeadline(
            resolveToolCallDeadlineMs(options),
            () => route.client.callTool(
                { name: route.toolName, arguments: request.args ?? {} },
                undefined,
                { timeout: route.toolTimeoutMs }
            )
        );
        const toolDuration = Date.now() - toolStart;
        options.log(`   ✅ Finished: ${request.name} (${toolDuration}ms)`);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'success',
            durationMs: toolDuration
        });
        return res.json(result);
    } catch (error: unknown) {
        if (error instanceof ToolCallTimeoutError) {
            return sendToolTimeout(res, request, error.deadlineMs, { scope: 'mcp', toolStart }, options);
        }
        if (isMcpRequestTimeout(error)) {
            // The MCP SDK enforces its own tools/call deadline; report it with the
            // same wording as the gateway deadline instead of a raw SDK error.
            return sendToolTimeout(
                res,
                request,
                route.toolTimeoutMs ?? DEFAULT_MCP_TOOL_TIMEOUT_MS,
                { scope: 'mcp-request', toolStart },
                options
            );
        }

        options.error(`Tool execution failed: ${request.name}`, error);
        options.trace?.({
            event: 'tool_call_finished',
            requestId: request.internalCallId,
            toolName: request.name,
            status: 'error',
            durationMs: Date.now() - toolStart,
            details: { error: getErrorMessage(error) }
        });
        return sendToolError(res, 500, `Error: ${getErrorMessage(error)}`);
    }
}

function sendToolError(res: Response, status: number, text: string) {
    return res.status(status).json({
        isError: true,
        content: [{ type: 'text', text }]
    });
}

function resolveToolCallDeadlineMs(options: ToolCallHandlerOptions): number {
    return options.getToolCallTimeoutMs?.() ?? DEFAULT_TOOL_CALL_MS;
}

function sendToolTimeout(
    res: Response,
    request: ParsedToolCallRequest,
    deadlineMs: number,
    timing: { scope: ToolCallScope; toolStart: number },
    options: ToolCallHandlerOptions
) {
    const message = formatToolCallTimeoutMessage(request.name, deadlineMs, timing.scope);
    options.log(`   ⏱️ ${message}`);
    options.trace?.({
        event: 'tool_call_finished',
        requestId: request.internalCallId,
        toolName: request.name,
        status: 'error',
        durationMs: Date.now() - timing.toolStart,
        details: { error: message, timedOut: true }
    });
    return sendToolError(res, 504, message);
}

function isMcpRequestTimeout(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && (error as { code?: unknown }).code === ErrorCode.RequestTimeout;
}

function createTraceArgumentDetails(args: Record<string, unknown>): Record<string, unknown> {
    const evidenceArguments = Object.fromEntries(
        Object.entries(args).filter(([key, value]) => (
            TRACE_EVIDENCE_ARGUMENTS.has(key)
            && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
        ))
    );
    return {
        argumentKeys: Object.keys(args).sort(),
        arguments: evidenceArguments
    };
}

async function authorizeLocalTool(
    localTool: LocalTool,
    request: ParsedToolCallRequest,
    context: ToolExecutionContext,
    res: Response,
    options: ToolCallHandlerOptions
): Promise<boolean> {
    if (!localTool.assessRisk) {
        return true;
    }

    const preflight = await localTool.assessRisk(request.args, context);
    if (preflight.assessment.level === 'blocked') {
        options.audit?.(auditEvent('blocked', request, {
            level: 'blocked',
            reasons: preflight.assessment.reasons
        }));
        sendToolError(res, 400, `Security Error: ${preflight.assessment.reasons.join(' ')}`);
        return false;
    }
    if (preflight.assessment.level !== 'requires_confirmation') {
        return true;
    }

    const approved = options.commandApprovalManager.consumeGrant(
        request.approvalToken,
        preflight.fingerprint
    );
    if (!approved) {
        options.audit?.(auditEvent('approval_required', request, {
            level: 'requires_confirmation',
            reasons: preflight.assessment.reasons
        }));
        res.status(409).json({
            isError: true,
            commandRisk: preflight.assessment,
            content: [{
                type: 'text',
                text: `Approval Required: ${preflight.assessment.reasons.join(' ')}`
            }]
        });
        return false;
    }

    context.approvedCommandFingerprint = preflight.fingerprint;
    return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    return value.trim() || undefined;
}
