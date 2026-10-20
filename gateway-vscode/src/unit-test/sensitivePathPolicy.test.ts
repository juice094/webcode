import * as assert from 'assert';
import type express from 'express';

import { CommandApprovalManager } from '../gateway/commandApproval';
import {
    createToolApprovalHandler,
    createToolCallHandler,
    createToolPreflightHandler
} from '../gateway/toolCallRoute';
import { assessShellCommandRisk } from '../servers/commandRisk';
import {
    assessSensitiveFileRisk,
    getSensitiveFileApprovalError,
    isSensitiveFilePath
} from '../servers/sensitivePathPolicy';
import { readFileTool } from '../tools/readFileTool';
import { writeFileTool } from '../tools/writeFileTool';
import type { LocalTool, ToolExecutionContext } from '../tools';

suite('Sensitive file path policy', () => {
    test('flags credential carriers by name, extension, and directory', () => {
        const sensitive = [
            '.env',
            '.env.production',
            'config.env',
            '.envrc',
            '.npmrc',
            '.pypirc',
            '.netrc',
            'credentials',
            'credentials.json',
            'server.pem',
            'tls.key',
            'putty.ppk',
            'bundle.p12',
            'store.pfx',
            'vault.kdbx',
            'keys/id_rsa',
            'keys/id_ed25519',
            'home/.ssh/config',
            'home/.aws/credentials',
            'home/.gnupg/secring.gpg',
            'home/.kube/config',
            'keys\\id_rsa',
            'foo/../.env'
        ];
        for (const candidate of sensitive) {
            assert.strictEqual(isSensitiveFilePath(candidate), true, `expected sensitive: ${candidate}`);
        }
    });

    test('exempts public keys, templates, and ordinary files', () => {
        const ordinary = [
            'src/index.ts',
            'README.md',
            'environment.md',
            '.env.example',
            '.env.sample',
            'prod.env.template',
            'id_rsa.pub',
            'id_ed25519.pub',
            'certs/ca.crt',
            'src/config.ts',
            'env.d.ts'
        ];
        for (const candidate of ordinary) {
            assert.strictEqual(isSensitiveFilePath(candidate), false, `expected ordinary: ${candidate}`);
        }
    });

    test('risk assessment is stable per tool and path pair', () => {
        const first = assessSensitiveFileRisk('read_file', { path: '.env' });
        const second = assessSensitiveFileRisk('read_file', { path: '.env' });
        const otherTool = assessSensitiveFileRisk('write_file', { path: '.env' });

        assert.strictEqual(first.assessment.level, 'requires_confirmation');
        assert.strictEqual(first.fingerprint, second.fingerprint);
        assert.notStrictEqual(first.fingerprint, otherTool.fingerprint);

        const safe = assessSensitiveFileRisk('read_file', { path: 'src/index.ts' });
        assert.strictEqual(safe.assessment.level, 'allowed');
        assert.deepStrictEqual(safe.assessment.reasons, []);
    });

    test('approval error only clears with the matching fingerprint', () => {
        const risk = assessSensitiveFileRisk('write_file', { path: '.env' });
        const expectedError = `Approval Required: ${risk.assessment.reasons.join(' ')}`;
        assert.strictEqual(getSensitiveFileApprovalError(risk, undefined), expectedError);
        assert.strictEqual(getSensitiveFileApprovalError(risk, 'other-fingerprint'), expectedError);
        assert.strictEqual(getSensitiveFileApprovalError(risk, risk.fingerprint), null);

        const safe = assessSensitiveFileRisk('write_file', { path: 'src/index.ts' });
        assert.strictEqual(getSensitiveFileApprovalError(safe, undefined), null);
    });

    test('file tools expose sensitive-path assessRisk', async () => {
        const risky = await writeFileTool.assessRisk?.({ path: '.env', content: 'x' }, {} as ToolExecutionContext);
        assert.strictEqual(risky?.assessment.level, 'requires_confirmation');

        const safe = await writeFileTool.assessRisk?.({ path: 'src/main.ts', content: 'x' }, {} as ToolExecutionContext);
        assert.strictEqual(safe?.assessment.level, 'allowed');

        const readRisky = await readFileTool.assessRisk?.({ path: 'keys/id_rsa' }, {} as ToolExecutionContext);
        assert.strictEqual(readRisky?.assessment.level, 'requires_confirmation');
    });

    test('shell path commands touching sensitive files require confirmation', () => {
        const context = { workspaceRoot: 'C:\\workspace', cwd: 'C:\\workspace' };
        const risky = assessShellCommandRisk('cat .env', context);
        assert.strictEqual(risky.level, 'requires_confirmation');

        const safe = assessShellCommandRisk('cat src/index.ts', context);
        assert.strictEqual(safe.level, 'allowed');
    });
});

