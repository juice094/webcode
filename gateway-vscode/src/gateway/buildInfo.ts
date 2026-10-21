import * as fs from 'node:fs';
import * as path from 'node:path';

import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

/**
 * Descriptor written next to the bundled browser bridge at packaging time
 * (`scripts/copy-browser-extension.mjs`). It is the only artifact that ties a
 * running extension to the bytes and the build moment it was shipped with, so
 * every read here is best-effort: a missing or malformed descriptor must never
 * break activation.
 */
export const BROWSER_BRIDGE_BUILD_FILE = 'bridge-build.json';
export const BROWSER_BRIDGE_DIR = 'browser-extension';

export interface BrowserBridgeBuildInfo {
    extensionVersion: string;
    bridgeProtocolVersion: number;
    buildHash: string;
    builtAt: string;
}

export interface BuildFingerprintInput {
    extensionVersion: string;
    build: BrowserBridgeBuildInfo | null;
    nodeVersion: string;
    vscodeVersion: string;
}

export function readBrowserBridgeBuild(extensionPath: string): BrowserBridgeBuildInfo | null {
    try {
        const descriptorPath = path.join(extensionPath, BROWSER_BRIDGE_DIR, BROWSER_BRIDGE_BUILD_FILE);
        const raw = fs.readFileSync(descriptorPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<BrowserBridgeBuildInfo>;
        if (typeof parsed.extensionVersion !== 'string' ||
            typeof parsed.bridgeProtocolVersion !== 'number' ||
            typeof parsed.buildHash !== 'string' ||
            typeof parsed.builtAt !== 'string') {
            return null;
        }
        return {
            extensionVersion: parsed.extensionVersion,
            bridgeProtocolVersion: parsed.bridgeProtocolVersion,
            buildHash: parsed.buildHash,
            builtAt: parsed.builtAt
        };
    } catch {
        return null;
    }
}

/**
 * Version of the running extension. Read from `context.extension.packageJSON`
 * instead of importing package.json so the bundler cannot inline a second copy
 * that drifts from the packaged manifest.
 */
export function resolveExtensionVersion(context: {
    extension?: { packageJSON?: unknown };
}): string {
    const packageJson = context.extension?.packageJSON;
    const version = packageJson && typeof packageJson === 'object'
        ? (packageJson as { version?: unknown }).version
        : undefined;
    return typeof version === 'string' && version.trim() ? version : 'unknown';
}

/**
 * One-line fingerprint logged at activation. Format is asserted by
 * `unit-test/buildInfo.test.ts`; keep `build:` first so log greps stay stable.
 */
export function formatBuildFingerprint(input: BuildFingerprintInput): string {
    const build = input.build;
    const buildHash = build?.buildHash ?? 'unknown';
    const builtAt = build?.builtAt ?? 'unknown';
    const bridgeProtocol = build?.bridgeProtocolVersion ?? BRIDGE_PROTOCOL_VERSION;
    return `build: version=${input.extensionVersion} buildHash=${buildHash} builtAt=${builtAt} ` +
        `bridgeProtocol=${bridgeProtocol} node=${input.nodeVersion} vscode=${input.vscodeVersion}`;
}
