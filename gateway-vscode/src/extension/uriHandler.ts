import * as vscode from 'vscode';
import { BRANDING } from '@webcode/shared';

import { GATEWAY_CONNECT_COMMAND } from './commandIds';
import { getConfiguredAiSites, type AISiteConfig } from '../platforms';

/**
 * Handles `vscode://three-water666.gateway-vscode/connect`.
 *
 * THREAT MODEL
 * ------------
 * A vscode:// URI is a public entry point: any web page, and any local process,
 * can navigate to it. The only barrier is the operating system prompt asking
 * whether to open VS Code, which users routinely accept. Every field of the URI
 * is therefore attacker-controlled input, and this handler is deliberately a
 * fixed, whitelisted action:
 *
 * - The only implemented action is `connect`, mapped to the existing connect
 *   quick pick. The handler never starts the gateway, never issues bridge codes,
 *   never launches a browser, never writes settings, and never touches the
 *   filesystem. Letting a link mint a token or boot the gateway would give any
 *   page a way to widen the local attack surface.
 * - The `site` query parameter is advisory metadata. It is accepted only when it
 *   matches an id in the user's configured `webcodeGateway.aiSites`, so a
 *   spoofer cannot use the link to probe which sites the user configured: an
 *   unknown id turns the link into a no-op instead of an error.
 * - Any other scheme, authority, path, or query shape is ignored, never guessed.
 *
 * One amplifier is outside this module: a link can activate the extension, and
 * activation runs the same code as opening a window, including the opt-in
 * `webcodeGateway.autoStart` behavior. The link itself still never chooses to
 * start anything; that decision belongs to a setting the user already enabled.
 */
export const CONNECT_ACTION = 'connect';

/** The subset of `vscode.Uri` this module reads; plain objects are accepted too. */
export type VscodeUriLike = {
    scheme: string;
    authority: string;
    path: string;
    query: string;
};

export type GatewayConnectLink = {
    siteId?: string;
};

const CONNECT_URI = new URL(BRANDING.vscodeConnectUri);
export const CONNECT_URI_AUTHORITY = CONNECT_URI.host;
export const CONNECT_URI_PATH = CONNECT_URI.pathname.replace(/^\/+/, '');
const CONNECT_URI_SCHEME = CONNECT_URI.protocol.replace(':', '');

/**
 * Parses a deep link into the single action this extension supports. Returns
 * null for anything that is not exactly `vscode://<authority>/connect`.
 */
export function parseGatewayConnectUri(uri: VscodeUriLike): GatewayConnectLink | null {
    if (uri.scheme.toLowerCase() !== CONNECT_URI_SCHEME) {
        return null;
    }
    if (uri.authority.toLowerCase() !== CONNECT_URI_AUTHORITY.toLowerCase()) {
        return null;
    }
    if (normalizePath(uri.path) !== CONNECT_URI_PATH) {
        return null;
    }

    const siteId = new URLSearchParams(uri.query).get('site')?.trim();
    return siteId ? { siteId } : {};
}

/** True when the requested site id is one the user already configured. */
export function isAllowedSiteId(siteId: string, allowedSiteIds: readonly string[]): boolean {
    return allowedSiteIds.includes(siteId);
}

export function registerGatewayConnectDeepLink(
    context: vscode.ExtensionContext,
    log: (message: string) => void
): void {
    context.subscriptions.push(vscode.window.registerUriHandler({
        handleUri: async uri => {
            const link = parseGatewayConnectUri(uri);
            if (!link) {
                log(`⛔ Ignored unsupported ${BRANDING.slug}://${CONNECT_URI_AUTHORITY} link.`);
                return;
            }
            if (link.siteId && !isAllowedSiteId(link.siteId, readConfiguredSiteIds())) {
                log(`⛔ Ignored ${CONNECT_ACTION} link for an unconfigured site.`);
                return;
            }

            log(`🔗 ${CONNECT_ACTION} link accepted; opening the connect menu.`);
            await vscode.commands.executeCommand(GATEWAY_CONNECT_COMMAND);
        }
    }));
}

function readConfiguredSiteIds(): readonly string[] {
    const configured = vscode.workspace.getConfiguration('webcodeGateway').get<AISiteConfig[]>('aiSites');
    return getConfiguredAiSites(configured).map(site => site.id);
}

function normalizePath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '');
}
