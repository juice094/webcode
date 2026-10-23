import './vscodeStub';

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { readSelectedFileLines } from '../tools/readFileLineStream';

/**
 * Writes `lineCount` lines separated by `\n` with no trailing newline, so the
 * expectations describe whole lines only. The trailing-newline quirk has its
 * own test below.
 */
async function makeFile(lineCount: number, trailingNewline = false): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-tail-'));
    const filePath = path.join(dir, 'data.txt');
    const lines = Array.from({ length: lineCount }, (_value, index) => `line-${index + 1}`);
    await fs.writeFile(filePath, lines.join('\n') + (trailingNewline ? '\n' : ''), 'utf8');
    return filePath;
}

suite('read_file tail and abort (batch B3)', () => {
    test('returns the last N lines in chronological order', async () => {
        const filePath = await makeFile(1_000);
        const result = await readSelectedFileLines(filePath, { tail: 3 });

        assert.deepStrictEqual(result.lines, ['line-998', 'line-999', 'line-1000']);
        assert.strictEqual(result.startLine, 998);
        assert.strictEqual(result.lineCount, 1_000);
    });

    test('returns the whole file when tail exceeds the line count', async () => {
        const filePath = await makeFile(5);
        const result = await readSelectedFileLines(filePath, { tail: 100 });

        assert.deepStrictEqual(result.lines, ['line-1', 'line-2', 'line-3', 'line-4', 'line-5']);
        assert.strictEqual(result.startLine, 1);
    });

    test('handles a tail larger than the file with a single line', async () => {
        const filePath = await makeFile(1);
        const result = await readSelectedFileLines(filePath, { tail: 10 });

        assert.deepStrictEqual(result.lines, ['line-1']);
        assert.strictEqual(result.startLine, 1);
    });

    test('keeps the trailing empty line produced by a final newline', async () => {
        // Pre-existing semantics: the stream emits the empty string after a
        // trailing newline, so both the line count and the tail include it. The
        // ring buffer must not silently change this.
        const filePath = await makeFile(3, true);
        const result = await readSelectedFileLines(filePath, { tail: 2 });

        assert.deepStrictEqual(result.lines, ['line-3', '']);
        assert.strictEqual(result.lineCount, 4);
    });

    test('rejects with the abort reason when the signal is already aborted', async () => {
        const filePath = await makeFile(100);
        const controller = new AbortController();
        controller.abort(new Error('deadline reached'));

        await assert.rejects(
            readSelectedFileLines(filePath, { tail: 3 }, controller.signal),
            (error: unknown) => error instanceof Error && /deadline reached/.test(error.message)
        );
    });

    test('rejects mid-read when the signal aborts during a forward range', async () => {
        const filePath = await makeFile(200_000);
        const controller = new AbortController();
        const pending = readSelectedFileLines(filePath, { startLine: 1, endLine: 200_000 }, controller.signal);
        setTimeout(() => controller.abort(new Error('client disconnected')), 1);

        await assert.rejects(
            pending,
            (error: unknown) => error instanceof Error && /client disconnected/.test(error.message)
        );
    });
});
