import type express from 'express';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { type ToolExecutionTransportPayload } from '@webcode/shared';

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
import type { ToolConcurrencyGate } from './toolConcurrency';
import {
    executeWithTelemetry,
    sendToolError,
    type ParsedToolCallRequest,
    type ToolExecutionDeps
} from './toolCallExecution';

export type ToolCallHandlerOptions = {
    audit?: ApprovalAuditSink;
    /** Bounds how many calls execute at once; omitted means unbounded (tests). */
    concurrencyGate?: ToolConcurrencyGate;
    commandApprovalManager: CommandApprovalManager;
    createToolExecutionContext: () => ToolExecutionContext;
    error: GatewayErrorLogger;
    getToolCallTimeoutMs?: () => number;
    getToolDefinition: (name: string) => ToolDefinition | null;
    getWorkspaceRoot: () => string | null;
    localTools: Map<string, LocalTool>;
    log: GatewayLogger;
    /** Reports a tool call that is now executing (used by the shutdown snapshot). */
    onToolCallStart?: (info: {
        callId: string;
        toolName: string;
        args: Record<string, unknown>;
        controller: AbortController;
    }) => void;
    /** Reports that a previously started call finished or was abandoned. */
    onToolCallEnd?: (callId: string) => void;
    trace?: GatewayRuntimeTraceSink;
    toolRouter: Map<string, RemoteToolRoute>;
};

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

        // A per-call id prevents two calls in the same millisecond from sharing
        // an in-flight snapshot key.
        const callId = parsed.internalCallId ?? randomUUID();
        const controller = new AbortController();
        options.onToolCallStart?.({ callId, toolName: parsed.name, args: parsed.args, controller });

        // A disconnected client can no longer receive a result, so the work must
        // stop instead of running to completion for nobody. The unit tests use a
        // minimal fake response without `once`, hence the capability check.
        if (typeof res.once === 'function') {
            res.once('close', () => controller.abort(new Error('client disconnected')));
        }

        const deps: ToolExecutionDeps = {
            audit: options.audit,
            error: options.error,
            getToolCallTimeoutMs: options.getToolCallTimeoutMs,
            log: options.log,
            trace: options.trace
        };

        try {
            const localTool = options.localTools.get(parsed.name);
            if (localTool) {
                await executeLocalTool({ controller, deps, localTool, options, request: parsed, res, toolStart });
                return;
            }

            const route = options.toolRouter.get(parsed.name);
            if (!route) {
                sendToolError(
                    res,
                    404,
                    `Tool '${parsed.name}' not found. Third-party MCP tools must be called as 'server:tool'.`
                );
                return;
            }

            try {
                resolveLocalPathArguments(route, parsed.args, options.getWorkspaceRoot());
            } catch (error: unknown) {
                const errorText = getErrorMessage(error);
                options.log(`   ⛔ Rejected unsafe local path arguments for ${parsed.name}: ${errorText}`);
                sendToolError(res, 400, errorText);
                return;
            }

            await runGated(options, controller, () => executeWithTelemetry({
                backend: { kind: 'remote', route },
                contextFactory: options.createToolExecutionContext,
                controller,
                deps,
                request: parsed,
                res,
                toolStart
            }));
        } finally {
            // The single place a tracked call ends. Success, timeout, failure,
            // and disconnect all converge here, so the registry cannot leak.
            options.onToolCallEnd?.(callId);
        }
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

type LocalToolExecutionInput = {
    controller: AbortController;
    deps: ToolExecutionDeps;
    localTool: LocalTool;
    options: ToolCallHandlerOptions;
    request: ParsedToolCallRequest;
    res: Response;
    toolStart: number;
};

async function executeLocalTool(input: LocalToolExecutionInput): Promise<void> {
    const { controller, deps, localTool, options, request, res, toolStart } = input;
    const context = options.createToolExecutionContext();
    const authorized = await authorizeLocalTool(localTool, request, context, res, options);
    if (!authorized) {
        return;
    }

    await runGated(options, controller, () => executeWithTelemetry({
        backend: { kind: 'local', tool: localTool },
        contextFactory: () => context,
        controller,
        deps,
        request,
        res,
        toolStart
    }));
}

function runGated(
    options: ToolCallHandlerOptions,
    controller: AbortController,
    task: () => Promise<void>
): Promise<void> {
    const gate = options.concurrencyGate;
    if (!gate) {
        return task();
    }

    // Waiting for a slot is itself cancellable: a client that disconnects while
    // queued must not hold a place in line.
    return gate.run(async () => {
        if (controller.signal.aborted) {
            return;
        }
        await task();
    });
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
        if (res.headersSent !== true && res.writableEnded !== true && res.destroyed !== true) {
            res.status(409).json({
                isError: true,
                commandRisk: preflight.assessment,
                content: [{
                    type: 'text',
                    text: `Approval Required: ${preflight.assessment.reasons.join(' ')}`
                }]
            });
        }
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
