import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
    DEFAULT_APPROVAL_TTL_SECONDS,
    DEFAULT_BRIDGE_CODE_TTL_SECONDS,
    DEFAULT_BRIDGE_REQUEST_MS,
    DEFAULT_BROWSER_LAUNCH_WAIT_MS,
    DEFAULT_COMMAND_EXECUTION_MS,
    DEFAULT_TOOL_CALL_MS,
    MAX_APPROVAL_TTL_SECONDS,
    MAX_BRIDGE_CODE_TTL_SECONDS,
    MAX_BRIDGE_REQUEST_MS,
    MAX_BROWSER_LAUNCH_WAIT_MS,
    MAX_COMMAND_EXECUTION_MS,
    MAX_TOOL_CALL_MS,
    MIN_APPROVAL_TTL_SECONDS,
    MIN_BRIDGE_CODE_TTL_SECONDS,
    MIN_BRIDGE_REQUEST_MS,
    MIN_BROWSER_LAUNCH_WAIT_MS,
    MIN_COMMAND_EXECUTION_MS,
    MIN_TOOL_CALL_MS,
    resolveApprovalTtlSeconds,
    resolveBridgeCodeTtlSeconds,
    resolveBridgeRequestMs,
    resolveBrowserLaunchWaitMs,
    resolveCommandExecutionMs,
    resolveToolCallMs
} from '../gateway/timeouts';

type TimeoutSchemaEntry = {
    default?: unknown;
    minimum?: unknown;
    maximum?: unknown;
    markdownDescription?: unknown;
    scope?: unknown;
};

type TimeoutObjectSchema = {
    additionalProperties?: unknown;
    properties?: Record<string, TimeoutSchemaEntry>;
};

type TimeoutResolverCase = {
    name: string;
    resolve: (value: unknown) => number;
    defaultValue: number;
    min: number;
    max: number;
};

const TIMEOUT_CASES: readonly TimeoutResolverCase[] = [
    {
        name: 'commandExecutionMs',
        resolve: resolveCommandExecutionMs,
        defaultValue: DEFAULT_COMMAND_EXECUTION_MS,
        min: MIN_COMMAND_EXECUTION_MS,
        max: MAX_COMMAND_EXECUTION_MS
    },
    {
        name: 'toolCallMs',
        resolve: resolveToolCallMs,
        defaultValue: DEFAULT_TOOL_CALL_MS,
        min: MIN_TOOL_CALL_MS,
        max: MAX_TOOL_CALL_MS
    },
    {
        name: 'bridgeCodeTtlSeconds',
        resolve: resolveBridgeCodeTtlSeconds,
        defaultValue: DEFAULT_BRIDGE_CODE_TTL_SECONDS,
        min: MIN_BRIDGE_CODE_TTL_SECONDS,
        max: MAX_BRIDGE_CODE_TTL_SECONDS
    },
    {
        name: 'approvalTtlSeconds',
        resolve: resolveApprovalTtlSeconds,
        defaultValue: DEFAULT_APPROVAL_TTL_SECONDS,
        min: MIN_APPROVAL_TTL_SECONDS,
        max: MAX_APPROVAL_TTL_SECONDS
    },
    {
        name: 'browserLaunchWaitMs',
        resolve: resolveBrowserLaunchWaitMs,
        defaultValue: DEFAULT_BROWSER_LAUNCH_WAIT_MS,
        min: MIN_BROWSER_LAUNCH_WAIT_MS,
        max: MAX_BROWSER_LAUNCH_WAIT_MS
    },
    {
        name: 'bridgeRequestMs',
        resolve: resolveBridgeRequestMs,
        defaultValue: DEFAULT_BRIDGE_REQUEST_MS,
        min: MIN_BRIDGE_REQUEST_MS,
        max: MAX_BRIDGE_REQUEST_MS
    }
];

