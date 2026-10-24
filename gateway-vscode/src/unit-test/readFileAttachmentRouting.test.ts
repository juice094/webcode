import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readFileTool } from '../tools/readFileTool';
import { READ_FILE_OUTPUT_MAX_BYTES } from '../tools/readFileOutputLimit';
import type { ToolExecutionContext } from '../tools';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01]);

suite('Read File Tool attachment routing', () => {
    test('routes a PNG file to an attachment resource', async () => {
        await withWorkspaceFile('assets/sample image.png', PNG_BYTES, async (workspaceRoot) => {
            const result = await readFileTool.execute({ path: 'assets/sample image.png' }, createContext(workspaceRoot));
            const resource = requireAttachmentResource(result);

            assert.strictEqual(resource.mimeType, 'image/png');
            assert.strictEqual(resource.uri, 'workspace:///assets/sample%20image.png');
            assert.strictEqual(resource.blob, PNG_BYTES.toString('base64'));
            assert.match(result.content[0]?.text ?? '', /Prepared workspace file/);
        });
    });

    test('routes a PDF file to an attachment resource', async () => {
        const pdf = Buffer.from('\n%PDF-1.7\nexample', 'ascii');
        await withWorkspaceFile('docs/example.pdf', pdf, async (workspaceRoot) => {
            const result = await readFileTool.execute({ path: 'docs/example.pdf' }, createContext(workspaceRoot));

            assert.strictEqual(requireAttachmentResource(result).mimeType, 'application/pdf');
        });
    });

    test('rejects an attachment whose content does not match its extension', async () => {
        await withWorkspaceFile('fake.png', Buffer.from('not a png', 'utf8'), async (workspaceRoot) => {
            await assert.rejects(
                readFileTool.execute({ path: 'fake.png' }, createContext(workspaceRoot)),
                /does not match the \.png attachment type/
            );
        });
    });

    test('rejects line selection on an attachment path', async () => {
        await withWorkspaceFile('sample.png', PNG_BYTES, async (workspaceRoot) => {
            await assert.rejects(
                readFileTool.execute({ path: 'sample.png', head: 2 }, createContext(workspaceRoot)),
                /cannot apply line selection to a binary attachment/
            );
        });
    });

    test('keeps plain text files on the text read path', async () => {
        await withWorkspaceFile('notes.txt', Buffer.from('alpha\nbravo', 'utf8'), async (workspaceRoot) => {
            const result = await readFileTool.execute({ path: 'notes.txt' }, createContext(workspaceRoot));

            assert.strictEqual(result.content.length, 1);
            assert.strictEqual(result.content[0]?.type, 'text');
            assert.strictEqual(result.content[0]?.text, 'alpha\nbravo');
        });
    });

    test('keeps oversized text files on the text read path with truncation metadata', async () => {
        const content = 'x'.repeat(READ_FILE_OUTPUT_MAX_BYTES + 1);
        await withWorkspaceFile('huge.txt', Buffer.from(content, 'utf8'), async (workspaceRoot) => {
            const result = await readFileTool.execute({ path: 'huge.txt' }, createContext(workspaceRoot));

            assert.strictEqual(result.content[0]?.type, 'text');
            assert.ok(result.structuredContent);
            assert.strictEqual((result.structuredContent as { truncated: boolean }).truncated, true);
        });
    });

    test('requires approval for sensitive attachment paths before routing', async () => {
        await withWorkspaceFile('.ssh/id_rsa.png', PNG_BYTES, async (workspaceRoot) => {
            const result = await readFileTool.execute({ path: '.ssh/id_rsa.png' }, createContext(workspaceRoot));

            assert.strictEqual(result.isError, true);
            assert.match(result.content[0]?.text ?? '', /Approval Required/);
        });
    });
});

type AttachmentResource = {
    blob: string;
    mimeType: string;
    uri: string;
};

function requireAttachmentResource(result: { content: Array<{ type: string; resource?: unknown }> }): AttachmentResource {
    const block = result.content.find(item => item.type === 'resource');
    assert.ok(block && typeof block.resource === 'object' && block.resource !== null);
    const resource = block.resource as Record<string, unknown>;
    assert.strictEqual(typeof resource.blob, 'string');
    assert.strictEqual(typeof resource.mimeType, 'string');
    assert.strictEqual(typeof resource.uri, 'string');
    return resource as unknown as AttachmentResource;
}

async function withWorkspaceFile(
    relativePath: string,
    content: Buffer,
    callback: (workspaceRoot: string) => Promise<void>
): Promise<void> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'read-file-routing-'));
    const filePath = path.join(workspaceRoot, ...relativePath.split('/'));
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
        await callback(workspaceRoot);
    } finally {
        await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
}

function createContext(workspaceRoot: string): ToolExecutionContext {
    return {
        workspaceRoot,
        outputChannel: {
            appendLine(value: string) {
                void value;
            }
        } as unknown as ToolExecutionContext['outputChannel'],
        skillManager: {} as ToolExecutionContext['skillManager'],
        terminalSessionManager: {} as ToolExecutionContext['terminalSessionManager'],
        skillDirectories: [],
        listTools: () => [],
        getToolDefinition: () => null
    };
}
