import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    APPROVAL_AUDIT_VERSION,
    MAX_AUDIT_COMMAND_LENGTH,
    formatApprovalAuditEvent
} from '../gateway/approvalAudit';
import { auditEvent } from '../gateway/approvalAuditEvents';
import { createApprovalAuditLog } from '../extension/approvalAuditLog';
import { LOG_RETENTION_DAYS } from '../extension/persistentLog';

function readLines(file: string): string[] {
    return fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '');
}

function parseLine(line: string): Record<string, unknown> {
    return JSON.parse(line) as Record<string, unknown>;
}

suite('Approval audit log', () => {
    test('writes one parseable JSON line per event', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-audit-'));
        try {
            const log = createApprovalAuditLog(root);
            log.append(auditEvent('challenge_issued', {
                name: 'execute_command',
                internalCallId: 'call-1',
                args: { command: 'git status', path: '.', profile: 'git-bash' }
            }, { level: 'requires_confirmation', challengeId: 'challenge-1' }));

            const directory = path.join(root, 'logs');
            const files = fs.readdirSync(directory).filter(name => name.startsWith('approvals-'));
            assert.strictEqual(files.length, 1, 'expected exactly one audit file');
            assert.match(files[0], /^approvals-\d{8}\.jsonl$/);

            const lines = readLines(path.join(directory, files[0]));
            assert.strictEqual(lines.length, 1);
            const parsed = parseLine(lines[0]);
            assert.strictEqual(parsed.v, APPROVAL_AUDIT_VERSION);
            assert.strictEqual(parsed.event, 'challenge_issued');
            assert.strictEqual(parsed.toolName, 'execute_command');
            assert.strictEqual(parsed.requestId, 'call-1');
            assert.strictEqual(parsed.challengeId, 'challenge-1');
            assert.strictEqual(parsed.level, 'requires_confirmation');
            assert.match(String(parsed.ts), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('keeps a normal command intact and truncates only long ones', () => {
        const longCommand = `echo ${'a'.repeat(300)}`;
        const short = auditEvent('execution_finished', { name: 'execute_command', args: { command: longCommand } });
        const formattedShort = parseLine(formatApprovalAuditEvent(short));
        assert.strictEqual(formattedShort.command, longCommand, 'a 300 character command must not be truncated');
        assert.strictEqual(formattedShort.commandTruncated, undefined);

        const huge = `echo ${'b'.repeat(MAX_AUDIT_COMMAND_LENGTH)}`;
        const formattedHuge = parseLine(formatApprovalAuditEvent(
            auditEvent('execution_finished', { name: 'execute_command', args: { command: huge } })
        ));
        assert.strictEqual(String(formattedHuge.command).length, MAX_AUDIT_COMMAND_LENGTH);
        assert.strictEqual(formattedHuge.commandTruncated, true);
    });

    test('never records tool argument payloads', () => {
        const event = auditEvent('execution_finished', {
            name: 'write_file',
            args: { path: 'src/app.ts', content: 'SECRET-CONTENT', token: 'SECRET-TOKEN' }
        }, { status: 'success', durationMs: 12 });

        const line = formatApprovalAuditEvent(event);
        assert.ok(!line.includes('SECRET-CONTENT'), 'file contents must never reach the audit log');
        assert.ok(!line.includes('SECRET-TOKEN'), 'unexpected argument values must never reach the audit log');
        assert.strictEqual(parseLine(line).path, 'src/app.ts');
    });

    test('drops fields outside the whitelist, including an approval token', () => {
        const event = auditEvent('grant_issued', null, { challengeId: 'challenge-1' });
        const polluted = { ...event, approvalToken: 'token-SECRET', arguments: { command: 'rm -rf /' } };
        const line = formatApprovalAuditEvent(polluted);

        assert.ok(!line.includes('token-SECRET'), 'the approval token must never be serialized');
        assert.ok(!line.includes('rm -rf'), 'tool arguments must never be serialized');
        assert.deepStrictEqual(
            Object.keys(parseLine(line)).sort(),
            ['challengeId', 'event', 'toolName', 'ts', 'v']
        );
    });

    test('writes every event on its own line', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-audit-'));
        try {
            const log = createApprovalAuditLog(root);
            log.append(auditEvent('blocked', { name: 'execute_command', args: { command: 'rm -rf .' } }, {
                level: 'blocked',
                reasons: ['dangerous']
            }));
            log.append(auditEvent('execution_finished', { name: 'execute_command', args: { command: 'ls' } }, {
                status: 'success'
            }));

            const lines = readLines(path.join(log.directory, fs.readdirSync(log.directory)[0]));
            assert.strictEqual(lines.length, 2);
            for (const line of lines) {
                assert.ok(!line.includes('\n'));
                parseLine(line);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('prunes expired audit files without touching unrelated files', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-audit-'));
        try {
            const directory = path.join(root, 'logs');
            fs.mkdirSync(directory);
            const expired = new Date(Date.now() - (LOG_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);

            const oldAudit = path.join(directory, 'approvals-20200101.jsonl');
            fs.writeFileSync(oldAudit, '{}\n');
            fs.utimesSync(oldAudit, expired, expired);
            const oldGatewayLog = path.join(directory, 'gateway-20200101.log');
            fs.writeFileSync(oldGatewayLog, 'old\n');
            fs.utimesSync(oldGatewayLog, expired, expired);
            const unrelated = path.join(directory, 'notes.txt');
            fs.writeFileSync(unrelated, 'keep me');

            createApprovalAuditLog(root).append(
                auditEvent('execution_finished', { name: 'execute_command', args: { command: 'ls' } })
            );

            assert.ok(!fs.existsSync(oldAudit), 'expired audit file was not pruned');
            assert.ok(!fs.existsSync(oldGatewayLog), 'gateway log retention behavior must not change');
            assert.ok(fs.existsSync(unrelated), 'unrelated files must survive pruning');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
