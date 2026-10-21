import type express from 'express';

import { PROMPTS } from '../defaults';
import type { GatewayConfig, GatewayLogger } from './types';
import { buildSyncedAiSites } from './syncedSites';

/**
 * Build identity reported by `/v1/status`. Additive on purpose: the browser
 * bridge only checks `response.ok`, so extra fields cannot break older tabs,
 * while a human (or a smoke test) can answer "which build is running?" with one
 * authenticated request instead of reading the log.
 */
export type GatewayStatusDetails = {
    extensionVersion: string;
    buildHash: string | null;
    bridgeProtocolVersion: number;
    startedAt: string | null;
    /** Changes on every gateway start; the bridge uses it to spot a restart. */
    gatewayInstanceId: string | null;
    /** Calls that were still running when the previous host went away. */
    lastInterrupted: { count: number; savedAt: string } | null;
};

function buildIdentityFields(status?: GatewayStatusDetails) {
    return {
        version: status?.extensionVersion ?? null,
        buildHash: status?.buildHash ?? null,
        bridgeProtocolVersion: status?.bridgeProtocolVersion ?? null,
        startedAt: status?.startedAt ?? null
    };
}

function buildResumeFields(status?: GatewayStatusDetails) {
    return {
        gatewayInstanceId: status?.gatewayInstanceId ?? null,
        lastInterrupted: status?.lastInterrupted ?? null
    };
}

/**
 * Build identity and resume hints for `/v1/status`. Extracted from the route so
 * the handler stays a one-liner; every field is optional for old callers.
 */
export function buildStatusPayload(config: GatewayConfig, status?: GatewayStatusDetails) {
    return {
        ok: true,
        idleTimeoutMs: config.idleTimeoutMs,
        ...buildIdentityFields(status),
        ...buildResumeFields(status)
    };
}

export function registerConfigRoutes(
    app: express.Express,
    config: GatewayConfig,
    log: GatewayLogger,
    status?: GatewayStatusDetails
): void {
    app.get('/v1/status', (_req, res) => {
        res.json(buildStatusPayload(config, status));
    });

    app.get('/v1/init', (req, res) => {
        log('📥 Init Sync: Browser requested default rules and prompts');

        res.json({
            syncedAiSites: buildSyncedAiSites(config.aiSites ?? []),
            prompts: PROMPTS
        });
    });

    app.get('/v1/config', (req, res) => {
        res.json({ config: null });
    });

    app.post('/v1/config', (req, res) => {
        res.json({ success: true });
    });
}