suite('Gateway file-tool approval routes', () => {
    test('issues a challenge for sensitive file tools and consumes the grant once', async () => {
        let approvedFingerprint: string | undefined;
        const tool = createSensitiveFileTool(fingerprint => { approvedFingerprint = fingerprint; });
        const manager = new CommandApprovalManager();
        const options = createHandlerOptions(tool, manager);

        const preflight = await invokeHandler(createToolPreflightHandler(options), {
            name: 'write_file',
            arguments: { path: '.env', content: 'SECRET=1' }
        });
        assert.strictEqual(preflight.statusCode, 200);
        assert.strictEqual(readNestedString(preflight.body, 'risk', 'level'), 'requires_confirmation');
        const challengeId = readNestedString(preflight.body, 'challenge', 'id');
        assert.ok(challengeId);

        const approval = await invokeHandler(createToolApprovalHandler(manager), { challenge_id: challengeId });
        const approvalToken = readString(approval.body, 'approval_token');
        assert.ok(approvalToken);

        const executed = await invokeHandler(createToolCallHandler(options), {
            name: 'write_file',
            arguments: { path: '.env', content: 'SECRET=1' },
            approval_token: approvalToken
        });
        assert.strictEqual(executed.statusCode, 200);
        assert.ok(approvedFingerprint);

        const replay = await invokeHandler(createToolCallHandler(options), {
            name: 'write_file',
            arguments: { path: '.env', content: 'SECRET=1' },
            approval_token: approvalToken
        });
        assert.strictEqual(replay.statusCode, 409);
    });

    test('rejects sensitive file tool execution without an approval token', async () => {
        let executionCount = 0;
        const tool = createSensitiveFileTool(() => { executionCount += 1; });
        const options = createHandlerOptions(tool, new CommandApprovalManager());

        const execution = await invokeHandler(createToolCallHandler(options), {
            name: 'write_file',
            arguments: { path: '.env', content: 'SECRET=1' }
        });
        assert.strictEqual(execution.statusCode, 409);
        assert.strictEqual(executionCount, 0);
    });

    test('runs ordinary file tool calls without any approval', async () => {
        let executionCount = 0;
        const tool = createSensitiveFileTool(() => { executionCount += 1; });
        const options = createHandlerOptions(tool, new CommandApprovalManager());

        const preflight = await invokeHandler(createToolPreflightHandler(options), {
            name: 'write_file',
            arguments: { path: 'src/index.ts', content: 'export {}' }
        });
        assert.strictEqual(readNestedString(preflight.body, 'risk', 'level'), 'allowed');
        assert.strictEqual(readRecord(preflight.body).challenge, undefined);

        const execution = await invokeHandler(createToolCallHandler(options), {
            name: 'write_file',
            arguments: { path: 'src/index.ts', content: 'export {}' }
        });
        assert.strictEqual(execution.statusCode, 200);
        assert.strictEqual(executionCount, 1);
    });
});

function createSensitiveFileTool(onExecute: (fingerprint: string) => void): LocalTool {
    return {
        definition: {
            name: 'write_file',
            description: 'test file tool',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string' }
                },
                required: ['path', 'content']
            }
        },
        assessRisk(args) {
            return Promise.resolve(assessSensitiveFileRisk('write_file', args));
        },
        execute(args, context) {
            const risk = assessSensitiveFileRisk('write_file', args);
            const error = getSensitiveFileApprovalError(risk, context.approvedCommandFingerprint);
            if (error) {
                return Promise.resolve({ content: [{ type: 'text', text: error }], isError: true });
            }
            onExecute(context.approvedCommandFingerprint ?? '');
            return Promise.resolve({ content: [{ type: 'text', text: 'executed' }] });
        }
    };
}

function createHandlerOptions(tool: LocalTool, manager: CommandApprovalManager) {
    return {
        commandApprovalManager: manager,
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getToolDefinition: (name: string) => name === 'write_file' ? tool.definition : null,
        getWorkspaceRoot: () => 'C:\\workspace',
        localTools: new Map([['write_file', tool]]),
        log: () => undefined,
        toolRouter: new Map()
    };
}

async function invokeHandler(
    handler: express.RequestHandler,
    body: Record<string, unknown>
): Promise<{ body: unknown; statusCode: number }> {
    let responseBody: unknown;
    let statusCode = 200;
    const response = {
        status(code: number) {
            statusCode = code;
            return response;
        },
        json(value: unknown) {
            responseBody = value;
            return response;
        }
    };
    const request = { body };

    await Promise.resolve(handler(
        request as express.Request,
        response as unknown as express.Response,
        () => undefined
    ));
    return { body: responseBody, statusCode };
}

function readNestedString(value: unknown, parent: string, child: string): string | undefined {
    const nested = readRecord(value)[parent];
    return readString(nested, child);
}

function readString(value: unknown, key: string): string | undefined {
    const candidate = readRecord(value)[key];
    return typeof candidate === 'string' ? candidate : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
        ? value as Record<string, unknown>
        : {};
}
