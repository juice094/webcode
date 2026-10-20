/**
 * Enforces the gateway-side tool call deadline.
 *
 * The deadline is a watchdog, not a cancellation: local tools and MCP servers
 * expose no abort signal, so a timed-out call keeps running in the background
 * while the gateway reports the timeout to the caller. Callers must not claim
 * the work was stopped.
 */

export class ToolCallTimeoutError extends Error {
    constructor(readonly deadlineMs: number) {
        super(`Tool call timed out after ${deadlineMs} ms.`);
        this.name = 'ToolCallTimeoutError';
    }
}

/**
 * Runs `work` under a deadline. A deadline of 0 or less disables the watchdog
 * and returns the work promise untouched, so no timer is installed at all.
 */
export function runWithDeadline<T>(deadlineMs: number, work: () => Promise<T>): Promise<T> {
    if (deadlineMs <= 0) {
        return work();
    }

    return raceWithDeadline(deadlineMs, work());
}

async function raceWithDeadline<T>(deadlineMs: number, work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ToolCallTimeoutError(deadlineMs)), deadlineMs);
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
 * Builds the caller-facing timeout text. The wording states who enforces the
 * deadline and what is left running, because the tool itself is not cancelled.
 */
export function formatToolCallTimeoutMessage(toolName: string, deadlineMs: number, scope: ToolCallScope): string {
    const leftover = scope === 'local'
        ? 'a local process started by the tool may still be running'
        : 'the MCP server may still be processing the request';
    const deadlineOwner = scope === 'mcp-request' ? 'The MCP request deadline' : 'The gateway deadline';

    return `Tool '${toolName}' timed out after ${deadlineMs} ms. ${deadlineOwner} is not a cancellation: ${leftover}.`;
}
