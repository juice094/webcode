/**
 * Default bound for concurrent tool calls. The bridge rarely issues more than
 * one at a time, but a client retrying after a timeout used to stack real work
 * behind abandoned responses. The queue is FIFO, so ordering is preserved.
 */
export const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 4;

/**
 * Bounds how many tool calls execute at once.
 *
 * The gateway currently has no backpressure: every request starts a tool, so a
 * client retrying after a 504 stacks real work behind abandoned responses. The
 * gate adds a FIFO wait queue so the N+1-th request parks until a slot frees.
 *
 * A `maxConcurrent <= 0` value disables the gate and runs every task inline, so
 * configuration can opt out without a separate code path.
 */
export class ToolConcurrencyGate {
    private active = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(private readonly maxConcurrent: number) { }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.maxConcurrent <= 0) {
            return task();
        }

        if (this.active >= this.maxConcurrent) {
            await new Promise<void>(resolve => this.waiters.push(resolve));
        }

        this.active += 1;
        try {
            return await task();
        } finally {
            this.active -= 1;
            this.waiters.shift()?.();
        }
    }

    /** Number of callers parked waiting for a slot; exposed for tests and metrics. */
    get pending(): number {
        return this.waiters.length;
    }

    /** Number of tasks currently holding a slot; exposed for tests and metrics. */
    get running(): number {
        return this.active;
    }
}