suite('Gateway timeout resolution', () => {
    test('keeps the documented defaults aligned with the previous hard-coded values', () => {
        assert.strictEqual(DEFAULT_COMMAND_EXECUTION_MS, 60_000);
        assert.strictEqual(DEFAULT_TOOL_CALL_MS, 0);
        assert.strictEqual(DEFAULT_BRIDGE_CODE_TTL_SECONDS, 120);
        assert.strictEqual(DEFAULT_APPROVAL_TTL_SECONDS, 120);
        assert.strictEqual(DEFAULT_BROWSER_LAUNCH_WAIT_MS, 10_000);
        assert.strictEqual(DEFAULT_BRIDGE_REQUEST_MS, 0);
    });

    test('falls back to the default for invalid input', () => {
        const invalidValues: unknown[] = [undefined, null, '60000', true, Number.NaN, Number.POSITIVE_INFINITY];

        for (const timeoutCase of TIMEOUT_CASES) {
            for (const invalidValue of invalidValues) {
                assert.strictEqual(
                    timeoutCase.resolve(invalidValue),
                    timeoutCase.defaultValue,
                    `${timeoutCase.name} should fall back to its default for ${String(invalidValue)}`
                );
            }
        }
    });

    test('keeps exact boundary values unchanged', () => {
        for (const timeoutCase of TIMEOUT_CASES) {
            assert.strictEqual(timeoutCase.resolve(timeoutCase.min), timeoutCase.min, `${timeoutCase.name} min`);
            assert.strictEqual(timeoutCase.resolve(timeoutCase.max), timeoutCase.max, `${timeoutCase.name} max`);
        }
    });

    test('clamps values outside the supported range', () => {
        for (const timeoutCase of TIMEOUT_CASES) {
            assert.strictEqual(
                timeoutCase.resolve(timeoutCase.min - 1),
                timeoutCase.min,
                `${timeoutCase.name} should clamp below the minimum`
            );
            assert.strictEqual(
                timeoutCase.resolve(timeoutCase.max + 1),
                timeoutCase.max,
                `${timeoutCase.name} should clamp above the maximum`
            );
        }
    });

    test('truncates fractional values', () => {
        assert.strictEqual(resolveCommandExecutionMs(60_000.9), 60_000);
        assert.strictEqual(resolveBridgeCodeTtlSeconds(120.7), 120);
        assert.strictEqual(resolveBrowserLaunchWaitMs(9_999.99), 9_999);
    });

    test('keeps zero as a deliberate disabled deadline', () => {
        assert.strictEqual(MIN_TOOL_CALL_MS, 0);
        assert.strictEqual(MIN_BRIDGE_REQUEST_MS, 0);
        assert.strictEqual(resolveToolCallMs(0), 0);
        assert.strictEqual(resolveBridgeRequestMs(0), 0);
        assert.strictEqual(resolveToolCallMs(-1), 0);
        assert.strictEqual(resolveBridgeRequestMs(-1), 0);
    });

    test('matches the contributed configuration schema', () => {
        const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { configuration?: { properties?: Record<string, TimeoutObjectSchema> } };
        };
        const schema = packageJson.contributes?.configuration?.properties?.['webcodeGateway.timeouts'];
        assert.ok(schema, 'webcodeGateway.timeouts must be contributed by the extension');
        assert.strictEqual(schema.additionalProperties, false);

        const properties = schema.properties ?? {};
        assert.deepStrictEqual(
            Object.keys(properties).sort(),
            TIMEOUT_CASES.map(timeoutCase => timeoutCase.name).sort(),
            'contributed keys must match the resolvers under test'
        );

        for (const timeoutCase of TIMEOUT_CASES) {
            const entry = properties[timeoutCase.name];
            assert.ok(entry, `${timeoutCase.name} should be contributed`);
            assert.strictEqual(entry.default, timeoutCase.defaultValue, `${timeoutCase.name} default`);
            assert.strictEqual(entry.minimum, timeoutCase.min, `${timeoutCase.name} minimum`);
            assert.strictEqual(entry.maximum, timeoutCase.max, `${timeoutCase.name} maximum`);
            assert.strictEqual(typeof entry.markdownDescription, 'string', `${timeoutCase.name} needs help text`);
        }

        assert.strictEqual(properties['bridgeCodeTtlSeconds'].scope, 'machine');
        assert.strictEqual(properties['approvalTtlSeconds'].scope, 'machine');
    });
});
