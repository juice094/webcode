import * as assert from 'node:assert';

import type { BrowserContext, Worker } from 'playwright-core';

import { appendEvalTrace } from '../harness/trace';

/**
 * Seeds and verifies the bridge extension's default approval mode so the approval
 * E2E suites can exercise the challenge/grant path.
 *
 * Everything goes through the extension service worker instead of an extension
 * page: inside the VS Code Extension Host, `page.evaluate` on a chrome-extension://
 * page never settles, while `Worker.evaluate` works. The bridge reads its preset
 * once, when the handshake binds the tab (`background/connection.ts`), so seeding
 * has to run before the bridge page opens.
 */

export type SeedableApprovalMode = 'always-ask' | 'ask-when-needed' | 'never-ask';

export interface ApprovalModeTrace {
    tracePath: string;
    runId: string;
}

const EXTENSION_READY_TIMEOUT_MS = 20_000;
const SEED_DEADLINE_MS = 30_000;
const WORKER_CALL_DEADLINE_MS = 10_000;
const WORKER_POLL_INTERVAL_MS = 250;
const PRESET_STORAGE_KEY = 'sessionPresetSettings';
const SESSION_STORAGE_PREFIX = 'session_';

type ChromeSessionRecord = {
    approvalMode?: unknown;
    port?: unknown;
    siteId?: unknown;
    targetOrigin?: unknown;
    targetUrl?: unknown;
};

// Minimal Chrome surface used from the worker. Declared locally because the eval
// package has no Chrome typings and only the browser side is typed.
interface ExtensionChrome {
    runtime: { lastError?: { message?: string } };
    storage: {
        local: {
            get(keys: null, callback: (items: Record<string, unknown>) => void): void;
            set(items: Record<string, unknown>, callback: () => void): void;
        };
    };
}

declare const chrome: ExtensionChrome;

export async function seedDefaultApprovalMode(
    context: BrowserContext,
    approvalMode: SeedableApprovalMode,
    trace?: ApprovalModeTrace
): Promise<void> {
    record(trace, 'approval_mode_seed_started', 'started', { approvalMode });
    try {
        await withDeadline(
            writePreset(await requireExtensionWorker(context), approvalMode),
            SEED_DEADLINE_MS,
            `seeding the default approval mode to ${approvalMode}`
        );
    } catch (error: unknown) {
        record(trace, 'approval_mode_seed_failed', 'error', { approvalMode, error: describe(error) });
        throw error;
    }
    record(trace, 'approval_mode_seeded', 'success', { approvalMode });
}

async function writePreset(worker: Worker, approvalMode: SeedableApprovalMode): Promise<void> {
    const stored = await worker.evaluate(
        (payload: { storageKey: string; approvalMode: string }) => new Promise<unknown>((resolve, reject) => {
            chrome.storage.local.set({
                [payload.storageKey]: {
                    defaultApprovalMode: payload.approvalMode,
                    defaultAutoApproveTools: payload.approvalMode === 'never-ask'
                }
            }, () => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(new Error(lastError.message ?? 'storage write failed'));
                    return;
                }
                chrome.storage.local.get(null, (items) => resolve(items[payload.storageKey] ?? null));
            });
        }),
        { storageKey: PRESET_STORAGE_KEY, approvalMode }
    );

    assert.strictEqual(
        readString(stored, 'defaultApprovalMode'),
        approvalMode,
        seedFailureHint(approvalMode, `${PRESET_STORAGE_KEY} was not persisted`)
    );
}

export async function assertBridgeApprovalMode(
    context: BrowserContext,
    fixtureUrl: string,
    expectedMode: SeedableApprovalMode,
    trace?: ApprovalModeTrace
): Promise<void> {
    const worker = await requireExtensionWorker(context);
    const stored = await withDeadline(
        readAllStorage(worker),
        WORKER_CALL_DEADLINE_MS,
        'reading the stored bridge sessions'
    );

    const session = findSessionForSite(stored, fixtureUrl);
    assert.ok(
        session,
        `No stored bridge session targets ${fixtureUrl}. The bridge page did not bind; `
        + 'this is a test-harness failure, not a product regression.'
    );
    assert.strictEqual(
        readString(session, 'approvalMode'),
        expectedMode,
        `The bridge session runs in approval mode ${String(session.approvalMode)} instead of ${expectedMode}. `
        + 'The preset was seeded but did not reach the session: this is a seeding failure, not a product regression.'
    );

    record(trace, 'approval_mode_verified', 'success', { approvalMode: expectedMode });
}

async function readAllStorage(worker: Worker): Promise<Record<string, unknown>> {
    return worker.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get(null, (items) => resolve(items));
    }));
}

function findSessionForSite(
    stored: Record<string, unknown>,
    fixtureUrl: string
): ChromeSessionRecord | null {
    for (const [key, value] of Object.entries(stored)) {
        if (!key.startsWith(SESSION_STORAGE_PREFIX) || !isRecord(value)) {continue;}
        const origin = readString(value, 'targetOrigin');
        const target = readString(value, 'targetUrl');
        if (origin?.length && fixtureUrl.startsWith(origin)) {return value;}
        if (target?.length && target.startsWith(fixtureUrl)) {return value;}
    }
    return null;
}

async function requireExtensionWorker(context: BrowserContext): Promise<Worker> {
    const existing = context.serviceWorkers()[0];
    if (existing) {return existing;}

    const pending = context
        .waitForEvent('serviceworker', { timeout: EXTENSION_READY_TIMEOUT_MS })
        .catch(() => null);
    const polling = (async () => {
        const deadline = Date.now() + EXTENSION_READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await delay(WORKER_POLL_INTERVAL_MS);
            const worker = context.serviceWorkers()[0];
            if (worker) {return worker;}
        }
        return null;
    })();

    const worker = await Promise.race([pending, polling]);
    if (worker) {return worker;}

    const resolved = context.serviceWorkers()[0];
    if (resolved) {return resolved;}

    throw new Error(
        'The bridge extension service worker never appeared in the browser context. '
        + 'Check that the launched browser loads the extension with --load-extension.'
    );
}

function record(
    trace: ApprovalModeTrace | undefined,
    event: string,
    status: 'started' | 'success' | 'error',
    details?: Record<string, unknown>
): void {
    if (!trace) {return;}
    appendEvalTrace(trace.tracePath, {
        runId: trace.runId,
        source: 'browser',
        event,
        status,
        details
    });
}

function isRecord(value: unknown): value is ChromeSessionRecord & Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: unknown, key: string): string | null {
    if (!isRecord(record)) {return null;}
    const value = record[key];
    return typeof value === 'string' ? value : null;
}

function seedFailureHint(approvalMode: SeedableApprovalMode, detail: string): string {
    return `Seeding the bridge default approval mode to ${approvalMode} failed (${detail}). `
        + 'This is a test-harness failure, not a product regression.';
}

function withDeadline<T>(promise: Promise<T>, deadlineMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out after ${deadlineMs} ms while ${label}.`));
        }, deadlineMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
