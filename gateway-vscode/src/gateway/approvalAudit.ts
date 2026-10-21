import type { CommandRiskLevel } from '../servers/commandRiskTypes';

/**
 * Machine-readable record of every approval decision the gateway makes. It is
 * deliberately separate from the human log: the log line keeps an 80 character
 * preview, the audit keeps the full command so "what did the AI actually run?"
 * is answerable afterwards.
 *
 * Serialization is a whitelist on purpose. Callers hand in an event object and
 * anything not listed here (an approval token, file contents passed as tool
 * arguments, ...) is dropped instead of reaching the file.
 */

export const APPROVAL_AUDIT_VERSION = 1;
export const MAX_AUDIT_COMMAND_LENGTH = 4096;

export type ApprovalAuditEventName =
    | 'preflight_assessed'
    | 'challenge_issued'
    | 'grant_issued'
    | 'grant_rejected'
    | 'blocked'
    | 'approval_required'
    | 'execution_finished';

export interface ApprovalAuditEvent {
    v: number;
    ts: string;
    event: ApprovalAuditEventName;
    toolName: string | null;
    requestId?: string;
    command?: string;
    commandTruncated?: boolean;
    path?: string;
    profile?: string;
    level?: CommandRiskLevel;
    reasons?: string[];
    challengeId?: string;
    durationMs?: number;
    status?: 'success' | 'error';
    error?: string;
}

export type ApprovalAuditSink = (event: ApprovalAuditEvent) => void;

export function formatApprovalAuditEvent(event: ApprovalAuditEvent): string {
    const record: Record<string, unknown> = {
        v: APPROVAL_AUDIT_VERSION,
        ts: event.ts,
        event: event.event,
        toolName: event.toolName
    };

    const command = truncateCommand(event.command);
    if (command) {
        record.command = command.value;
        if (command.truncated) {
            record.commandTruncated = true;
        }
    }

    copyOptional(record, event, ['requestId', 'path', 'profile', 'level', 'reasons', 'challengeId', 'status', 'error']);
    if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
        record.durationMs = Math.max(0, Math.trunc(event.durationMs));
    }

    return JSON.stringify(record);
}

function copyOptional(
    target: Record<string, unknown>,
    source: ApprovalAuditEvent,
    keys: readonly (keyof ApprovalAuditEvent)[]
): void {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined) {
            target[key] = value;
        }
    }
}

function truncateCommand(command: string | undefined): { value: string; truncated: boolean } | null {
    if (typeof command !== 'string' || command === '') {
        return null;
    }

    return command.length > MAX_AUDIT_COMMAND_LENGTH
        ? { value: command.slice(0, MAX_AUDIT_COMMAND_LENGTH), truncated: true }
        : { value: command, truncated: false };
}
