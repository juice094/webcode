import * as assert from 'assert';

import { BridgeSessionManager } from '../gateway/bridgeSession';

suite('Bridge session security', () => {
    test('issues short-lived bridge codes that can be consumed only once', () => {
        let now = 1000;
        const secrets = ['bridge-code'];
        const manager = new BridgeSessionManager(100, () => now, () => secrets.shift() ?? 'fallback');
        const launch = { siteId: 'chatgpt', targetUrl: 'https://chatgpt.com/' };

        const code = manager.issueBridgeCode(launch);
        assert.strictEqual(code, 'bridge-code');
        assert.deepStrictEqual(manager.getBridgeLaunch(code), launch);
        assert.deepStrictEqual(manager.consumeBridgeCode(code), launch);
        assert.strictEqual(manager.consumeBridgeCode(code), null);

        const expiringCode = manager.issueBridgeCode(launch);
        now += 101;
        assert.strictEqual(manager.getBridgeLaunch(expiringCode), null);
        assert.strictEqual(manager.consumeBridgeCode(expiringCode), null);
    });

    test('mints a fresh token for every redemption so browsers pair independently', () => {
        const secrets = ['session-one', 'session-two', 'session-three'];
        const manager = new BridgeSessionManager(100, Date.now, () => secrets.shift() ?? 'fallback');

        const firstToken = manager.activateSession({ siteId: 'chatgpt' });
        const secondToken = manager.activateSession({ siteId: 'chatgpt' });

        assert.strictEqual(firstToken, 'session-one');
        assert.strictEqual(secondToken, 'session-two');
        assert.notStrictEqual(firstToken, secondToken);
        assert.strictEqual(manager.isSessionTokenValid(firstToken), true);
        assert.strictEqual(manager.isSessionTokenValid(secondToken), true);
        assert.strictEqual(manager.isSessionTokenValid('session-three'), false);
        assert.strictEqual(manager.getSessionCount(), 2);

        manager.clear();
        assert.strictEqual(manager.isSessionTokenValid(firstToken), false);
        assert.strictEqual(manager.isSessionTokenValid(secondToken), false);
    });

    test('rotating the table revokes every session and reports the revoked tokens', () => {
        const secrets = ['session-one', 'session-two'];
        const manager = new BridgeSessionManager(100, Date.now, () => secrets.shift() ?? 'fallback');

        const firstToken = manager.activateSession();
        const secondToken = manager.activateSession();
        const revoked = manager.rotateAllSessions();

        assert.deepStrictEqual([...revoked].sort(), [firstToken, secondToken].sort());
        assert.strictEqual(manager.hasActiveSession(), false);
        assert.strictEqual(manager.isSessionTokenValid(firstToken), false);
        assert.strictEqual(manager.isSessionTokenValid(secondToken), false);
    });

    test('sweeps sessions silent past the idle timeout and keeps fresh ones', () => {
        let now = 10_000;
        const secrets = ['stale-session', 'fresh-session'];
        const idleTimeoutMs = 30 * 60 * 1000;
        const manager = new BridgeSessionManager(100, () => now, () => secrets.shift() ?? 'fallback');
        manager.setSessionIdleTimeoutMs(idleTimeoutMs);

        const staleToken = manager.activateSession();
        now += idleTimeoutMs + 1;

        assert.deepStrictEqual(manager.sweepExpiredSessions(), [staleToken]);
        assert.strictEqual(manager.isSessionTokenValid(staleToken), false);

        const freshToken = manager.activateSession();
        assert.strictEqual(manager.isSessionTokenValid(freshToken), true);
        assert.strictEqual(manager.getSessionCount(), 1);
    });

    test('redemption evicts expired sessions before registering the new one', () => {
        let now = 10_000;
        const secrets = ['stale-session', 'fresh-session'];
        const idleTimeoutMs = 30 * 60 * 1000;
        const manager = new BridgeSessionManager(100, () => now, () => secrets.shift() ?? 'fallback');
        manager.setSessionIdleTimeoutMs(idleTimeoutMs);

        manager.activateSession();
        now += idleTimeoutMs + 1;
        const freshToken = manager.activateSession();

        assert.strictEqual(manager.isSessionTokenValid(freshToken), true);
        assert.strictEqual(manager.getSessionCount(), 1, 'the expired session must be gone before the new one lands');
    });

    test('an idle timeout of 0 never expires sessions', () => {
        let now = 10_000;
        const manager = new BridgeSessionManager(100, () => now, () => 'session-token');
        manager.setSessionIdleTimeoutMs(0);

        const token = manager.activateSession();
        now += 365 * 24 * 60 * 60 * 1000;

        assert.deepStrictEqual(manager.sweepExpiredSessions(), []);
        assert.strictEqual(manager.isSessionTokenValid(token), true);
    });

    test('a lookup hit refreshes lastSeenAt and defers the sweep', () => {
        let now = 10_000;
        const secrets = ['session-token'];
        const idleTimeoutMs = 30 * 60 * 1000;
        const manager = new BridgeSessionManager(100, () => now, () => secrets.shift() ?? 'fallback');
        manager.setSessionIdleTimeoutMs(idleTimeoutMs);

        const token = manager.activateSession();
        now += idleTimeoutMs - 1;
        assert.strictEqual(manager.isSessionTokenValid(token), true, 'the lookup must refresh lastSeenAt');

        // One millisecond past the ORIGINAL expiry, but only 1 ms since the
        // refresh: the session must survive.
        now += 2;
        assert.deepStrictEqual(manager.sweepExpiredSessions(), []);

        now += idleTimeoutMs;
        assert.deepStrictEqual(manager.sweepExpiredSessions(), [token]);
    });

    test('imports restored and legacy tokens without minting new ones', () => {
        const manager = new BridgeSessionManager(100, Date.now, () => 'should-not-be-used');

        manager.importSessions([
            { token: 'restored-token', siteId: 'chatgpt', connectedAt: 1000, lastSeenAt: 2000 }
        ]);
        manager.setSessionToken('legacy-token');

        assert.strictEqual(manager.getSessionCount(), 2);
        assert.strictEqual(manager.isSessionTokenValid('restored-token'), true);
        assert.strictEqual(manager.isSessionTokenValid('legacy-token'), true);
        // Re-importing the same tokens must not duplicate them.
        manager.setSessionToken('legacy-token');
        assert.strictEqual(manager.getSessionCount(), 2);
    });
});
