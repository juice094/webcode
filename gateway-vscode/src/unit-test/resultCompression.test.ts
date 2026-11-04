import './vscodeStub';

import * as assert from 'assert';
import type express from 'express';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { createToolCallHandler, type ToolCallHandlerOptions } from '../gateway/toolCallRoute';
import {
    compressToolResultText,
    createResultCompressor,
    resolveCompressionMode,
    resolveMaxResultChars,
    RULE_BUILD_NOISE_STRIP,
    RULE_DUPLICATE_RUN_FOLD,
    RULE_HEAD_TAIL_SUMMARY,
    RULE_WHITESPACE_TRIM,
    type CompressionPolicy
} from '../tools/resultCompression';
import type { LocalTool, ToolExecutionContext, ToolResult } from '../tools';

const SMART_POLICY: CompressionPolicy = { mode: 'smart', maxResultChars: 12_000 };

const DUPLICATE_LINE = 'polling upstream service, attempt pending';
const DUPLICATE_SAMPLE = Array(100).fill(DUPLICATE_LINE).join('\n');

const CHINESE_LINE = '正在等待构建服务就绪，稍后自动重试';
const CHINESE_SAMPLE = Array(100).fill(CHINESE_LINE).join('\n');

function buildBuildLogSample(): string {
    const lines: string[] = [];
    for (let i = 0; i < 100; i += 1) {
        lines.push(`\rBuilding chunk ${i} of 100 ...`);
    }
    for (let i = 0; i <= 100; i += 5) {
        lines.push(`  ${i}% |██░░░░░░| ${i}/100`);
    }
    lines.push('ERROR in ./src/index.ts');
    lines.push("Module not found: Error: Can't resolve './missing' in /repo/src");
    lines.push('webpack compiled with 2 errors');
    return lines.join('\n');
}

function buildHugeJsonSample(): string {
    const records = Array.from({ length: 200 }, (_, index) => ({
        id: index,
        status: 'ok',
        message: 'processed item successfully'
    }));
    return JSON.stringify({ results: records }, null, 2);
}

const CODE_SAMPLE = [
    'export function add(a: number, b: number): number {',
    '    return a + b;',
    '}',
    '',
    'export function subtract(a: number, b: number): number {',
    '    return a - b;',
    '}',
    '',
    'const DEFAULT_RETRY_LIMIT = 3;',
    'for (let attempt = 0; attempt < DEFAULT_RETRY_LIMIT; attempt += 1) {',
    '    await connect(attempt);',
    '}'
].join('\n');

const IDENTITY_PATTERN = /webcode/i;

function reductionPercent(outcome: { inputChars: number; outputChars: number }): number {
    return (outcome.inputChars - outcome.outputChars) / outcome.inputChars;
}

