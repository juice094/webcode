import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createPersistentLogger, LOG_FILE_PATTERN, LOG_RETENTION_DAYS } from '../extension/persistentLog';

suite('Persistent gateway logger', () => {
    test('writes dated log files with level prefixes and error stacks', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-log-'));
        try {
            const logger = createPersistentLogger(root);
            logger.info('hello info');
            logger.warn('hello warn');
            logger.error('boom', new Error('kaboom'));

            const file = logger.currentLogPath;
            assert.ok(file, 'expected a log file to be created');
            assert.ok(LOG_FILE_PATTERN.test(path.basename(file)), `unexpected log name: ${file}`);
            assert.strictEqual(path.dirname(file), path.join(root, 'logs'));

            const content = fs.readFileSync(file, 'utf8');
            assert.match(content, /\[INFO\] hello info/);
            assert.match(content, /\[WARN\] hello warn/);
            assert.match(content, /\[ERROR\] boom: kaboom/);
            assert.match(content, /Error: kaboom/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('never throws when the storage location is unusable', () => {
        const blocked = path.join(os.tmpdir(), `webcode-log-blocked-${process.pid}-${Date.now()}.tmp`);
        fs.writeFileSync(blocked, 'i am a regular file, not a directory');
        try {
            const logger = createPersistentLogger(blocked);
            logger.info('this write must be swallowed');
            logger.error('so must this', new Error('hidden'));
            assert.strictEqual(logger.currentLogPath, null);
        } finally {
            fs.unlinkSync(blocked);
        }
    });

    test('prunes log files older than the retention window', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-log-'));
        try {
            const logs = path.join(root, 'logs');
            fs.mkdirSync(logs);

            const oldFile = path.join(logs, 'gateway-20200101.log');
            fs.writeFileSync(oldFile, 'old entry');
            const oldTime = new Date(Date.now() - (LOG_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
            fs.utimesSync(oldFile, oldTime, oldTime);

            const unrelatedFile = path.join(logs, 'unrelated.txt');
            fs.writeFileSync(unrelatedFile, 'keep me');

            const logger = createPersistentLogger(root);
            logger.info('trigger prune');

            assert.ok(!fs.existsSync(oldFile), 'expired gateway log was not pruned');
            assert.ok(fs.existsSync(unrelatedFile), 'unrelated files must survive pruning');
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
