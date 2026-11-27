import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

import {
    createGatewayEventStream,
    GATEWAY_EVENT_SCOPE,
    namespaceOf,
    type GatewayEventEnvelope
} from '../gateway/eventStream';

/**
 * S4 事件流单测（打桩 sendBatch/时钟，不投递网络）。
 *
 * 断言的是「网关侧规范」：命名空间/seq 连续、信封字段、spool 逐行落盘、
 * 满批 flush 与失败降级；插件侧写库/回放在 dsh-ext 的 node:test 覆盖。
 */

const INSTANCE = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = 'abcdef0123456789';
const TOKEN_A = 'session-token-a';
const TOKEN_B = 'session-token-b';

function digest(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function tempSpoolDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-events-'));
}

function readSpool(dir: string): GatewayEventEnvelope[] {
    const file = path.join(dir, `${INSTANCE}.jsonl`);
    return fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as GatewayEventEnvelope);
}

suite('S4 gateway event stream', () => {
    let spoolDir = '';

    setup(() => {
        spoolDir = tempSpoolDir();
    });

    teardown(() => {
        fs.rmSync(spoolDir, { recursive: true, force: true });
    });

    test('namespace：会话 token 走 sha256 摘要，无 token 走网关作用域', () => {
        assert.strictEqual(namespaceOf(TOKEN_A), digest(TOKEN_A));
        assert.strictEqual(namespaceOf(undefined), GATEWAY_EVENT_SCOPE);
        assert.notStrictEqual(digest(TOKEN_A), digest(TOKEN_B));
    });

    test('seq：每个命名空间从 1 连续，命名空间互不串号', () => {
        const stream = createGatewayEventStream({
            gatewayInstanceId: INSTANCE,
            workspaceId: WORKSPACE,
            spoolDir,
            log: () => undefined
        });
        stream.emit('gateway/started', { data: { port: 34567 } });
        stream.emit('tool/call', { sessionToken: TOKEN_A, data: { callId: 'c1' } });
        stream.emit('tool/result', { sessionToken: TOKEN_A, data: { callId: 'c1' } });
        stream.emit('tool/call', { sessionToken: TOKEN_B, data: { callId: 'c2' } });

        const snapshot = stream.snapshot();
        assert.deepStrictEqual(snapshot.streams, [
            { sessionRef: GATEWAY_EVENT_SCOPE, lastSeq: 1, eventCount: 1 },
            { sessionRef: digest(TOKEN_A), lastSeq: 2, eventCount: 2 },
            { sessionRef: digest(TOKEN_B), lastSeq: 1, eventCount: 1 }
        ].sort((left, right) => left.sessionRef.localeCompare(right.sessionRef)));
    });

    test('信封与 spool：一行一个信封，字段与规范键一致（token 不落盘）', () => {
        const stream = createGatewayEventStream({
            gatewayInstanceId: INSTANCE,
            workspaceId: WORKSPACE,
            spoolDir,
            now: () => 1764300000000,
            log: () => undefined
        });
        stream.emit('session/activated', { sessionToken: TOKEN_A, data: { siteId: 'chatgpt' } });

        const [envelope] = readSpool(spoolDir);
        assert.strictEqual(envelope.v, 1);
        assert.strictEqual(envelope.gatewayInstanceId, INSTANCE);
        assert.strictEqual(envelope.workspaceId, WORKSPACE);
        assert.strictEqual(envelope.sessionRef, digest(TOKEN_A));
        assert.strictEqual(envelope.seq, 1);
        assert.strictEqual(envelope.type, 'session/activated');
        assert.strictEqual(envelope.timeMs, 1764300000000);
        assert.deepStrictEqual(envelope.data, { siteId: 'chatgpt' });

        const raw = fs.readFileSync(path.join(spoolDir, `${INSTANCE}.jsonl`), 'utf8');
        assert.ok(!raw.includes(TOKEN_A), 'spool 不得出现原始 token');
        assert.ok(raw.endsWith('\n'));
    });

    test('投递：满批即 flush，一批一个请求体，dispose 排空剩余', async () => {
        const batches: GatewayEventEnvelope[][] = [];
        const stream = createGatewayEventStream({
            gatewayInstanceId: INSTANCE,
            workspaceId: WORKSPACE,
            spoolDir,
            batchSize: 2,
            flushIntervalMs: 60_000,
            log: () => undefined,
            sendBatch: (body) => {
                batches.push((JSON.parse(body) as { events: GatewayEventEnvelope[] }).events);
                return Promise.resolve({ status: 200 });
            }
        });
        stream.emit('a', {});
        stream.emit('b', {});
        stream.emit('c', {});
        await stream.dispose();

        assert.strictEqual(batches.length, 2, '两批：满 2 条 + 剩余 1 条');
        assert.deepStrictEqual(batches[0].map(event => event.type), ['a', 'b']);
        assert.deepStrictEqual(batches[1].map(event => event.type), ['c']);
        assert.strictEqual(readSpool(spoolDir).length, 3, 'spool 与内存事件数一致');
    });

    test('降级：投递持续失败不抛错、spool 完整、最终仍能对账', async () => {
        const logs: string[] = [];
        let attempts = 0;
        const stream = createGatewayEventStream({
            gatewayInstanceId: INSTANCE,
            workspaceId: WORKSPACE,
            spoolDir,
            batchSize: 1,
            flushIntervalMs: 60_000,
            retryDelaysMs: [1, 1],
            log: line => logs.push(line),
            sendBatch: () => {
                attempts += 1;
                return Promise.resolve({ status: 503 });
            }
        });
        stream.emit('tool/call', { sessionToken: TOKEN_A });
        await stream.dispose();

        assert.strictEqual(attempts, 3, '首次 + 2 次重试');
        assert.ok(logs.some(line => line.includes('投递失败')), logs.join(' | '));
        assert.strictEqual(readSpool(spoolDir).length, 1, 'spool 兜底保留');
        assert.strictEqual(stream.snapshot().streams[0].lastSeq, 1);
    });

    test('无投递端：只落 spool，不排队不报错', async () => {
        const stream = createGatewayEventStream({
            gatewayInstanceId: INSTANCE,
            workspaceId: WORKSPACE,
            spoolDir,
            log: () => undefined
        });
        stream.emit('gateway/started', {});
        await stream.flush();
        await stream.dispose();
        assert.strictEqual(readSpool(spoolDir).length, 1);
    });
});