suite('Tool result compression (CW-1..CW-4)', () => {
    test('CW-1 duplicate lines fold with a marker and a large reduction', () => {
        const outcome = compressToolResultText(DUPLICATE_SAMPLE, SMART_POLICY);
        assert.ok(outcome.appliedRules.includes(RULE_DUPLICATE_RUN_FOLD));
        assert.ok(outcome.text.includes('[folded 98 identical lines]'));
        assert.ok(reductionPercent(outcome) >= 0.3, `expected >=30% reduction, got ${reductionPercent(outcome)}`);
        assert.ok(!IDENTITY_PATTERN.test(outcome.text));
    });

    test('CW-1 build log strips carriage-return and progress lines (>=70%)', () => {
        const outcome = compressToolResultText(buildBuildLogSample(), SMART_POLICY);
        assert.ok(outcome.appliedRules.includes(RULE_BUILD_NOISE_STRIP));
        assert.ok(reductionPercent(outcome) >= 0.7, `expected >=70% reduction, got ${reductionPercent(outcome)}`);
        assert.ok(outcome.text.includes('ERROR in ./src/index.ts'), 'error lines must survive');
        assert.ok(!outcome.text.includes('\r'), 'overwrite-mode frames must be stripped');
        assert.ok(!outcome.text.includes('% |'), 'progress furniture lines must be stripped');
    });

    test('CW-1 huge JSON folds and summarizes over the character budget', () => {
        const outcome = compressToolResultText(buildHugeJsonSample(), SMART_POLICY);
        assert.ok(outcome.inputChars > SMART_POLICY.maxResultChars);
        assert.ok(outcome.appliedRules.includes(RULE_HEAD_TAIL_SUMMARY));
        assert.ok(outcome.text.includes('lines omitted'), 'summary must carry the omission count');
        assert.ok(outcome.text.includes('read specific line ranges'), 'summary must carry retrieval guidance');
        assert.ok(outcome.outputChars <= outcome.inputChars * 0.7, `expected >=30% reduction, got ${reductionPercent(outcome)}`);
        assert.ok(outcome.outputChars <= SMART_POLICY.maxResultChars);
    });

    test('CW-1 normal code passes through with zero damage', () => {
        const outcome = compressToolResultText(CODE_SAMPLE, SMART_POLICY);
        assert.deepStrictEqual(outcome.appliedRules, []);
        assert.strictEqual(outcome.text, CODE_SAMPLE);
        assert.strictEqual(outcome.outputChars, outcome.inputChars);
    });

    test('CW-1 chinese text folds repeated lines (>=30%)', () => {
        const outcome = compressToolResultText(CHINESE_SAMPLE, SMART_POLICY);
        assert.ok(outcome.appliedRules.includes(RULE_DUPLICATE_RUN_FOLD));
        assert.ok(reductionPercent(outcome) >= 0.3, `expected >=30% reduction, got ${reductionPercent(outcome)}`);
    });

    test('whitelist lines with paths, hashes, error codes are never folded', () => {
        const pathLine = '    at transform (src/tools/runInTerminalTool.ts:42:17)';
        const sample = [pathLine, pathLine, pathLine, pathLine, 'done'].join('\n');
        const outcome = compressToolResultText(sample, SMART_POLICY);
        assert.deepStrictEqual(outcome.appliedRules, []);
        assert.strictEqual(outcome.text, sample);
    });

    test('CW-2 trim mode only changes trailing whitespace', () => {
        const sample = [
            `const a = 1;${' '.repeat(6)}`,
            '100% |██░░| 4/10',
            DUPLICATE_LINE,
            DUPLICATE_LINE,
            DUPLICATE_LINE
        ].join('\n');
        const outcome = compressToolResultText(sample, { mode: 'trim', maxResultChars: 12_000 });
        assert.deepStrictEqual(outcome.appliedRules, [RULE_WHITESPACE_TRIM]);
        const expected = sample
            .split('\n')
            .map(line => line.replace(/[ \t]+$/, ''))
            .join('\n');
        assert.strictEqual(outcome.text, expected);
        assert.ok(!outcome.text.includes('[folded'), 'trim must not fold');
        assert.ok(outcome.text.includes('100% |██░░| 4/10'), 'trim must not strip build noise');
    });

    test('CW-3 off mode is identity for every sample', () => {
        const samples = [DUPLICATE_SAMPLE, CHINESE_SAMPLE, buildBuildLogSample(), CODE_SAMPLE, 'plain result'];
        for (const sample of samples) {
            const outcome = compressToolResultText(sample, { mode: 'off', maxResultChars: 12_000 });
            assert.strictEqual(outcome.text, sample);
            assert.deepStrictEqual(outcome.appliedRules, []);
            assert.strictEqual(outcome.outputChars, outcome.inputChars);
        }
        assert.strictEqual(createResultCompressor({ mode: 'off', maxResultChars: 12_000 }), null);
    });

    test('CW-4 mode resolution falls back to smart for invalid values', () => {
        assert.strictEqual(resolveCompressionMode('off'), 'off');
        assert.strictEqual(resolveCompressionMode('trim'), 'trim');
        assert.strictEqual(resolveCompressionMode('smart'), 'smart');
        assert.strictEqual(resolveCompressionMode('bogus'), 'smart');
        assert.strictEqual(resolveCompressionMode(undefined), 'smart');
        assert.strictEqual(resolveCompressionMode(42), 'smart');
    });

    test('CW-4 maxResultChars clamps in-range and falls back for invalid values', () => {
        assert.strictEqual(resolveMaxResultChars(5000), 5000);
        assert.strictEqual(resolveMaxResultChars(100), 1000, 'below minimum clamps up');
        assert.strictEqual(resolveMaxResultChars(9_999_999), 524_288, 'above maximum clamps down');
        assert.strictEqual(resolveMaxResultChars('abc'), 12_000);
        assert.strictEqual(resolveMaxResultChars(NaN), 12_000);
        assert.strictEqual(resolveMaxResultChars(Number.POSITIVE_INFINITY), 12_000);
        assert.strictEqual(resolveMaxResultChars(undefined), 12_000);
    });
});

