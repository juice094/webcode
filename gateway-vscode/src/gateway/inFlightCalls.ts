import { buildArgsPreview, digestToolArguments, type InFlightToolCall } from '../extension/shutdownSnapshot';

/**
 * Tracks the tool calls running right now so `deactivate()` can tell the next
 * session what it interrupted, and so `stop()` can abort work that is still in
 * flight. Kept out of GatewayManager to stay inside the file-size budget, and
 * deliberately dumb: no persistence, no replay, and the arguments are reduced
 * to a digest plus a short redacted preview.
 */
type TrackedCall = InFlightToolCall & {
    startedAtMs: number;
    controller?: AbortController;
};

export class InFlightCallRegistry {
    private readonly calls = new Map<string, TrackedCall>();

    constructor(private readonly resolveServerId: (toolName: string) => string | undefined) { }

    start(info: { callId: string; toolName: string; args: unknown; controller?: AbortController }): void {
        const startedAtMs = Date.now();
        this.calls.set(info.callId, {
            callId: info.callId,
            serverId: this.resolveServerId(info.toolName),
            toolName: info.toolName,
            startedAt: new Date(startedAtMs).toISOString(),
            elapsedMs: 0,
            startedAtMs,
            argsDigest: digestToolArguments(info.args),
            argsPreview: buildArgsPreview(info.args),
            controller: info.controller
        });
    }

    /**
     * The single place a call stops being tracked. Called from the route's
     * `finally`, so a success, a timeout, a failure, and a client disconnect all
     * converge here and the registry cannot leak an entry.
     */
    end(callId: string): void {
        this.calls.delete(callId);
    }

    /** Aborts every tracked call. Used by `stop()` before clearing the map. */
    abortAll(reason: unknown): void {
        for (const call of this.calls.values()) {
            call.controller?.abort(reason);
        }
    }

    snapshot(now = Date.now()): InFlightToolCall[] {
        return Array.from(this.calls.values()).map(call => ({
            callId: call.callId,
            serverId: call.serverId,
            toolName: call.toolName,
            startedAt: call.startedAt,
            elapsedMs: Math.max(0, now - call.startedAtMs),
            argsDigest: call.argsDigest,
            argsPreview: call.argsPreview
        }));
    }

    clear(): void {
        this.calls.clear();
    }
}
