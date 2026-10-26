import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
    resolveWorkspaceRelativeDirectory,
    resolveWorkspaceRelativePath
} from '../tools/workspacePath';

type MultiRootLayout = {
    parent: string;
    gatewayRoot: string;
    serverRoot: string;
};

suite('Multi-root workspace path resolution', () => {
    test('routes a sibling-folder prefixed path into that folder', async () => {
        await withMultiRootWorkspace(async ({ gatewayRoot, serverRoot }) => {
            const resolved = await resolveWorkspaceRelativePath(
                [gatewayRoot, serverRoot],
                'micro-server/src/main/java/App.java',
                { forWrite: true, createParentDirectories: true }
            );
            assert.strictEqual(resolved.absolutePath, path.join(serverRoot, 'src', 'main', 'java', 'App.java'));
            assert.strictEqual(resolved.relativePath, 'src/main/java/App.java');
        });
    });

    test('writes into the sibling project instead of a fake subdirectory', async () => {
        await withMultiRootWorkspace(async ({ gatewayRoot, serverRoot }) => {
            const resolved = await resolveWorkspaceRelativePath(
                [gatewayRoot, serverRoot],
                'micro-server/pom.xml',
                { forWrite: true, createParentDirectories: true }
            );
            await fs.writeFile(resolved.absolutePath, '<project/>\n', 'utf8');

            assert.ok(await exists(path.join(serverRoot, 'pom.xml')));
            assert.ok(!(await exists(path.join(gatewayRoot, 'micro-server'))));
        });
    });

    test('allows ../ reaching a sibling workspace folder', async () => {
        await withMultiRootWorkspace(async ({ gatewayRoot, serverRoot }) => {
            await fs.writeFile(path.join(serverRoot, 'pom.xml'), '<project/>\n', 'utf8');

            const resolved = await resolveWorkspaceRelativePath([gatewayRoot, serverRoot], '../micro-server/pom.xml');
            assert.strictEqual(resolved.absolutePath, path.join(serverRoot, 'pom.xml'));
        });
    });

    test('rejects paths outside every workspace folder', async () => {
        await withMultiRootWorkspace(async ({ parent, gatewayRoot, serverRoot }) => {
            await assert.rejects(
                resolveWorkspaceRelativePath([gatewayRoot, serverRoot], '../../outside.txt', { forWrite: true }),
                /path must stay inside the VS Code workspace/
            );
            const escaped = parent.split(path.sep).join('/') + '/../outside.txt';
            await assert.rejects(
                resolveWorkspaceRelativePath([gatewayRoot, serverRoot], escaped),
                /path must be workspace-relative; absolute paths are not allowed/
            );
        });
    });

    test('resolves a sibling folder as a search directory', async () => {
        await withMultiRootWorkspace(async ({ gatewayRoot, serverRoot }) => {
            await fs.mkdir(path.join(serverRoot, 'src'), { recursive: true });

            const resolved = await resolveWorkspaceRelativeDirectory([gatewayRoot, serverRoot], 'micro-server/src');
            assert.strictEqual(resolved.absolutePath, path.join(serverRoot, 'src'));
        });
    });

    test('keeps single-root behavior unchanged', async () => {
        await withMultiRootWorkspace(async ({ gatewayRoot }) => {
            await fs.writeFile(path.join(gatewayRoot, 'index.ts'), 'export {};\n', 'utf8');

            const resolved = await resolveWorkspaceRelativePath(gatewayRoot, 'index.ts');
            assert.strictEqual(resolved.absolutePath, path.join(gatewayRoot, 'index.ts'));
        });
    });
});

async function withMultiRootWorkspace(callback: (layout: MultiRootLayout) => Promise<void>): Promise<void> {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-root-'));
    const gatewayRoot = path.join(parent, 'micro-gateway');
    const serverRoot = path.join(parent, 'micro-server');
    await fs.mkdir(gatewayRoot, { recursive: true });
    await fs.mkdir(serverRoot, { recursive: true });
    try {
        await callback({ parent, gatewayRoot, serverRoot });
    } finally {
        await fs.rm(parent, { recursive: true, force: true });
    }
}

async function exists(targetPath: string): Promise<boolean> {
    return fs.access(targetPath).then(() => true, () => false);
}
