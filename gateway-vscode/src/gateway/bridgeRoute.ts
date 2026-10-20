import * as crypto from 'crypto';
import type express from 'express';
import {
    BRANDING,
    BRIDGE_MIN_EXTENSION_VERSION,
    BRIDGE_PROTOCOL_VERSION,
    compareExtensionVersions
} from '@webcode/shared';

import { findAiSiteById, isTargetAllowedForSite, type ResolvedAiSiteConfig } from '../platforms';
import { renderBridgePage, renderInvalidBridgePage } from './bridgePage';
import type { PendingBridgeLaunch } from './bridgeSession';
import type { GatewayLogger } from './types';

const BRIDGE_EXTENSION_ID = 'kghhldphcmpiimophipabdhldfipgiio';
const BRIDGE_EXTENSION_ORIGIN = `chrome-extension://${BRIDGE_EXTENSION_ID}`;

type BridgeRouteOptions = {
    activateSession: () => string;
    consumeBridgeCode: (code: string) => PendingBridgeLaunch | null;
    getBridgeLaunch: (code: string) => PendingBridgeLaunch | null;
    getAiSites: () => readonly ResolvedAiSiteConfig[];
    getExtensionVersion: () => string;
    getIdleTimeoutMs: () => number;
    getWorkspaceRoot: () => string | null;
    log: GatewayLogger;
    recordActivity: () => void;
};

function createWorkspaceId(workspaceRoot: string | null): string {
    if (!workspaceRoot) {
        return 'global';
    }

    return crypto.createHash('md5').update(workspaceRoot).digest('hex').substring(0, 16);
}

export function registerBridgeRoute(app: express.Express, options: BridgeRouteOptions): void {
    app.get('/bridge', (req, res) => {
        setBridgeSecurityHeaders(res);
        const bridgeCode = getSingleQueryValue(req.query.bridgeCode);
        const launch = bridgeCode ? options.getBridgeLaunch(bridgeCode) : null;
        const resolvedLaunch = launch ? resolvePendingBridgeLaunch(launch, options.getAiSites()) : null;
        if (!bridgeCode || !resolvedLaunch) {
            options.log('⛔ Rejected missing, expired, or invalid bridge code.');
            res.status(400).send(renderInvalidBridgePage());
            return;
        }

        const releaseUrl = `${BRANDING.repositoryUrl}/releases`;
        const storeUrl = `https://chromewebstore.google.com/detail/webcode-bridge/${BRIDGE_EXTENSION_ID}`;
        const vscodeExtensionVersion = options.getExtensionVersion();
        const workspaceId = createWorkspaceId(options.getWorkspaceRoot());

        options.log(`🌉 Bridge page requested for ${resolvedLaunch.site.id} in workspace [${workspaceId}].`);

        res.send(renderBridgePage({
            vscodeExtensionVersion,
            releaseUrl,
            storeUrl
        }));
    });

    app.post('/v1/bridge/redeem', (req, res) => {
        setBridgeSecurityHeaders(res);
        const origin = req.get('origin');
        if (!isAllowedBridgeRedemptionOrigin(origin)) {
            options.log(`⛔ Rejected bridge redemption from origin: ${origin ?? '<missing>'}`);
            res.status(403).json({
                success: false,
                error: 'Bridge redemption is only available to the WebCode browser extension.'
            });
            return;
        }

        const redemptionRequest = getBridgeRedemptionFromBody(req.body);
        if (!redemptionRequest) {
            options.log('⛔ Rejected malformed bridge redemption request.');
            res.status(400).json({
                success: false,
                error: 'A bridge code, browser extension version, and bridge protocol version are required.'
            });
            return;
        }
        if (redemptionRequest.bridgeProtocolVersion !== BRIDGE_PROTOCOL_VERSION) {
            options.log('⛔ Rejected bridge redemption using an incompatible bridge protocol.');
            res.status(409).json({
                success: false,
                error: 'VS Code and browser bridge protocol versions do not match.'
            });
            return;
        }
        if (!isBrowserExtensionVersionCompatible(redemptionRequest.browserExtensionVersion, options.getExtensionVersion())) {
            options.log('⛔ Rejected bridge redemption from an incompatible browser extension.');
            res.status(409).json({
                success: false,
                error: 'VS Code and browser extension versions do not match.'
            });
            return;
        }

        const bridgeCode = redemptionRequest.bridgeCode;
        const launch = bridgeCode ? options.consumeBridgeCode(bridgeCode) : null;
        const resolvedLaunch = launch ? resolvePendingBridgeLaunch(launch, options.getAiSites()) : null;
        if (!resolvedLaunch) {
            options.log('⛔ Rejected expired, used, or invalid bridge code redemption.');
            res.status(410).json({
                success: false,
                error: 'Bridge code expired or already used. Launch the site again from VS Code.'
            });
            return;
        }

        const token = options.activateSession();
        const workspaceId = createWorkspaceId(options.getWorkspaceRoot());
        options.recordActivity();
        options.log(`🔐 Bridge code redeemed for ${resolvedLaunch.site.id} in workspace [${workspaceId}].`);

        res.json({
            success: true,
            token,
            siteId: resolvedLaunch.site.id,
            targetOrigin: new URL(resolvedLaunch.targetUrl).origin,
            targetUrl: resolvedLaunch.targetUrl,
            vscodeExtensionVersion: options.getExtensionVersion(),
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            workspaceId,
            idleTimeoutMs: options.getIdleTimeoutMs()
        });
    });

    app.get('/favicon.ico', (_req, res) => {
        res.status(204).end();
    });
}

