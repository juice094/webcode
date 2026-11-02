import type { GatewayLogger } from './types';
import { formatIdleTimeoutMinutes } from './idleTimeout';

/** QA-calibrated: one long MCP call spanning 4 idle periods; re-verify once Phase 1 config lands. */
export const MAX_WATCHDOG_POSTPONEMENTS = 3;

export interface GatewayWatchdogDeps {
    /** Current idle window; read on every reset so config reloads apply. */
    idleTimeoutMs: () => number;
    /** Requests in flight right now; a busy gateway earns bounded postponements. */
    inFlightCount: () => number;
    /** Fired when the idle window expires for good (the manager stops itself). */
    onIdle: (idleTimeoutMs: number) => void;
    log: GatewayLogger;
}

/**
 * Idle-shutdown watchdog, kept out of GatewayManager so the manager file
 * stays inside the repository's line budget. `reset()` starts a fresh idle
 * window (including a fresh postponement budget); while requests are in
 * flight the shutdown is postponed a calibrated number of times, then forced.
 */
export class GatewayWatchdog {
    private timer: NodeJS.Timeout | null = null;
    private postponements = 0;

    constructor(private readonly deps: GatewayWatchdogDeps) { }

    reset(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        // Genuine activity starts a fresh idle window, including the budget
        // of in-flight postponements.
        this.postponements = 0;
        this.timer = setTimeout(() => this.fired(), this.deps.idleTimeoutMs());
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.postponements = 0;
    }

    /** How many in-flight postponements the current idle window has used. */
    get postponementCount(): number {
        return this.postponements;
    }

    private fired(): void {
        const idleTimeoutMs = this.deps.idleTimeoutMs();
        if (this.deps.inFlightCount() > 0 && this.postponements < MAX_WATCHDOG_POSTPONEMENTS) {
            this.postponements += 1;
            this.deps.log(`⏳ ${this.deps.inFlightCount()} request(s) still in flight. Postponing idle shutdown (${this.postponements}/${MAX_WATCHDOG_POSTPONEMENTS}).`);
            this.timer = setTimeout(() => this.fired(), idleTimeoutMs);
            return;
        }

        if (this.deps.inFlightCount() > 0) {
            this.deps.log(`⚠️ Forcing idle shutdown with ${this.deps.inFlightCount()} request(s) still in flight after ${MAX_WATCHDOG_POSTPONEMENTS} postponements.`);
        }
        this.deps.log(`💤 No activity for ${formatIdleTimeoutMinutes(idleTimeoutMs)} minutes. Shutting down...`);
        this.deps.onIdle(idleTimeoutMs);
    }
}
