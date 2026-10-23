import * as crypto from 'crypto';

export const DEFAULT_APPROVAL_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_RECORDS = 256;
const SWEEP_INTERVAL_OPERATIONS = 64;

type ChallengeRecord = {
    expiresAt: number;
    fingerprint: string;
};

export type CommandApprovalChallenge = {
    challengeId: string;
    expiresAt: number;
};

export type CommandApprovalGrant = {
    approvalToken: string;
    expiresAt: number;
};

export class CommandApprovalManager {
    private readonly challenges = new Map<string, ChallengeRecord>();
    private readonly grants = new Map<string, ChallengeRecord>();
    private operationCounter = 0;

    constructor(
        private ttlMs = DEFAULT_APPROVAL_TTL_MS,
        private readonly now: () => number = Date.now
    ) { }

    /**
     * Applies a new TTL to challenges and grants issued from now on. Records
     * already issued keep the expiry they were created with. The gateway clears
     * both maps on every start, so a reload also drops any pending approval.
     */
    setTtlMs(ttlMs: number): void {
        this.ttlMs = ttlMs;
    }

    /** Resolved challenge/grant lifetime, reported by the startup diagnostics line. */
    getTtlMs(): number {
        return this.ttlMs;
    }

    issueChallenge(fingerprint: string): CommandApprovalChallenge {
        this.sweepOccasionally();
        this.enforceRecordLimit(this.challenges);
        const challengeId = crypto.randomUUID();
        const expiresAt = this.now() + this.ttlMs;
        this.challenges.set(challengeId, { expiresAt, fingerprint });
        return { challengeId, expiresAt };
    }

    approveChallenge(challengeId: string): CommandApprovalGrant | null {
        this.sweepOccasionally();
        const challenge = this.challenges.get(challengeId);
        if (!challenge) {
            return null;
        }

        // Expiry is checked on access so a stale challenge cannot be redeemed
        // between sweeps.
        if (challenge.expiresAt <= this.now()) {
            this.challenges.delete(challengeId);
            return null;
        }

        this.challenges.delete(challengeId);
        this.enforceRecordLimit(this.grants);
        const approvalToken = crypto.randomUUID();
        const expiresAt = this.now() + this.ttlMs;
        this.grants.set(approvalToken, {
            expiresAt,
            fingerprint: challenge.fingerprint
        });
        return { approvalToken, expiresAt };
    }

    consumeGrant(approvalToken: string | undefined, fingerprint: string): boolean {
        this.sweepOccasionally();
        if (!approvalToken) {
            return false;
        }

        const grant = this.grants.get(approvalToken);
        if (!grant) {
            return false;
        }

        if (grant.expiresAt <= this.now()) {
            this.grants.delete(approvalToken);
            return false;
        }

        if (grant.fingerprint !== fingerprint) {
            return false;
        }

        this.grants.delete(approvalToken);
        return true;
    }

    clear(): void {
        this.challenges.clear();
        this.grants.clear();
        this.operationCounter = 0;
    }

    /**
     * Sweeps expired records every N operations instead of on every call.
     * Expiry is still enforced on access, so this only bounds memory; it is not
     * a correctness mechanism.
     */
    private sweepOccasionally(): void {
        this.operationCounter += 1;
        if (this.operationCounter % SWEEP_INTERVAL_OPERATIONS !== 0) {
            return;
        }

        const now = this.now();
        this.removeExpired(this.challenges, now);
        this.removeExpired(this.grants, now);
    }

    private removeExpired(records: Map<string, ChallengeRecord>, now: number): void {
        for (const [key, record] of records) {
            if (record.expiresAt <= now) {
                records.delete(key);
            }
        }
    }

    private enforceRecordLimit(records: Map<string, ChallengeRecord>): void {
        while (records.size >= MAX_PENDING_RECORDS) {
            const oldestKey = records.keys().next().value;
            if (!oldestKey) {
                return;
            }
            records.delete(oldestKey);
        }
    }
}
