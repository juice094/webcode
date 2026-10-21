import * as assert from 'assert';
import * as path from 'path';
import type * as vscode from 'vscode';

import { resolveCommandDenyRules } from '../extension/commandDenyRules';
import { assessShellCommandRisk } from '../servers/commandRisk';
import { normalizeDenyText } from '../servers/commandDenyRules';
import { assessTerminalCommandRisk } from '../servers/terminalCommandRisk';

const WORKSPACE = path.resolve(process.cwd(), 'workspace');

function riskContext(denyRules?: string[], allowedRoots?: string[]) {
    return {
        workspaceRoot: WORKSPACE,
        cwd: WORKSPACE,
        denyRules,
        allowedRoots,
        platform: process.platform
    };
}

function createOutputChannel(messages: string[]): vscode.OutputChannel {
    return {
        appendLine(message: string) {
            messages.push(message);
        }
    } as unknown as vscode.OutputChannel;
}

suite('Command deny rules', () => {
    test('blocks a command that matches a rule', () => {
        const assessment = assessShellCommandRisk('git push origin main', riskContext(['git push']));
        assert.strictEqual(assessment.level, 'blocked');
        assert.ok(assessment.reasons.some(reason => reason.includes('git push')));
    });

    test('blocks through the entry point both tools use', () => {
        for (const shellKind of ['posix', 'powershell'] as const) {
            const assessment = assessTerminalCommandRisk(
                'git push origin main',
                shellKind,
                riskContext(['git push'])
            );
            assert.strictEqual(assessment.level, 'blocked', `deny must apply for ${shellKind}`);
        }
    });

    test('leaves unrelated commands alone', () => {
        const assessment = assessShellCommandRisk('git status', riskContext(['git push']));
        assert.strictEqual(assessment.level, 'allowed');
        assert.deepStrictEqual(assessment.reasons, []);
    });

    test('normalizes case and repeated whitespace before matching', () => {
        assert.strictEqual(normalizeDenyText('  GIT   PUSH\torigin '), 'git push origin');
        const assessment = assessShellCommandRisk('git   push origin', riskContext(['GIT PUSH']));
        assert.strictEqual(assessment.level, 'blocked');
    });

    test('matches substrings, including inside arguments', () => {
        // Documented cost of substring matching: a short rule also hits unrelated
        // commands. Users are expected to use distinctive rules.
        const assessment = assessShellCommandRisk('git commit -m "test"', riskContext(['test']));
        assert.strictEqual(assessment.level, 'blocked');
    });

    test('joins built-in blocking reasons without duplicating them', () => {
        const assessment = assessShellCommandRisk('sudo apt-get install curl', riskContext(['sudo apt']));
        assert.strictEqual(assessment.level, 'blocked');
        assert.deepStrictEqual(
            assessment.reasons,
            ['Command matches the configured deny rule "sudo apt".'],
            'a deny hit short-circuits and does not repeat the built-in reason'
        );
    });

    test('covers commands nested inside a shell', () => {
        const assessment = assessShellCommandRisk(
            `bash -c 'git push --force'`,
            riskContext(['git push --force'])
        );
        assert.strictEqual(assessment.level, 'blocked');
    });

    test('is not weakened by trusted command roots', () => {
        const outsideRoot = path.dirname(WORKSPACE);
        const assessment = assessShellCommandRisk(
            'pnpm publish',
            riskContext(['pnpm publish'], [outsideRoot])
        );
        assert.strictEqual(assessment.level, 'blocked');
    });

    test('keeps the existing policy when no rule is configured', () => {
        for (const denyRules of [[], undefined]) {
            assert.strictEqual(assessShellCommandRisk('git status', riskContext(denyRules)).level, 'allowed');
            assert.strictEqual(assessShellCommandRisk('sudo rm x', riskContext(denyRules)).level, 'blocked');
            assert.strictEqual(
                assessShellCommandRisk(`node -e "1"`, riskContext(denyRules)).level,
                'requires_confirmation'
            );
        }
    });

    test('resolves configured rules by trimming, deduplicating and warning', () => {
        const messages: string[] = [];
        const rules = resolveCommandDenyRules(
            [' git push ', 'GIT PUSH', '', 42, 'ab', 'x'.repeat(201), 'pnpm publish'],
            createOutputChannel(messages)
        );

        assert.deepStrictEqual(rules, ['git push', 'ab', 'pnpm publish']);
        assert.ok(messages.some(message => message.includes('non-string')), 'non-string entry must warn');
        assert.ok(messages.some(message => message.includes('"ab"')), 'short rule must warn');
        assert.ok(messages.some(message => message.includes('longer than')), 'over-long rule must warn');
    });

    test('returns no rules for a malformed setting value', () => {
        const messages: string[] = [];
        assert.deepStrictEqual(resolveCommandDenyRules('git push', createOutputChannel(messages)), []);
        assert.deepStrictEqual(resolveCommandDenyRules(undefined, createOutputChannel(messages)), []);
        assert.deepStrictEqual(messages, []);
    });
});
