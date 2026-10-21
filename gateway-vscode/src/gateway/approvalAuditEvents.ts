import type { CommandRiskLevel } from '../servers/commandRiskTypes';
import type { ApprovalAuditEvent, ApprovalAuditEventName } from './approvalAudit';

/**
 * Builds audit events. Kept out of `toolCallRoute` so the route only calls the
 * sink and stays inside its line budget.
 */

export interface AuditedRequest {
    name: string;
    internalCallId?: string;
    args: Record<string, unknown>;
}

export interface AuditDetails {
    level?: CommandRiskLevel;
    reasons?: readonly string[];
    challengeId?: string;
    durationMs?: number;
    status?: 'success' | 'error';
    error?: string;
}

const OPTIONAL_KEYS = [
    'requestId',
    'command',
    'path',
    'profile',
    'level',
    'reasons',
    'challengeId',
    'durationMs',
    'status',
    'error'
] as const satisfies readonly (keyof ApprovalAuditEvent)[];

export function auditEvent(
    eventName: ApprovalAuditEventName,
    request: AuditedRequest | null,
    details: AuditDetails = {}
): ApprovalAuditEvent {
    const values: Partial<ApprovalAuditEvent> = {
        requestId: request ? request.internalCallId : undefined,
        command: readArgument(request, 'command'),
        path: readArgument(request, 'path'),
        profile: readArgument(request, 'profile'),
        level: details.level,
        reasons: details.reasons?.length ? [...details.reasons] : undefined,
        challengeId: details.challengeId,
        durationMs: details.durationMs,
        status: details.status,
        error: details.error
    };

    const event = {
        v: 1,
        ts: new Date().toISOString(),
        event: eventName,
        toolName: request ? request.name : null
    } as ApprovalAuditEvent;

    for (const key of OPTIONAL_KEYS) {
        const value = values[key];
        if (value !== undefined) {
            (event as unknown as Record<string, unknown>)[key] = value;
        }
    }

    return event;
}

function readArgument(request: AuditedRequest | null, key: string): string | undefined {
    const value = request ? request.args[key] : undefined;
    return typeof value === 'string' && value !== '' ? value : undefined;
}
