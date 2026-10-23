import './vscodeStub';

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';

import { searchCodeTool } from '../tools/searchCodeTool';
import { searchFilesTool } from '../tools/searchFilesTool';
import type { ToolExecutionContext, ToolResult } from '../tools';

function createContext(workspaceRoot: string): ToolExecutionContext {
    const outputChannel = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
    return { workspaceRoot, outputChannel } as unknown as ToolExecutionContext;
}

async function makeWorkspace(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-abort-'));
    for (let index = 0; index < 50; index++) {
        await fs.writeFile(path.join(root, `file-${index}.txt`), `needle ${index}\n`, 'utf8');
    }
    return root;
}

function readToolText(result: ToolResult): string {
    return result.content
        .map(entry => entry.text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}

suite('search abort handling (batch B2)', () => {
    test('search_code rejects promptly when the signal aborts', async () => {
        const root = await makeWorkspace();
        const controller = new AbortController();
        controller.abort(new Error('deadline reached'));

        await assert.rejects(
            searchCodeTool.execute({ query: 'needle' }, createContext(root), controller.signal),
            (error: unknown) => error instanceof Error && /deadline reached/.test(error.message)
        );
        await fs.rm(root, { recursive: true, force: true });
    });

    test('search_files rejects promptly when the signal aborts', async () => {
        const root = await makeWorkspace();
        const controller = new AbortController();
        controller.abort(new Error('client disconnected'));

        await assert.rejects(
            searchFilesTool.execute({ query: 'file-' }, createContext(root), controller.signal),
            (error: unknown) => error instanceof Error && /client disconnected/.test(error.message)
        );
        await fs.rm(root, { recursive: true, force: true });
    });

    test('search_code still returns matches when no signal is supplied', async () => {
        const root = await makeWorkspace();
        const result = await searchCodeTool.execute({ query: 'needle', max_results: 5 }, createContext(root));
        assert.ok(readToolText(result).includes('needle'));
        await fs.rm(root, { recursive: true, force: true });
    });
});
