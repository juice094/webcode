import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    GATEWAY_IGNORE_FILE_NAME,
    parseGatewayIgnore
} from '../tools/gatewayIgnore';
import { buildProjectContextForPrompt } from '../tools/getProjectContextTool';

suite('Project Context Tool', () => {
    test('renders a plain-text skeleton and collapses generated and archived folders', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await fs.mkdir(path.join(workspaceRoot, '.git'));
            await fs.mkdir(path.join(workspaceRoot, 'node_modules'));
            await fs.writeFile(path.join(workspaceRoot, 'node_modules', 'package.json'), '{}\n', 'utf8');
            await fs.mkdir(path.join(workspaceRoot, 'src'));
            await fs.mkdir(path.join(workspaceRoot, 'docs'));
            await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
            await fs.writeFile(path.join(workspaceRoot, 'docs', 'guide.md'), '# Guide\n', 'utf8');
            await fs.writeFile(path.join(workspaceRoot, 'package.json'), '{}\n', 'utf8');
            await fs.mkdir(path.join(workspaceRoot, 'archive'));
            for (const name of ['old-a.md', 'old-b.md', 'old-c.md']) {
                await fs.writeFile(path.join(workspaceRoot, 'archive', name), 'x\n', 'utf8');
            }
            await fs.mkdir(path.join(workspaceRoot, '.pytest_cache'));

            const output = await buildProjectContextForPrompt(workspaceRoot);

            assert.ok(output.includes('# Project Context (Metadata Only)'));
            assert.ok(output.includes('untrusted data'));
            assert.ok(output.includes(`Project: ${path.basename(workspaceRoot)}`));
            assert.ok(output.includes('Git: not a repository'));

            assert.ok(output.includes('  src/'));
            assert.ok(output.includes('    src/index.ts'));
            assert.ok(output.includes('  package.json'));
            assert.ok(output.includes('  archive/ (3 entries omitted)'));
            assert.ok(output.includes('  .pytest_cache/ (ignored)'));
            assert.ok(output.includes('  .git/ (ignored)'));
            assert.ok(output.includes('  node_modules/ (ignored)'));

            assert.ok(!output.includes('node_modules/package.json'));
            assert.ok(!output.includes('.git/HEAD'));
            assert.ok(!output.includes('archive/old-a.md'));
            assert.ok(!output.includes(workspaceRoot));
            assert.ok(!output.includes('```'), 'the context block must not be a fenced code block');
        });
    });

    test('detects Git metadata fallback without expanding the Git directory', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await fs.mkdir(path.join(workspaceRoot, '.git'));
            await fs.writeFile(path.join(workspaceRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
            await fs.writeFile(path.join(workspaceRoot, 'README.md'), '# Sample\n', 'utf8');

            const output = await buildProjectContextForPrompt(workspaceRoot);

            assert.ok(output.includes('Git: repository on branch main'));
            assert.ok(output.includes('  README.md'));
            assert.ok(output.includes('  .git/ (ignored)'));
            assert.ok(!output.includes('.git/HEAD'));
        });
    });

    test('caps the skeleton at the entry budget and says so', async () => {
        await withTempWorkspace(async workspaceRoot => {
            for (let index = 0; index < 40; index += 1) {
                const directoryPath = path.join(workspaceRoot, `pkg-${index.toString().padStart(2, '0')}`);
                await fs.mkdir(directoryPath);
                await fs.writeFile(path.join(directoryPath, 'a.ts'), 'export {};\n', 'utf8');
                await fs.writeFile(path.join(directoryPath, 'b.ts'), 'export {};\n', 'utf8');
                await fs.writeFile(path.join(directoryPath, 'c.ts'), 'export {};\n', 'utf8');
            }

            const output = await buildProjectContextForPrompt(workspaceRoot);
            const structureLines = output.split('\n').slice(output.split('\n').indexOf('Structure (skeleton: generated, dependency and archived folders are collapsed, not listed):') + 1);

            assert.ok(output.includes('… remaining folders are not listed'));
            assert.ok(structureLines.length <= 90, `skeleton kept ${structureLines.length} lines`);
            assert.ok(!output.includes('pkg-39/c.ts'));
        });
    });

    test('lists small folders whole and large file-heavy folders by count', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await fs.mkdir(path.join(workspaceRoot, 'notes'));
            for (let index = 0; index < 10; index += 1) {
                await fs.writeFile(path.join(workspaceRoot, 'notes', `note-${index}.md`), '# n\n', 'utf8');
            }
            await fs.mkdir(path.join(workspaceRoot, 'doc'));
            await fs.mkdir(path.join(workspaceRoot, 'doc', 'guides'));
            await fs.writeFile(path.join(workspaceRoot, 'doc', 'intro.md'), '# i\n', 'utf8');

            const output = await buildProjectContextForPrompt(workspaceRoot);

            assert.ok(output.includes('  notes/ (10 entries)'));
            assert.ok(!output.includes('notes/note-0.md'));
            assert.ok(output.includes('    doc/guides/'));
            assert.ok(output.includes('    doc/intro.md'));
        });
    });

    test('honours .gatewayignore above every built-in rule', async () => {
        await withTempWorkspace(async workspaceRoot => {
            await fs.mkdir(path.join(workspaceRoot, 'archive'));
            await fs.writeFile(path.join(workspaceRoot, 'archive', 'kept.md'), '# Kept\n', 'utf8');
            await fs.mkdir(path.join(workspaceRoot, 'src'));
            await fs.writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf8');
            await fs.writeFile(
                path.join(workspaceRoot, GATEWAY_IGNORE_FILE_NAME),
                ['# pull the archive back in', '!archive/', '', '# drop the source tree', 'src/'].join('\n'),
                'utf8'
            );

            const output = await buildProjectContextForPrompt(workspaceRoot);

            assert.ok(output.includes('  archive/'));
            assert.ok(output.includes('    archive/kept.md'));
            assert.ok(output.includes('  src/ (1 entry omitted)'));
            assert.ok(!output.includes('src/index.ts'));
        });
    });
});

suite('Project Context ignore patterns', () => {
    test('parses comments, negation, directory-only and anchored patterns', () => {
        const rules = parseGatewayIgnore(['# comment', '', 'logs/', '!logs/keep.log', '/rooted.txt', '**/*.bak'].join('\n'));

        assert.strictEqual(rules.length, 4);
        assert.deepStrictEqual(rules.map(rule => rule.negated), [false, true, false, false]);
        assert.deepStrictEqual(rules.map(rule => rule.directoryOnly), [true, false, false, false]);
        assert.deepStrictEqual(rules.map(rule => rule.anchored), [false, true, true, true]);
    });
});

async function withTempWorkspace(callback: (workspaceRoot: string) => Promise<void>): Promise<void> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-context-tool-'));
    try {
        await callback(workspaceRoot);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
}
