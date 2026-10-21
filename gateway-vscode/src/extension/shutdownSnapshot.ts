import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * What was in flight when the extension host went away.
 *
 * The snapshot is written synchronously from `deactivate()` inside a hard
 * ~300 ms budget, so every operation here is best-effort and silent on failure.
 * It is a notification artifact only: nothing in this file allows replaying a
 * tool call, and arguments are stored as a digest plus a short redacted preview.
 */
export const SHUTDOWN_SNAPSHOT_SCHEMA_VERSION = 1;
export const SHUTDOWN_SNAPSHOT_MAX_BYTES = 16 * 1024;
export const SHUTDOWN_SNAPSHOT_TTL_MS = 10 * 60 * 1000;
export const ARGS_PREVIEW_MAX_CHARS = 120;

const SENSITIVE_KEY_PATTERN = /token|password|passwd|secret|api[-_]?key|credential|authorization/i;
const PREVIEW_REDACTION = '[redacted]';

export interface InFlightToolCall {
    callId: string;
    serverId?: string;
    toolName: string;
    startedAt: string;
    elapsedMs: number;
    argsDigest: string;
    argsPreview?: string;
}

export interface ShutdownSnapshot {
    schemaVersion: number;
    savedAt: string;
    reason: 'deactivate';
    workspaceId: string | null;
    workspaceName: string | null;
    sessionWasActive: boolean;
    inFlight: InFlightToolCall[];
}

export function shutdownSnapshotPath(stateDir: string, workspaceId: string | null): string {
    return path.join(stateDir, `shutdown-${workspaceId ?? 'global'}.json`);
}

/** Stable digest so the same arguments can be recognized without storing them. */
export function digestToolArguments(args: unknown): string {
    return crypto.createHash('sha256').update(safeStringify(args)).digest('hex');
}

/**
 * Short, redacted, single-line rendering of tool arguments. Anything that looks
 * like a credential is replaced wholesale, and the result is capped so a large
 * payload cannot dominate the snapshot.
 */
export function buildArgsPreview(args: unknown, maxChars = ARGS_PREVIEW_MAX_CHARS): string | undefined {
    const rendered = safeStringify(redact(args, 0));
    if (!rendered || rendered === 'undefined' || rendered === '{}') {
        return undefined;
    }

    const singleLine = rendered.replace(/\s+/g, ' ').trim();
    return singleLine.length <= maxChars ? singleLine : `${singleLine.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function writeShutdownSnapshot(filePath: string, snapshot: ShutdownSnapshot): boolean {
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const payload = `${JSON.stringify(trimToBudget(snapshot), null, 2)}\n`;
        fs.writeFileSync(filePath, payload, 'utf8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads a snapshot written by a previous session. Stale snapshots (>10 min) are
 * reported as absent: the browser has long since reconnected or given up, and a
 * "last interrupted" banner from an hour ago is noise.
 */
export function readShutdownSnapshot(filePath: string, now: number = Date.now()): ShutdownSnapshot | null {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ShutdownSnapshot>;
        if (parsed.schemaVersion !== SHUTDOWN_SNAPSHOT_SCHEMA_VERSION || typeof parsed.savedAt !== 'string') {
            return null;
        }
        const savedAtMs = Date.parse(parsed.savedAt);
        if (!Number.isFinite(savedAtMs) || now - savedAtMs > SHUTDOWN_SNAPSHOT_TTL_MS) {
            return null;
        }
        return {
            schemaVersion: SHUTDOWN_SNAPSHOT_SCHEMA_VERSION,
            savedAt: parsed.savedAt,
            reason: 'deactivate',
            workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
            workspaceName: typeof parsed.workspaceName === 'string' ? parsed.workspaceName : null,
            sessionWasActive: parsed.sessionWasActive === true,
            inFlight: Array.isArray(parsed.inFlight) ? parsed.inFlight.filter(isInFlightToolCall) : []
        };
    } catch {
        return null;
    }
}

function isInFlightToolCall(value: unknown): value is InFlightToolCall {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value as Record<string, unknown>;
    return typeof record.callId === 'string' &&
        typeof record.toolName === 'string' &&
        typeof record.startedAt === 'string' &&
        typeof record.argsDigest === 'string';
}

function trimToBudget(snapshot: ShutdownSnapshot): ShutdownSnapshot {
    const inFlight = [...snapshot.inFlight];
    let candidate: ShutdownSnapshot = { ...snapshot, inFlight };
    while (inFlight.length > 0 && Buffer.byteLength(JSON.stringify(candidate, null, 2), 'utf8') > SHUTDOWN_SNAPSHOT_MAX_BYTES) {
        inFlight.pop();
        candidate = { ...snapshot, inFlight };
    }
    return candidate;
}

function redact(value: unknown, depth: number): unknown {
    if (depth > 4) {
        return '[depth-limit]';
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map(item => redact(item, depth + 1));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        redacted[key] = SENSITIVE_KEY_PATTERN.test(key) ? PREVIEW_REDACTION : redact(entry, depth + 1);
    }
    return redacted;
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? 'undefined';
    } catch {
        return '"<unserializable>"';
    }
}
