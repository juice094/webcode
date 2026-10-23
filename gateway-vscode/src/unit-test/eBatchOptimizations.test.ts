import './vscodeStub';

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { resolveLocalPathArguments } from '../gateway/pathArguments';
import { derivePathArgumentNames } from '../gateway/remoteTools';
import type { RemoteToolRoute } from '../gateway/types';
import { searchCodeInProcess } from '../tools/searchCodeFallback';
import type { SearchCodeOptions } from '../tools/searchCodeTypes';

suite('declarative path arguments (E2)', () => {
    test('reads declared schema formats instead of the tool name', () => {
        const names = derivePathArgumentNames('custom_tool', {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'workspace-relative-path' },
                dir: { type: 'string', format: 'workspace-relative-path' },
                label: { type: 'string' }
            }
        });

        assert.deepStrictEqual(names.sort(), ['dir', 'file']);
    });

    test('reads an array path argument declared on items', () => {
        const names = derivePathArgumentNames('batch_tool', {
            type: 'object',
            properties: {
                targets: {
                    type: 'array',
                    items: { type: 'string', format: 'workspace-relative-path' }
                }
            }
        });

        assert.deepStrictEqual(names, ['targets']);
    });

    test('falls back to the legacy list for an allowlisted tool without schema hints', () => {
        const names = derivePathArgumentNames('read_file', {
            type: 'object',
            properties: { path: { type: 'string' } }
        });

        assert.ok(names.includes('path'));
        assert.ok(names.includes('paths'));
    });

    test('returns nothing for an unknown tool without schema hints', () => {
        assert.deepStrictEqual(derivePathArgumentNames('mystery_tool', { type: 'object', properties: {} }), []);
    });

    test('rewrites a declared argument the legacy list never covered', () => {
        const workspaceRoot = path.resolve('C:/workspace-root');
        const args: Record<string, unknown> = { sourceFile: 'src/app.ts' };
        const route = createRoute('custom_copy', { sourceFile: 'src/app.ts' }, ['sourceFile']);

        resolveLocalPathArguments(route, args, workspaceRoot);

        assert.strictEqual(args.sourceFile, path.resolve(workspaceRoot, 'src/app.ts'));
    });

    test('rejects a declared path that escapes the workspace', () => {
        const workspaceRoot = path.resolve('C:/workspace-root');
        const args: Record<string, unknown> = { sourceFile: '../../etc/passwd' };
        const route = createRoute('custom_copy', {}, ['sourceFile']);

        assert.throws(() => resolveLocalPathArguments(route, args, workspaceRoot), /escapes workspace/);
    });

    test('leaves an undeclared argument untouched', () => {
        const workspaceRoot = path.resolve('C:/workspace-root');
        const args: Record<string, unknown> = { label: 'not a path', sourceFile: 'a.ts' };
        const route = createRoute('custom_copy', {}, ['sourceFile']);

        resolveLocalPathArguments(route, args, workspaceRoot);

        assert.strictEqual(args.label, 'not a path');
    });
});

function createRoute(
    toolName: string,
    _args: Record<string, unknown>,
    pathArguments: readonly string[]
): RemoteToolRoute {
    return {
        client: {} as RemoteToolRoute['client'],
        definition: {
            name: `srv:${toolName}`,
            description: 'test tool',
            inputSchema: { type: 'object', properties: {} }
        },
        serverId: 'srv',
        toolName,
        pathArguments
    };
}

suite('fallback search concurrency (E1)', () => {
    test('returns every match in stable path order', async () => {
        const root = await makeWorkspace(30);
        try {
            const result = await searchCodeInProcess(createSearchOptions(root, 100));
            assert.strictEqual(result.limited, false);
            assert.strictEqual(result.matches.length, 30);

            const paths = result.matches.map(match => match.split(':')[0]);
            const sorted = [...paths].sort((left, right) => left.localeCompare(right));
            assert.deepStrictEqual(paths, sorted, 'matches must be ordered by path');
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('stops at maxResults and reports limited', async () => {
        const root = await makeWorkspace(50);
        try {
            const result = await searchCodeInProcess(createSearchOptions(root, 5));
            assert.strictEqual(result.limited, true);
            assert.strictEqual(result.matches.length, 5);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('skips files without a match and reports nothing when none match', async () => {
        const root = await makeWorkspace(5);
        try {
            const options = createSearchOptions(root, 100);
            options.query = 'no-such-needle';
            const result = await searchCodeInProcess(options);
            assert.deepStrictEqual(result.matches, []);
            assert.strictEqual(result.limited, false);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});

async function makeWorkspace(fileCount: number): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webcode-fallback-'));
    for (let index = 0; index < fileCount; index++) {
        const name = `file-${String(index).padStart(3, '0')}.txt`;
        await fs.writeFile(path.join(root, name), `needle ${index}\n`, 'utf8');
    }
    return root;
}

function createSearchOptions(root: string, maxResults: number): SearchCodeOptions {
    return {
        searchRoot: root,
        workspaceRoot: root,
        query: 'needle',
        maxResults,
        includePattern: undefined,
        caseSensitive: false,
        useRegex: false,
        matchLineMaxChars: 500
    };
}
