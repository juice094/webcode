/**
 * Sliding-window rate limiter for the pairing endpoint.
 *
 * Keyed by caller identity (origin + client address). Each allowed request
 * records a timestamp; a request over the limit reports how long the caller has
 * to wait until the oldest hit leaves the window, which becomes Retry-After.
 *
 * Memory is bounded two ways: the window is compacted in place instead of
 * filtering into a new array on every call, and a periodic sweep drops keys
 * whose hits have all expired. Without the sweep a client that rotates its
 * origin would leave one empty entry per request forever.
 */
export type RateLimitDecision =
    | { allowed: true }
    | { allowed: false; retryAfterMs: number };

const SWEEP_INTERVAL_CALLS = 1024;

export class SlidingWindowRateLimiter {
    private readonly hits = new Map<string, number[]>();
    private sweepCounter = 0;

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
        private readonly now: () => number = Date.now,
        /** Sweep cadence in calls; injectable so tests can trigger it precisely. */
        private readonly sweepIntervalCalls: number = SWEEP_INTERVAL_CALLS
    ) { }

    consume(key: string): RateLimitDecision {
        const now = this.now();
        this.sweepExpiredKeys(now);

        const windowStart = now - this.windowMs;
        const existing = this.hits.get(key);

        if (!existing) {
            this.hits.set(key, [now]);
            return { allowed: true };
        }

        // Timestamps are appended in order, so the expired ones form a prefix.
        // Drop them in place instead of filtering into a new array.
        let firstValid = 0;
        while (firstValid < existing.length && existing[firstValid] <= windowStart) {
            firstValid += 1;
        }
        if (firstValid > 0) {
            existing.splice(0, firstValid);
        }

        if (existing.length >= this.limit) {
            const oldest = existing[0] ?? now;
            return { allowed: false, retryAfterMs: Math.max(1, oldest + this.windowMs - now) };
        }

        existing.push(now);
        return { allowed: true };
    }

    /** Test seam: drops all recorded hits. */
    reset(): void {
        this.hits.clear();
        this.sweepCounter = 0;
    }

    /** Number of tracked keys; exposed so tests can assert the sweep bounded memory. */
    get trackedKeys(): number {
        return this.hits.size;
    }

    private sweepExpiredKeys(now: number): void {
        this.sweepCounter += 1;
        if (this.sweepIntervalCalls <= 0 || this.sweepCounter % this.sweepIntervalCalls !== 0) {
            return;
        }

        const windowStart = now - this.windowMs;
        for (const [key, timestamps] of this.hits) {
            const last = timestamps[timestamps.length - 1];
            if (last === undefined || last <= windowStart) {
                this.hits.delete(key);
            }
        }
    }
}
