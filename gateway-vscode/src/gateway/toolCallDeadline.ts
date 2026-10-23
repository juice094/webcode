/**
 * Enforces the gateway-side tool call deadline.
 *
 * Batch C flipped the deadline from a watchdog into a real cancellation: when
 * the deadline fires, `onTimeout` aborts the controller whose signal the tool
 * received, so the tool is expected to stop its own child processes and file
 * handles. The timeout wording reflects that, and callers must not claim the
 * work was merely abandoned.
 *
 * A deadline of 0 or less installs no timer, but the work still receives the
 * caller's signal so a client disconnect can abort it.
 */

export class ToolCallTimeoutError extends Error {
    constructor(readonly deadlineMs: number) {
        super(`Tool call timed out after ${deadlineMs} ms.`);
        this.name = 'ToolCallTimeoutError';
    }
}

/** Shared, never-aborted signal used when a caller deliberately passes none. */
export const NEVER_ABORT_SIGNAL: AbortSignal = new AbortController().signal;

export type DeadlineWork<T> = (signal: AbortSignal) => Promise<T>;

export type DeadlineOptions = {
    /** Receives the timeout error so the caller can abort its own controller. */
    onTimeout?: (error: ToolCallTimeoutError) => void;
    signal?: AbortSignal;
};

/**
 * Runs `work` under a deadline.
 *
 * `signal` is forwarded to `work`. When the deadline fires, `onTimeout` is
 * invoked before the promise rejects, which is how the caller aborts the tool.
 * A disabled deadline returns the work promise untouched, so callers that wrap
 * an already-settled promise still get that exact object back.
 */
export function runWithDeadline<T>(
    deadlineMs: number,
    work: DeadlineWork<T>,
    options: DeadlineOptions = {}
): Promise<T> {
    const signal = options.signal ?? NEVER_ABORT_SIGNAL;
    if (deadlineMs <= 0) {
        return work(signal);
    }

    return raceWithDeadline(deadlineMs, work(signal), options.onTimeout);
}

async function raceWithDeadline<T>(
    deadlineMs: number,
    work: Promise<T>,
    onTimeout: ((error: ToolCallTimeoutError) => void) | undefined
): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            const error = new ToolCallTimeoutError(deadlineMs);
            try {
                onTimeout?.(error);
            } catch {
                // An abort hook that throws must not mask the timeout.
            }
            reject(error);
        }, deadlineMs);
    });

    try {
        return await Promise.race([work, deadline]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export type ToolCallScope = 'local' | 'mcp' | 'mcp-request';

/**
 * Builds the caller-facing timeout text. The wording states who enforced the
 * deadline and what was signalled, because the tool is now actively aborted.
 */
export function formatToolCallTimeoutMessage(toolName: string, deadlineMs: number, scope: ToolCallScope): string {
    const leftover = scope === 'local'
        ? 'the local process tree was signalled to terminate'
        : 'an abort request was sent to the MCP server';
    const deadlineOwner = scope === 'mcp-request' ? 'The MCP request deadline' : 'The gateway deadline';

    return `Tool '${toolName}' timed out after ${deadlineMs} ms. ${deadlineOwner} aborted the call: ${leftover}.`;
}
