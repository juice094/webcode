import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
    MAX_COMMAND_EXECUTION_MAX_MS,
    MAX_COMMAND_EXECUTION_MS,
    resolveCommandExecutionMaxMs,
    resolveCommandExecutionTimeoutMs
} from '../gateway/timeouts';
import { buildExecuteCommandTimeoutSchema } from '../tools/executeCommandTimeout';

suite('execute_command timeout ceiling', () => {
    test('leaves the request untouched when the ceiling is disabled', () => {
        assert.strictEqual(resolveCommandExecutionTimeoutMs(1_800_000, 60_000, 0), 1_800_000);
        assert.strictEqual(resolveCommandExecutionTimeoutMs(undefined, 60_000, 0), 60_000);
    });

    test('clamps a model-supplied timeout to the ceiling', () => {
        assert.strictEqual(resolveCommandExecutionTimeoutMs(1_800_000, 60_000, 90_000), 90_000);
        assert.strictEqual(resolveCommandExecutionTimeoutMs(90_000, 60_000, 90_000), 90_000);
        assert.strictEqual(resolveCommandExecutionTimeoutMs(5_000, 60_000, 90_000), 5_000);
    });

    test('applies the ceiling to the configured default too', () => {
        assert.strictEqual(
            resolveCommandExecutionTimeoutMs(undefined, 600_000, 90_000),
            90_000,
            'the default deadline is not exempt from the ceiling'
        );
    });

    test('advertises the ceiling as the schema maximum', () => {
        const capped = buildExecuteCommandTimeoutSchema({}, 60_000, 90_000);
        assert.strictEqual(capped.maximum, 90_000, 'the model must see the real ceiling');
        assert.strictEqual(capped.default, 60_000);
        assert.ok(String(capped.description).includes('Maximum: 90000'));

        const uncapped = buildExecuteCommandTimeoutSchema({}, 60_000, 0);
        assert.strictEqual(uncapped.maximum, MAX_COMMAND_EXECUTION_MS);
    });

    test('treats an invalid ceiling as disabled', () => {
        for (const invalid of ['90000', null, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
            assert.strictEqual(
                resolveCommandExecutionMaxMs(invalid),
                0,
                `invalid ceiling ${String(invalid)} must fall back to 0`
            );
            assert.strictEqual(resolveCommandExecutionTimeoutMs(1_800_000, 60_000, invalid), 1_800_000);
        }
    });

    test('clamps a ceiling above the supported range', () => {
        assert.strictEqual(resolveCommandExecutionMaxMs(9_999_999), 1_800_000);
        assert.strictEqual(resolveCommandExecutionMaxMs(MAX_COMMAND_EXECUTION_MAX_MS), 1_800_000);
        assert.strictEqual(resolveCommandExecutionTimeoutMs(5_000_000, 60_000, 9_999_999), 1_800_000);
    });

    test('does not let the ceiling reach run_in_terminal', () => {
        // The tool module is not imported here on purpose: it pulls the vscode
        // runtime through terminal profile discovery. The invariant we care about
        // is that the ceiling never becomes part of the terminal tool at all.
        const sourcePath = path.join(__dirname, '..', '..', 'src', 'tools', 'runInTerminalTool.ts');
        const source = fs.readFileSync(sourcePath, 'utf8');
        assert.strictEqual(
            source.includes('commandExecutionMaxMs'),
            false,
            'run_in_terminal must not consume the execute_command ceiling'
        );
        assert.strictEqual(
            /^\s*timeout:\s*\{/m.test(source),
            false,
            'run_in_terminal must not gain a timeout schema property'
        );
    });
});
