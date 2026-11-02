import './vscodeStub';

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { READ_FILES_MAX_PATHS, readFilesTool } from '../tools/readFilesTool';
import type { ToolExecutionContext, ToolResult } from '../tools';

function createContext(workspaceRoot: string, approvedCommandFingerprint?: string): ToolExecutionContext {
    return {
        workspaceRoot,
        workspaceRoots: [workspaceRoot],
        approvedCommandFingerprint
    } as unknown as ToolExecutionContext;
}

type BatchItem = { path: string; ok: boolean; content?: string; error?: string };

function readBatchResults(result: ToolResult): { text: string; items: BatchItem[]; isError?: boolean } {
    const text = result.content.map(entry => entry.text).filter((value): value is string => typeof value === 'string').join('\n');
    const structured = result.structuredContent as { results: BatchItem[] } | undefined;
    assert.ok(structured, 'read_files must return structuredContent');
    return { text, items: structured.results, isError: result.isError };
}

async function createWorkspace(): Promise<{ root: string; cleanup: () => Promise<void> }> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-read-files-'));
    await fs.writeFile(path.join(root, 'a.txt'), 'alpha\nbravo\n');
    await fs.writeFile(path.join(root, 'b.txt'), 'charlie\n');
    return {
        root,
        cleanup: async () => {
            await fs.rm(root, { recursive: true, force: true });
        }
    };
}

suite('read_files batch tool', () => {
    test('reads several files and reports per-path failures without failing the batch', async () => {
        const workspace = await createWorkspace();
        try {
            const result = await readFilesTool.execute({
                paths: ['a.txt', 'b.txt', 'missing.txt', 'C:/outside.txt']
            }, createContext(workspace.root));

            const batch = readBatchResults(result);
            assert.strictEqual(batch.items.length, 4);
            assert.strictEqual(batch.items[0].ok, true);
            assert.strictEqual(batch.items[0].content, 'alpha\nbravo\n');
            assert.strictEqual(batch.items[1].ok, true);
            assert.strictEqual(batch.items[1].content, 'charlie\n');
            assert.strictEqual(batch.items[2].ok, false);
            assert.ok(batch.items[2].error, 'missing file must carry an error');
            assert.strictEqual(batch.items[3].ok, false);
            assert.match(batch.items[3].error ?? '', /workspace-relative/, 'absolute path rejected with the read_file semantics');
            assert.strictEqual(batch.isError, false, 'partial success must not mark the batch as failed');
            assert.match(batch.text, /2\/4 file\(s\) read successfully/, 'header counts the successes');
        } finally {
            await workspace.cleanup();
        }
    });

    test('applies line selection to every file', async () => {
        const workspace = await createWorkspace();
        try {
            const result = await readFilesTool.execute({ paths: ['a.txt', 'b.txt'], head: 1 }, createContext(workspace.root));
            const batch = readBatchResults(result);
            assert.strictEqual(batch.items[0].content, 'alpha');
            assert.strictEqual(batch.items[1].content, 'charlie');
        } finally {
            await workspace.cleanup();
        }
    });

    test('rejects batches above the path limit with a retryable error', async () => {
        const workspace = await createWorkspace();
        try {
            const paths = Array.from({ length: READ_FILES_MAX_PATHS + 1 }, (_, index) => `file-${index}.txt`);
            const result = await readFilesTool.execute({ paths }, createContext(workspace.root));

            assert.strictEqual(result.isError, true);
            const text = result.content.map(entry => entry.text).join('\n');
            assert.match(text, /at most 16 paths/, 'the error names the limit');
            assert.match(text, /Split the batch/, 'the error tells the caller how to retry');
        } finally {
            await workspace.cleanup();
        }
    });

    test('marks the batch failed when every path fails', async () => {
        const workspace = await createWorkspace();
        try {
            const result = await readFilesTool.execute({ paths: ['missing-a.txt', 'missing-b.txt'] }, createContext(workspace.root));
            const batch = readBatchResults(result);
            assert.strictEqual(batch.isError, true, 'an all-failed batch must be flagged');
            assert.ok(batch.items.every(item => !item.ok));
        } finally {
            await workspace.cleanup();
        }
    });

    test('requires approval for a sensitive path and honours the batch fingerprint', async () => {
        const workspace = await createWorkspace();
        try {
            await fs.writeFile(path.join(workspace.root, '.env'), 'SECRET=1\n');
            const args = { paths: ['a.txt', '.env'] };
            const context = createContext(workspace.root);

            const preflight = await readFilesTool.assessRisk?.(args, context);
            assert.strictEqual(preflight?.assessment.level, 'requires_confirmation', 'a sensitive path upgrades the batch');

            const denied = await readFilesTool.execute(args, context);
            assert.strictEqual(denied.isError, true);
            assert.match(denied.content.map(entry => entry.text).join('\n'), /Approval Required/);

            const approved = await readFilesTool.execute(
                args,
                createContext(workspace.root, preflight?.fingerprint)
            );
            const batch = readBatchResults(approved);
            assert.strictEqual(batch.items.every(item => item.ok), true, 'the matching grant unlocks the whole batch');
        } finally {
            await workspace.cleanup();
        }
    });

    test('points binary attachments to read_file instead of batch-reading them', async () => {
        const workspace = await createWorkspace();
        try {
            await fs.writeFile(path.join(workspace.root, 'pixel.png'), Buffer.from([0x89, 0x50]));
            const result = await readFilesTool.execute({ paths: ['pixel.png'] }, createContext(workspace.root));
            const batch = readBatchResults(result);
            assert.strictEqual(batch.items[0].ok, false);
            assert.match(batch.items[0].error ?? '', /use read_file/, 'attachments get a pointer to read_file');
        } finally {
            await workspace.cleanup();
        }
    });
});