suite('Tool result compression route integration', () => {
    test('smart policy marks the payload compressed with hit rules', async () => {
        const options = createOptions({
            policy: { mode: 'smart', maxResultChars: 12_000 },
            toolText: DUPLICATE_SAMPLE
        });
        const response = await invokeHandler(createToolCallHandler(options), { name: 'compressible_tool', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        const body = response.body as Record<string, unknown>;
        assert.strictEqual(body.compressed, true);
        const compression = body.compression as { rules: string[]; inputChars: number; outputChars: number };
        assert.ok(compression.rules.includes(RULE_DUPLICATE_RUN_FOLD));
        assert.ok(compression.outputChars < compression.inputChars);
        const text = (body.content as Array<{ text: string }>)[0].text;
        assert.ok(text.includes('[folded 98 identical lines]'));
        assert.ok(!IDENTITY_PATTERN.test(text), 'model-facing compressed text must stay identity-free');
    });

    test('bootstrap tool results (init context payload) are never compressed', async () => {
        const options = createOptions({
            policy: { mode: 'smart', maxResultChars: 12_000 },
            toolText: DUPLICATE_SAMPLE,
            toolName: 'list_tools'
        });
        const response = await invokeHandler(createToolCallHandler(options), { name: 'list_tools', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        const body = response.body as Record<string, unknown>;
        assert.strictEqual(body.compressed, undefined, 'bootstrap results feed the Available Tools list and must stay verbatim');
        const text = (body.content as Array<{ text: string }>)[0].text;
        assert.strictEqual(text, DUPLICATE_SAMPLE);
    });

    test('off policy sends the result unchanged without compression metadata', async () => {
        const options = createOptions({
            policy: { mode: 'off', maxResultChars: 12_000 },
            toolText: DUPLICATE_SAMPLE
        });
        const response = await invokeHandler(createToolCallHandler(options), { name: 'compressible_tool', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        const body = response.body as Record<string, unknown>;
        assert.strictEqual(body.compressed, undefined);
        const text = (body.content as Array<{ text: string }>)[0].text;
        assert.strictEqual(text, DUPLICATE_SAMPLE);
    });

    test('trim policy only trims whitespace and still reports compression', async () => {
        const toolText = 'line one   \nline two\t\n';
        const options = createOptions({
            policy: { mode: 'trim', maxResultChars: 12_000 },
            toolText
        });
        const response = await invokeHandler(createToolCallHandler(options), { name: 'compressible_tool', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        const body = response.body as Record<string, unknown>;
        assert.strictEqual(body.compressed, true);
        const compression = body.compression as { rules: string[] };
        assert.deepStrictEqual(compression.rules, [RULE_WHITESPACE_TRIM]);
        const text = (body.content as Array<{ text: string }>)[0].text;
        assert.strictEqual(text, 'line one\nline two\n');
    });

    test('a result the compressor leaves untouched keeps its exact shape', async () => {
        const options = createOptions({
            policy: { mode: 'smart', maxResultChars: 12_000 },
            toolText: CODE_SAMPLE
        });
        const response = await invokeHandler(createToolCallHandler(options), { name: 'compressible_tool', arguments: {} });

        assert.strictEqual(response.statusCode, 200);
        const body = response.body as Record<string, unknown>;
        assert.strictEqual(body.compressed, undefined);
        const text = (body.content as Array<{ text: string }>)[0].text;
        assert.strictEqual(text, CODE_SAMPLE);
    });
});

function createOptions(overrides: { policy: CompressionPolicy; toolText: string; toolName?: string }): ToolCallHandlerOptions {
    const toolName = overrides.toolName ?? 'compressible_tool';
    const localTool: LocalTool = {
        definition: {
            name: toolName,
            description: 'test tool',
            inputSchema: { type: 'object', properties: {} }
        },
        execute: () => Promise.resolve({ content: [{ type: 'text', text: overrides.toolText }] } satisfies ToolResult)
    };
    const localTools = new Map<string, LocalTool>();
    localTools.set(localTool.definition.name, localTool);

    return {
        commandApprovalManager: new CommandApprovalManager(),
        createToolExecutionContext: () => ({}) as ToolExecutionContext,
        error: () => undefined,
        getCompressionPolicy: () => overrides.policy,
        getToolCallTimeoutMs: () => 0,
        getToolDefinition: name => localTool.definition.name === name ? localTool.definition : null,
        getWorkspaceRoot: () => process.cwd(),
        localTools,
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

    await Promise.resolve(handler(
        { body } as express.Request,
        response as unknown as express.Response,
        () => undefined
    ));
    return { body: responseBody, statusCode };
}
