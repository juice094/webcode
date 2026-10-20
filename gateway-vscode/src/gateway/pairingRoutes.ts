import * as path from 'path';
import type express from 'express';
import { BRANDING, BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { findAiSiteById, type ResolvedAiSiteConfig } from '../platforms';
import { BRIDGE_EXTENSION_ORIGIN, createWorkspaceId, resolveAllowedBridgeTarget } from './bridgeRoute';
import { SlidingWindowRateLimiter } from './rateLimit';
import type { GatewayLogger } from './types';

/**
 * Gateway discovery and pairing endpoints.
 *
 * THREAT MODEL
 * ------------
 * Both routes are mounted BEFORE the session-token middleware, because a browser
 * that has no session yet cannot present a token. They are therefore the only
 * unauthenticated surface of the gateway and must stay narrow:
 *
 * - `GET /v1/ping` is read-only and carries no secret: no token, no launch code,
 *   no filesystem path, no site list. It exists so a paired browser can tell
 *   which local workspaces are alive; a hostile local process learns only that a
 *   gateway is running and which folder name is open.
 * - `POST /v1/session/request` never mints a launch code on its own. It requires
 *   (1) a JSON content type, (2) an Origin that is either our browser extension
 *   or one of the configured AI site origins, (3) a per-origin+address rate
 *   window, and (4) an explicit VS Code modal approval. Any one of them failing
 *   returns an error and leaves no code behind.
 * - The returned launch code is useless to a web page: redemption is restricted
 *   to the extension origin (see bridgeRoute), so a site origin that can raise
 *   the prompt still cannot turn the code into a session.
 */
export const PING_SCHEMA_VERSION = 1;

/**
 * QA-calibrated pairing limit. Pairing is a human action started from the popup:
 * normal use is well below one request per minute, and 10 per minute absorbs an
 * accidental double click plus retries while a scripted burst is cut off.
 * Calibration method: burst script against a running gateway, then confirm the
 * double-click + retry path still succeeds.
 */
export const SESSION_REQUEST_LIMIT_PER_MINUTE = 10;
const SESSION_REQUEST_WINDOW_MS = 60_000;

export type SessionRequestPrompt = {
    requestOrigin: string;
    siteName: string;
    workspaceName: string;
};

export type PairingRoutesOptions = {
    getAiSites: () => readonly ResolvedAiSiteConfig[];
    getBridgeCodeTtlMs: () => number;
    getPort: () => number | null;
    getWorkspaceRoot: () => string | null;
    hasActiveSession: () => boolean;
    issueBridgeCode: (siteId: string, targetUrl: string) => string;
    /**
     * Asks the user to approve one pairing request. Resolving false (or any
     * failure) means "declined": no code is issued. With no handler registered
     * the route declines, so the default is deny.
     */
    requestUserConfirmation: (prompt: SessionRequestPrompt) => Promise<boolean>;
    log: GatewayLogger;
};

export function registerPairingRoutes(app: express.Express, options: PairingRoutesOptions): void {
    const limiter = new SlidingWindowRateLimiter(SESSION_REQUEST_LIMIT_PER_MINUTE, SESSION_REQUEST_WINDOW_MS);

    app.get('/v1/ping', (_req, res) => {
        const workspaceRoot = options.getWorkspaceRoot();
        res.set('Cache-Control', 'no-store');
        res.json({
            schema: PING_SCHEMA_VERSION,
            product: BRANDING.productName,
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            workspaceName: workspaceRoot ? path.basename(workspaceRoot) : null,
            workspaceId: createWorkspaceId(workspaceRoot),
            port: options.getPort(),
            sessionActive: options.hasActiveSession()
        });
    });

    app.post('/v1/session/request', (req, res) => {
        void handleSessionRequest(req, res, options, limiter);
    });
}

type PairingFailure = {
    status: number;
    error: string;
    log: string;
    retryAfterSeconds?: number;
};

type AuthorizedCaller = { callerOrigin: string };
type PreparedPairing = {
    site: ResolvedAiSiteConfig;
    requestOrigin: string;
    targetUrl: string;
};

async function handleSessionRequest(
    req: express.Request,
    res: express.Response,
    options: PairingRoutesOptions,
    limiter: SlidingWindowRateLimiter
): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const sites = options.getAiSites();

    const caller = authorizeCaller(req, sites, limiter);
    if ('status' in caller) {
        return reject(res, options, caller);
    }

    const prepared = preparePairing(req.body, caller.callerOrigin, sites);
    if ('status' in prepared) {
        return reject(res, options, prepared);
    }

    const workspaceRoot = options.getWorkspaceRoot();
    if (!workspaceRoot) {
        return reject(res, options, {
            status: 409,
            error: 'no-workspace',
            log: '⛔ Pairing request rejected: no workspace folder is open.'
        });
    }

    const workspaceName = path.basename(workspaceRoot);
    const approved = await options.requestUserConfirmation({
        requestOrigin: prepared.requestOrigin,
        siteName: prepared.site.name,
        workspaceName
    }).catch(() => false);
    if (!approved) {
        return reject(res, options, {
            status: 403,
            error: 'declined',
            log: `⛔ Pairing request declined by the user (${prepared.requestOrigin}).`
        });
    }

    let bridgeCode: string;
    try {
        bridgeCode = options.issueBridgeCode(prepared.site.id, prepared.targetUrl);
    } catch {
        // Never leave the caller hanging: the express version here does not route
        // rejected async handlers, so the failure is answered explicitly.
        return reject(res, options, {
            status: 503,
            error: 'unavailable',
            log: '⛔ Pairing request failed: the gateway could not issue a launch code.'
        });
    }

    options.log(`🔐 Pairing request approved for ${prepared.site.id} in workspace [${workspaceName}].`);
    res.json({ bridgeCode, targetUrl: prepared.targetUrl, expiresInMs: options.getBridgeCodeTtlMs() });
}

