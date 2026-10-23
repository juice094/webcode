import './vscodeStub';

import * as assert from 'assert';

import { CommandApprovalManager } from '../gateway/commandApproval';
import { SlidingWindowRateLimiter } from '../gateway/rateLimit';
import { matchesPattern } from '../tools/filesystemUtils';

suite('glob compile cache (D1)', () => {
    test('keeps matching semantics across repeated calls', () => {
        for (let round = 0; round < 3; round++) {
            assert.strictEqual(matchesPattern('src/app.ts', '**/*.ts'), true);
            assert.strictEqual(matchesPattern('src/app.js', '**/*.ts'), false);
            assert.strictEqual(matchesPattern('A.TS', '**/*.ts'), true, 'default is case-insensitive');
            assert.strictEqual(matchesPattern('A.TS', '**/*.ts', true), false, 'case-sensitive must not reuse the cached regex');
        }
    });

    test('still honours brace alternation', () => {
        assert.strictEqual(matchesPattern('a.js', '*.{js,ts}'), true);
        assert.strictEqual(matchesPattern('a.ts', '*.{js,ts}'), true);
        assert.strictEqual(matchesPattern('a.md', '*.{js,ts}'), false);
    });
});

suite('rate limiter memory (D2)', () => {
    test('allows up to the limit then reports retry-after', () => {
        let now = 1_000;
        const limiter = new SlidingWindowRateLimiter(2, 1_000, () => now);

        assert.deepStrictEqual(limiter.consume('k'), { allowed: true });
        now += 100;
        assert.deepStrictEqual(limiter.consume('k'), { allowed: true });
        now += 100;
        const denied = limiter.consume('k');
        assert.strictEqual(denied.allowed, false);
        assert.ok(denied.allowed === false && denied.retryAfterMs > 0);
    });

    test('drops keys whose hits have all expired', () => {
        let now = 1_000;
        // Sweep every 10 calls so the test can trigger it precisely instead of
        // making 1024 calls to reach the production cadence.
        const limiter = new SlidingWindowRateLimiter(5, 1_000, () => now, 10);

        for (let index = 0; index < 100; index++) {
            limiter.consume(`rotating-${index}`);
        }
        assert.strictEqual(limiter.trackedKeys, 100, 'all rotating keys are tracked before expiry');

        now += 5_000;
        // Ten more calls cross a sweep boundary; every key from the old window expires.
        for (let index = 0; index < 10; index++) {
            limiter.consume('trigger');
        }

        assert.strictEqual(
            limiter.trackedKeys,
            1,
            `expected the sweep to keep only the live key, saw ${limiter.trackedKeys}`
        );
    });
});

suite('approval lazy expiry (D3)', () => {
    test('rejects a challenge that expired between sweeps', () => {
        let now = 1_000;
        const manager = new CommandApprovalManager(1_000, () => now);
        const challenge = manager.issueChallenge('fingerprint-a');

        now += 1_001;
        assert.strictEqual(manager.approveChallenge(challenge.challengeId), null);
    });

    test('rejects a grant that expired between sweeps', () => {
        let now = 1_000;
        const manager = new CommandApprovalManager(1_000, () => now);
        const challenge = manager.issueChallenge('fingerprint-b');
        const grant = manager.approveChallenge(challenge.challengeId);
        assert.ok(grant);

        now += 1_001;
        assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-b'), false);
    });

    test('still consumes a valid grant exactly once', () => {
        const manager = new CommandApprovalManager(60_000);
        const challenge = manager.issueChallenge('fingerprint-c');
        const grant = manager.approveChallenge(challenge.challengeId);
        assert.ok(grant);

        assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-c'), true);
        assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'fingerprint-c'), false);
    });

    test('rejects a grant presented with a different fingerprint', () => {
        const manager = new CommandApprovalManager(60_000);
        const challenge = manager.issueChallenge('fingerprint-d');
        const grant = manager.approveChallenge(challenge.challengeId);
        assert.ok(grant);

        assert.strictEqual(manager.consumeGrant(grant.approvalToken, 'other'), false);
    });
});
