/**
 * Sliding-window rate limiter for the pairing endpoint.
 *
 * Keyed by caller identity (origin + client address). Each allowed request
 * records a timestamp; a request over the limit reports how long the caller has
 * to wait until the oldest hit leaves the window, which becomes Retry-After.
 * Memory stays bounded because entries are pruned on every call and empty keys
 * are dropped.
 */
export type RateLimitDecision =
    | { allowed: true }
    | { allowed: false; retryAfterMs: number };

export class SlidingWindowRateLimiter {
    private readonly hits = new Map<string, number[]>();

    constructor(
        private readonly limit: number,
        private readonly windowMs: number,
        private readonly now: () => number = Date.now
    ) { }

    consume(key: string): RateLimitDecision {
        const now = this.now();
        const windowStart = now - this.windowMs;
        const recent = (this.hits.get(key) ?? []).filter(timestamp => timestamp > windowStart);

        if (recent.length >= this.limit) {
            this.hits.set(key, recent);
            const oldest = recent[0] ?? now;
            return { allowed: false, retryAfterMs: Math.max(1, oldest + this.windowMs - now) };
        }

        recent.push(now);
        this.hits.set(key, recent);
        return { allowed: true };
    }

    /** Test seam: drops all recorded hits. */
    reset(): void {
        this.hits.clear();
    }
}
