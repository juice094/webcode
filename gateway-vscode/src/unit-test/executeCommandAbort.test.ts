import './vscodeStub';

import * as assert from 'assert';

import { executeCommandTool } from '../tools/executeCommandTool';
import type { ToolExecutionContext, ToolResult } from '../tools';

function createCommandContext(commandExecutionMs: number): ToolExecutionContext {
    return {
        workspaceRoot: process.cwd(),
        commandAllowedRoots: [],
        commandExecutionMs
    } as unknown as ToolExecutionContext;
}

function readToolText(result: ToolResult): string {
    return result.content
        .map(entry => entry.text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}

suite('execute_command abort handling (batch B1)', () => {
    test('kills the running process tree when the signal aborts', async () => {
        const context = createCommandContext(60_000);
        const controller = new AbortController();
        const startedAt = Date.now();
        const pending = executeCommandTool.execute({ command: 'sleep 5' }, context, controller.signal);
        setTimeout(() => controller.abort(new Error('deadline reached')), 100);

        const result = await pending;
        const elapsed = Date.now() - startedAt;

        assert.strictEqual(result.isError, true);
        assert.ok(elapsed < 3000, `abort must return promptly, took ${elapsed}ms`);
        assert.ok(readToolText(result).includes('deadline reached'), readToolText(result));
    });

    test('returns immediately when the signal is already aborted', async () => {
        const context = createCommandContext(60_000);
        const controller = new AbortController();
        controller.abort(new Error('already aborted'));

        const result = await executeCommandTool.execute({ command: 'sleep 5' }, context, controller.signal);
        assert.strictEqual(result.isError, true);
        assert.ok(readToolText(result).includes('already aborted'), readToolText(result));
    });

    test('reuses the cached definition for an identical context', () => {
        const first = executeCommandTool.getDefinition?.({ commandExecutionMs: 12_345 });
        const second = executeCommandTool.getDefinition?.({ commandExecutionMs: 12_345 });
        const other = executeCommandTool.getDefinition?.({ commandExecutionMs: 54_321 });

        assert.ok(first);
        assert.strictEqual(first, second, 'identical context must reuse the cached definition');
        assert.notStrictEqual(first, other, 'a different context must build its own definition');
    });
});
