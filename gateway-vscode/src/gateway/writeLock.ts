import * as crypto from 'node:crypto';

import {
    APPROVAL_AUDIT_VERSION,
    type ApprovalAuditEvent,
    type ApprovalAuditEventName,
    type ApprovalAuditSink
} from './approvalAudit';

/**
 * Cross-browser write lock (design D3).
 *
 * Multiple isolated browser sessions can share one gateway and one workspace,
 * but only one of them may run a MUTATING tool call at a time. Reads
 * (read/search/glob/list/attach/context and every third-party MCP tool for
 * now) never queue here and may observe intermediate state while a write is
 * in flight — accepted by design, documented in plans/webcode-multi-bridge.
 *
 * The lock is per gateway (per workspace): first writer holds it, later
 * writers queue FIFO. A queued writer whose wait exceeds the configured
 * timeout gets a retryable error (HTTP 423 semantics) instead of running;
 * the AI site retries. A client that disconnects while queued is cancelled
 * via the AbortController pattern of toolConcurrency.runGated. Session
 * expiry and the disconnect-browsers command force-release the locks held by
 * the revoked sessions.
 */

/** Local tools that mutate workspace state and therefore serialize per gateway. */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
    'execute_command',
    'run_in_terminal',
    'edit_file',
    'write_file',
    'terminal_session'
]);

export function isWriteLockedTool(name: string): boolean {
    return WRITE_TOOL_NAMES.has(name);
}

/** Client-facing retryable timeout text (bilingual, matching repo conventions). */
export const WRITE_LOCK_TIMEOUT_TEXT =
    '⛔ 另一浏览器正在写入此工作区，请稍后重试。' +
    ' / Another browser is writing to this workspace. Please retry shortly.';

/** Client-facing text when the session is revoked while waiting for the lock. */
export const WRITE_LOCK_REVOKED_TEXT =
    '⛔ 会话已过期，请从浏览器扩展重新连接。' +
    ' / Session expired. Please reconnect from the browser extension.';

/**
 * Short digest of a session token for audit attribution. The token itself is
 * a bearer credential and is never written to the audit log.
 */
