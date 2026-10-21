import {
    writeShutdownSnapshot,
    type InFlightToolCall,
    type ShutdownSnapshot
} from './shutdownSnapshot';

/**
 * Everything `deactivate()` needs, narrowed so the teardown can be unit-tested
 * without an extension host.
 */
export interface DeactivateManager {
    getInFlightToolCalls(): InFlightToolCall[];
    hasActiveBridgeSession(): boolean;
    markShuttingDown(): void;
    stop(options: { fast: boolean; preserveBridgeSession: boolean }): Promise<void>;
}

export interface DeactivateLogger {
    info(message: string): void;
    error(message: string, error?: unknown): void;
}

export type DeactivateSession = {
    manager: DeactivateManager;
    logger: DeactivateLogger;
    snapshotPath: string;
    workspaceId: string;
    workspaceName: string | null;
};

export type DeactivateOutcome = {
    durationMs: number;
    inFlight: number;
    snapshotWritten: boolean;
};

/**
 * Window close / reload teardown, in a fixed order:
 * 1. stop accepting new work (503 on every route);
 * 2. synchronously write what was in flight (notification only, never replayed);
 * 3. stop the gateway while preserving the browser session token, skipping the
 *    MCP shutdown handshake so the whole path stays inside the host budget.
 */
export async function runDeactivate(
    session: DeactivateSession,
    now: () => number = Date.now
): Promise<DeactivateOutcome> {
    const startedAt = now();
    session.manager.markShuttingDown();
    const inFlight = session.manager.getInFlightToolCalls();
    const snapshot: ShutdownSnapshot = {
        schemaVersion: 1,
        savedAt: new Date(startedAt).toISOString(),
        reason: 'deactivate',
        workspaceId: session.workspaceId,
        workspaceName: session.workspaceName,
        sessionWasActive: session.manager.hasActiveBridgeSession(),
        inFlight
    };
    const snapshotWritten = writeShutdownSnapshot(session.snapshotPath, snapshot);

    try {
        await session.manager.stop({ preserveBridgeSession: true, fast: true });
    } catch (error: unknown) {
        session.logger.error('deactivate: gateway stop failed', error);
    }

    const durationMs = now() - startedAt;
    session.logger.info(
        `deactivate: drained in ${durationMs}ms, inFlight=${inFlight.length}, ` +
        `snapshot=${snapshotWritten ? session.snapshotPath : 'not-written'}`
    );
    return { durationMs, inFlight: inFlight.length, snapshotWritten };
}
