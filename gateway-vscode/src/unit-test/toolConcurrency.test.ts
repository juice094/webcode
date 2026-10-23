import * as assert from 'assert';

import { ToolConcurrencyGate } from '../gateway/toolConcurrency';

suite('ToolConcurrencyGate', () => {
    test('caps concurrent tasks and releases slots in FIFO order', async () => {
        const gate = new ToolConcurrencyGate(2);
        const started: number[] = [];
        const releases: Array<() => void> = [];

        const task = (id: number) => gate.run(async () => {
            started.push(id);
            await new Promise<void>(resolve => releases.push(resolve));
            return id;
        });

        const promises = [task(1), task(2), task(3), task(4)];

        await settle();
        assert.deepStrictEqual(started, [1, 2], 'only two tasks may start');
        assert.strictEqual(gate.running, 2);
        assert.strictEqual(gate.pending, 2);

        releases.shift()?.();
        await settle();
        assert.deepStrictEqual(started, [1, 2, 3], 'the oldest waiter runs first');

        releases.shift()?.();
        await settle();
        assert.deepStrictEqual(started, [1, 2, 3, 4], 'the last waiter starts');

        releases.shift()?.();
        releases.shift()?.();

        assert.deepStrictEqual(await Promise.all(promises), [1, 2, 3, 4]);
        assert.strictEqual(gate.running, 0);
        assert.strictEqual(gate.pending, 0);
    });

    test('releases the slot when a task rejects', async () => {
        const gate = new ToolConcurrencyGate(1);
        const failing = gate.run(() => Promise.reject(new Error('boom')));

        await assert.rejects(failing, /boom/);
        assert.strictEqual(gate.running, 0);

        const next = await gate.run(() => Promise.resolve('ok'));
        assert.strictEqual(next, 'ok');
    });

    test('runs inline when the limit disables the gate', async () => {
        const gate = new ToolConcurrencyGate(0);
        const started: number[] = [];

        await Promise.all([
            gate.run(() => { started.push(1); return Promise.resolve(); }),
            gate.run(() => { started.push(2); return Promise.resolve(); })
        ]);

        assert.deepStrictEqual(started, [1, 2]);
        assert.strictEqual(gate.pending, 0);
    });
});

function settle(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}
