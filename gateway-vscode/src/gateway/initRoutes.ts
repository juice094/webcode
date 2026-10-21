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
};

export function registerConfigRoutes(
    app: express.Express,
    config: GatewayConfig,
    log: GatewayLogger,
    status?: GatewayStatusDetails
): void {
    app.get('/v1/status', (_req, res) => {
        res.json({
            ok: true,
            idleTimeoutMs: config.idleTimeoutMs,
            version: status?.extensionVersion ?? null,
            buildHash: status?.buildHash ?? null,
            bridgeProtocolVersion: status?.bridgeProtocolVersion ?? null,
            startedAt: status?.startedAt ?? null
        });
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