/** Content type, caller allowlist, and the rate window, in that order. */
function authorizeCaller(
    req: express.Request,
    sites: readonly ResolvedAiSiteConfig[],
    limiter: SlidingWindowRateLimiter
): AuthorizedCaller | PairingFailure {
    if (!isJsonRequest(req)) {
        return {
            status: 415,
            error: 'unsupported-media-type',
            log: '⛔ Pairing request rejected: expected application/json.'
        };
    }

    const callerOrigin = normalizeOrigin(req.get('origin'));
    if (!isAllowedCallerOrigin(callerOrigin, sites)) {
        return {
            status: 403,
            error: 'forbidden-origin',
            log: '⛔ Pairing request rejected: origin is not the bridge extension or a configured site.'
        };
    }

    const decision = limiter.consume(`${callerOrigin}|${clientAddress(req)}`);
    if (!decision.allowed) {
        return {
            status: 429,
            error: 'rate-limited',
            log: `⛔ Pairing request rejected: rate limited (${callerOrigin}).`,
            retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000)
        };
    }

    return { callerOrigin };
}

/** Body shape, caller/body origin agreement, site resolution, and target URL. */
function preparePairing(
    body: unknown,
    callerOrigin: string,
    sites: readonly ResolvedAiSiteConfig[]
): PreparedPairing | PairingFailure {
    const parsed = readSessionRequest(body);
    const requestOrigin = parsed ? normalizeOrigin(parsed.requestOrigin) : null;
    if (!parsed || !requestOrigin) {
        return { status: 400, error: 'invalid-request', log: '⛔ Pairing request rejected: malformed body.' };
    }
    if (callerOrigin !== BRIDGE_EXTENSION_ORIGIN && callerOrigin !== requestOrigin) {
        return {
            status: 403,
            error: 'forbidden-origin',
            log: '⛔ Pairing request rejected: body origin does not match the caller origin.'
        };
    }

    const site = resolveRequestedSite(sites, parsed.siteId, requestOrigin);
    if (!site) {
        return {
            status: 403,
            error: 'unknown-site',
            log: '⛔ Pairing request rejected: unknown site for the requested origin.'
        };
    }

    const targetUrl = resolveAllowedBridgeTarget(site.address, site);
    if (!targetUrl) {
        return {
            status: 403,
            error: 'unknown-site',
            log: '⛔ Pairing request rejected: configured site address is not a usable target.'
        };
    }

    return { site, requestOrigin, targetUrl };
}

function reject(res: express.Response, options: PairingRoutesOptions, failure: PairingFailure): void {
    options.log(failure.log);
    if (failure.retryAfterSeconds !== undefined) {
        res.set('Retry-After', String(failure.retryAfterSeconds));
    }
    res.status(failure.status).json({ error: failure.error });
}

function isJsonRequest(req: express.Request): boolean {
    return (req.get('content-type') ?? '').toLowerCase().startsWith('application/json');
}

function clientAddress(req: express.Request): string {
    return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function isAllowedCallerOrigin(
    origin: string | null,
    sites: readonly ResolvedAiSiteConfig[]
): origin is string {
    if (!origin) {
        return false;
    }
    return origin === BRIDGE_EXTENSION_ORIGIN ||
        sites.some(site => normalizeOrigin(site.address) === origin);
}

function readSessionRequest(body: unknown): { siteId?: string; requestOrigin: string } | null {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return null;
    }

    const record = body as Record<string, unknown>;
    const requestOrigin = typeof record.requestOrigin === 'string' ? record.requestOrigin.trim() : '';
    if (!requestOrigin) {
        return null;
    }
    if (record.siteId !== undefined && (typeof record.siteId !== 'string' || !record.siteId.trim())) {
        return null;
    }

    const siteId = typeof record.siteId === 'string' ? record.siteId.trim() : '';
    return siteId ? { requestOrigin, siteId } : { requestOrigin };
}

/**
 * Resolves the site being paired. When the browser knows its site id it must
 * still match the request origin, so a caller cannot pair site A while claiming
 * to be site B. A disconnected popup does not know the id, so the origin alone
 * finds the site the user is looking at.
 */
function resolveRequestedSite(
    sites: readonly ResolvedAiSiteConfig[],
    siteId: string | undefined,
    requestOrigin: string
): ResolvedAiSiteConfig | null {
    if (!siteId) {
        return sites.find(site => normalizeOrigin(site.address) === requestOrigin) ?? null;
    }

    const site = findAiSiteById(sites, siteId);
    return site && normalizeOrigin(site.address) === requestOrigin ? site : null;
}

/** Normalizes an Origin header or URL into a comparable origin, or null. */
export function normalizeOrigin(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === 'null') {
        return null;
    }
    // Non-special schemes such as chrome-extension: serialize as "null" through
    // WHATWG URL, so extension origins are normalized by hand.
    if (trimmed.toLowerCase().startsWith('chrome-extension://')) {
        return trimmed.replace(/\/+$/, '').toLowerCase();
    }

    try {
        const url = new URL(trimmed);
        return url.origin === 'null' ? null : url.origin;
    } catch {
        return null;
    }
}