export function resolveAllowedBridgeTarget(
    rawTarget: string,
    site: Pick<ResolvedAiSiteConfig, 'address'>
): string | null {
    let parsedTarget: URL;
    try {
        parsedTarget = new URL(rawTarget);
    } catch {
        return null;
    }

    if (parsedTarget.protocol !== 'https:' && parsedTarget.protocol !== 'http:') {
        return null;
    }

    if (!isTargetAllowedForSite(parsedTarget.href, site)) {
        return null;
    }

    return parsedTarget.href;
}

export function resolveBridgeSite(
    rawSiteId: string | null,
    aiSites: readonly ResolvedAiSiteConfig[]
): ResolvedAiSiteConfig | null {
    if (rawSiteId) {
        return findAiSiteById(aiSites, rawSiteId);
    }

    return aiSites[0] ?? null;
}

function resolvePendingBridgeLaunch(
    launch: PendingBridgeLaunch,
    aiSites: readonly ResolvedAiSiteConfig[]
): { site: ResolvedAiSiteConfig; targetUrl: string } | null {
    const site = resolveBridgeSite(launch.siteId, aiSites);
    if (!site) {
        return null;
    }

    const targetUrl = resolveAllowedBridgeTarget(launch.targetUrl, site);
    return targetUrl ? { site, targetUrl } : null;
}

export function isAllowedBridgeRedemptionOrigin(origin: string | undefined): boolean {
    return origin === BRIDGE_EXTENSION_ORIGIN;
}

/**
 * Bridge redemption accepts any browser extension at or above
 * BRIDGE_MIN_EXTENSION_VERSION (the bridge protocol version is checked
 * separately and must match exactly). When the shared protocol config does
 * not declare a minimum, fall back to the legacy exact-match behavior.
 */
export function isBrowserExtensionVersionCompatible(
    browserExtensionVersion: string,
    vscodeExtensionVersion: string
): boolean {
    if (!BRIDGE_MIN_EXTENSION_VERSION) {
        return browserExtensionVersion === vscodeExtensionVersion;
    }

    return compareExtensionVersions(browserExtensionVersion, BRIDGE_MIN_EXTENSION_VERSION) >= 0;
}

function getBridgeRedemptionFromBody(
    body: unknown
): { bridgeCode: string; browserExtensionVersion: string; bridgeProtocolVersion: number } | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }

    const record = body as Record<string, unknown>;
    const bridgeCode = typeof record.bridgeCode === 'string' ? record.bridgeCode.trim() : '';
    const browserExtensionVersion = typeof record.browserExtensionVersion === 'string'
        ? record.browserExtensionVersion.trim()
        : '';
    const bridgeProtocolVersion = record.bridgeProtocolVersion;
    return bridgeCode &&
        browserExtensionVersion &&
        typeof bridgeProtocolVersion === 'number' &&
        Number.isInteger(bridgeProtocolVersion)
        ? { bridgeCode, browserExtensionVersion, bridgeProtocolVersion }
        : null;
}

function getSingleQueryValue(value: unknown): string | null {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }

    return null;
}

function setBridgeSecurityHeaders(res: express.Response): void {
    res.set({
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff'
    });
}
