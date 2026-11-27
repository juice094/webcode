import * as assert from 'assert';
import http from 'http';
import type { AddressInfo } from 'net';

import { createDshPairingUI, PAIRING_BRIDGE_DEFAULTS } from '../host/dshHost';
import type { SessionRequestPrompt } from '../gateway/pairingRoutes';

const PROMPT: SessionRequestPrompt = {
    requestOrigin: 'https://chatgpt.com',
    siteName: 'ChatGPT',
    workspaceName: 'main'
};

const silentSink = (): void => undefined;

type Captured = { body: Record<string, unknown>; headers: http.IncomingHttpHeaders };

/** 起一个在 127.0.0.1 随机端口的 mock 审批端点；handler 决定应答。 */
async function startMockBridge(
    handler: (captured: Captured, res: http.ServerResponse) => void
): Promise<{ url: string; captured: Captured[]; close: () => Promise<void> }> {
    const captured: Captured[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            captured.push({ body: JSON.parse(body) as Record<string, unknown>, headers: req.headers });
            handler(captured[captured.length - 1], res);
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        url: `http://127.0.0.1:${port}/v1/pairing/confirm`,
        captured,
        close: () => new Promise<void>(resolve => server.close(() => resolve()))
    };
}

suite('DSH pairing bridge (S3)', () => {
    test('批准：dsh 端点回 approved=true → 确认通过，且询问体带全字段与一次性 nonce', async () => {
        const bridge = await startMockBridge((_captured, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ approved: true }));
        });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 2000 });
            assert.strictEqual(await ui.confirmSessionRequest(PROMPT), true);
            assert.strictEqual(bridge.captured.length, 1);
            const body = bridge.captured[0].body;
            assert.strictEqual(body.siteName, PROMPT.siteName);
            assert.strictEqual(body.requestOrigin, PROMPT.requestOrigin);
            assert.strictEqual(body.workspaceName, PROMPT.workspaceName);
            assert.strictEqual(typeof body.nonce, 'string');
            assert.ok((body.nonce as string).length >= 16, 'nonce 应有足够熵');
            assert.match(bridge.captured[0].headers['content-type'] ?? '', /application\/json/);
        } finally {
            await bridge.close();
        }
    });

    test('nonce 一次性：两次询问的 nonce 不同', async () => {
        const bridge = await startMockBridge((_captured, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ approved: true }));
        });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 2000 });
            await ui.confirmSessionRequest(PROMPT);
            await ui.confirmSessionRequest(PROMPT);
            assert.strictEqual(bridge.captured.length, 2);
            assert.notStrictEqual(bridge.captured[0].body.nonce, bridge.captured[1].body.nonce);
        } finally {
            await bridge.close();
        }
    });

    test('拒绝：approved=false 原样映射，reason 只进日志不进返回值', async () => {
        const bridge = await startMockBridge((_captured, res) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ approved: false, reason: '用户拒绝' }));
        });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 2000 });
            assert.strictEqual(await ui.confirmSessionRequest(PROMPT), false);
        } finally {
            await bridge.close();
        }
    });

    test('默认拒绝：桥 HTTP 500 → 拒绝', async () => {
        const bridge = await startMockBridge((_captured, res) => {
            res.writeHead(500);
            res.end('boom');
        });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 2000 });
            assert.strictEqual(await ui.confirmSessionRequest(PROMPT), false);
        } finally {
            await bridge.close();
        }
    });

    test('默认拒绝：桥应答非 JSON → 拒绝', async () => {
        const bridge = await startMockBridge((_captured, res) => {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('<html>not json</html>');
        });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 2000 });
            assert.strictEqual(await ui.confirmSessionRequest(PROMPT), false);
        } finally {
            await bridge.close();
        }
    });

    test('默认拒绝：桥不应答 → 超时拒绝且不挂起', async () => {
        const bridge = await startMockBridge(() => { /* 永不应答 */ });
        try {
            const ui = createDshPairingUI('reject', silentSink, { url: bridge.url, timeoutMs: 200 });
            const started = Date.now();
            assert.strictEqual(await ui.confirmSessionRequest(PROMPT), false);
            const elapsed = Date.now() - started;
            assert.ok(elapsed < 3000, `超时拒绝应有界（实际 ${elapsed}ms）`);
        } finally {
            await bridge.close();
        }
    });

    test('默认拒绝：桥不可达（端口无人监听）→ 立即拒绝', async () => {
        // 先占一个端口再关掉，拿到一个确定无人监听的端口号。
        const probe = await startMockBridge((_c, res) => res.end());
        await probe.close();
        const ui = createDshPairingUI('reject', silentSink, { url: probe.url, timeoutMs: 2000 });
        assert.strictEqual(await ui.confirmSessionRequest(PROMPT), false);
    });

    test('无桥时退回 env 策略：approve 批准、reject 拒绝（过渡形态不回归）', async () => {
        assert.strictEqual(await createDshPairingUI('approve', silentSink).confirmSessionRequest(PROMPT), true);
        assert.strictEqual(await createDshPairingUI('reject', silentSink).confirmSessionRequest(PROMPT), false);
    });

    test('默认超时上限常量为 120s（人机等待有界）', () => {
        assert.strictEqual(PAIRING_BRIDGE_DEFAULTS.timeoutMs, 120_000);
    });
});
