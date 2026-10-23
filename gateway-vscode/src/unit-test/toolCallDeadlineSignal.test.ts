import * as assert from 'assert';

import {
    NEVER_ABORT_SIGNAL,
    runWithDeadline,
    ToolCallTimeoutError
} from '../gateway/toolCallDeadline';

suite('runWithDeadline signal plumbing', () => {
    test('forwards an explicit signal to the work callback', async () => {
        const controller = new AbortController();
        let received: AbortSignal | undefined;

        await runWithDeadline(1_000, signal => {
            received = signal;
            return Promise.resolve('done');
        }, { signal: controller.signal });

        assert.strictEqual(received, controller.signal);
    });

    test('uses a never-aborting signal when the caller omits one', async () => {
        let received: AbortSignal | undefined;

        await runWithDeadline(1_000, signal => {
            received = signal;
            return Promise.resolve('done');
        });

        assert.strictEqual(received, NEVER_ABORT_SIGNAL);
        assert.strictEqual(received?.aborted, false);
    });

    test('keeps the disabled branch unwrapped and identical to the work promise', () => {
        const work = Promise.resolve('value');
        const result = runWithDeadline(0, () => work);

        assert.strictEqual(result, work, 'a disabled deadline must not wrap the work promise');
    });

    test('rejects with ToolCallTimeoutError and invokes onTimeout', async () => {
        const controller = new AbortController();
        const pending = new Promise<string>(() => undefined);
        let timeoutSeen: ToolCallTimeoutError | undefined;

        await assert.rejects(
            runWithDeadline(10, () => pending, {
                signal: controller.signal,
                onTimeout: error => { timeoutSeen = error; controller.abort(error); }
            }),
            (error: unknown) => error instanceof ToolCallTimeoutError
        );

        assert.ok(timeoutSeen, 'onTimeout must run before the rejection is observed');
        assert.strictEqual(controller.signal.aborted, true, 'the deadline must abort the controller');
    });

    test('a throwing onTimeout does not mask the timeout', async () => {
        const pending = new Promise<string>(() => undefined);

        await assert.rejects(
            runWithDeadline(10, () => pending, {
                onTimeout: () => { throw new Error('hook exploded'); }
            }),
            (error: unknown) => error instanceof ToolCallTimeoutError
        );
    });
});