export function sessionTokenRef(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export type WriteLockAcquireResult =
    | { status: 'acquired' }
    | { status: 'timeout'; holderRef: string | null; waitMs: number }
    | { status: 'revoked' }
    | { status: 'cancelled' };

type QueuedWaiter = {
    token: string;
    queuedAt: number;
    resolve: (result: WriteLockAcquireResult) => void;
};

export interface WriteLockOptions {
    /** How long a queued writer waits before getting a retryable timeout. */
    timeoutMs: number;
    now?: () => number;
    audit?: ApprovalAuditSink;
}

export class WriteLock {
    private holderToken: string | null = null;
    private readonly waiters: QueuedWaiter[] = [];

    constructor(private readonly options: WriteLockOptions) { }

    /** Retargets the queue wait on a configuration reload. */
    setTimeoutMs(timeoutMs: number): void {
        this.options.timeoutMs = timeoutMs;
    }

    /** Session token currently holding the lock, or null. */
    get holder(): string | null {
        return this.holderToken;
    }

    /** Number of writers parked in the FIFO queue. */
    get pending(): number {
        return this.waiters.length;
    }

    /**
     * Acquires the lock for a session. An idle lock is granted immediately;
     * a held lock parks the caller FIFO until the holder releases, the wait
     * overruns the timeout, the session is force-released, or the caller
     * aborts (client disconnected while queued). A holder re-entering its own
     * lock is granted without queueing.
     */
    acquire(token: string, signal?: AbortSignal): Promise<WriteLockAcquireResult> {
        if (signal?.aborted) {
            return Promise.resolve({ status: 'cancelled' });
        }
        if (!this.holderToken) {
            this.holderToken = token;
            this.emit('write_lock_acquired', token, this.now());
            return Promise.resolve({ status: 'acquired' });
        }
        if (this.holderToken === token) {
            this.emit('write_lock_acquired', token, this.now());
            return Promise.resolve({ status: 'acquired' });
        }

        return new Promise<WriteLockAcquireResult>(resolve => {
            const waiter: QueuedWaiter = { token, queuedAt: this.now(), resolve };
            this.waiters.push(waiter);
            this.emit('write_lock_queued', token, waiter.queuedAt);

            const onAbort = () => {
                this.removeWaiter(waiter);
                waiter.resolve({ status: 'cancelled' });
            };
            signal?.addEventListener('abort', onAbort, { once: true });

            const timeoutMs = Math.max(0, this.options.timeoutMs);
            const timer = setTimeout(() => {
                this.removeWaiter(waiter);
                const settledAt = this.now();
                this.emit('write_lock_timeout', token, settledAt, { waitMs: settledAt - waiter.queuedAt });
                waiter.resolve({
                    status: 'timeout',
                    holderRef: this.holderRef(),
                    waitMs: settledAt - waiter.queuedAt
                });
            }, timeoutMs);
            // The timer only guards the queue wait; it must never keep the
            // process alive on its own.
            timer.unref?.();

            // Wrap the resolve so abort/timeout/timer cleanup happens exactly once.
            const settle = waiter.resolve;
            let settled = false;
            waiter.resolve = result => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                settle(result);
            };
        });
    }

    /**
     * Releases the lock held by `token`. The next queued writer (whose
     * session has not been revoked in the meantime) is granted FIFO.
     */
    release(token: string): void {
        if (this.holderToken !== token) {
            return;
        }
        const releasedAt = this.now();
        this.holderToken = null;
        this.emit('write_lock_released', token, releasedAt);
        this.grantNext();
    }

    /**
     * Force-releases every lock reference held by any of the given tokens.
     * Used when sessions expire or are rotated away by disconnect-browsers:
     * those browsers will never come back to release voluntarily.
     */
    releaseForTokens(tokens: readonly string[]): void {
        const revoked = new Set(tokens);
        if (this.holderToken && revoked.has(this.holderToken)) {
            const token = this.holderToken;
            this.holderToken = null;
            this.emit('write_lock_revoked', token, this.now());
        }
        for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
            const waiter = this.waiters[index];
            if (revoked.has(waiter.token)) {
                this.waiters.splice(index, 1);
                waiter.resolve({ status: 'revoked' });
                this.emit('write_lock_revoked', waiter.token, this.now());
            }
        }
        if (!this.holderToken) {
            this.grantNext();
        }
    }

    private grantNext(): void {
        while (!this.holderToken && this.waiters.length > 0) {
            const waiter = this.waiters.shift();
            if (!waiter) {
                return;
            }
            this.holderToken = waiter.token;
            waiter.resolve({ status: 'acquired' });
            this.emit('write_lock_acquired', waiter.token, this.now(), { waitMs: this.now() - waiter.queuedAt });
        }
    }

    private removeWaiter(target: QueuedWaiter): void {
        const index = this.waiters.indexOf(target);
        if (index >= 0) {
            this.waiters.splice(index, 1);
        }
    }

    private holderRef(): string | null {
        return this.holderToken === null ? null : sessionTokenRef(this.holderToken);
    }

    private now(): number {
        return this.options.now?.() ?? Date.now();
    }

    private emit(event: ApprovalAuditEventName, token: string, at: number, extra: { waitMs?: number } = {}): void {
        this.options.audit?.({
            v: APPROVAL_AUDIT_VERSION,
            ts: new Date(at).toISOString(),
            event,
            toolName: null,
            sessionRef: sessionTokenRef(token),
            queueLength: this.waiters.length,
            ...(extra.waitMs !== undefined ? { waitMs: extra.waitMs } : {})
        } satisfies ApprovalAuditEvent);
    }
}
