import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import {
    formatBuildFingerprint,
    readBrowserBridgeBuild,
    resolveExtensionVersion,
    type BrowserBridgeBuildInfo
} from '../gateway/buildInfo';

const FINGERPRINT_PATTERN = /^build: version=\d+\.\d+\.\d+ buildHash=[0-9a-f]{64} builtAt=\S+ bridgeProtocol=\d+ node=\S+ vscode=\S+$/;

const BUILD: BrowserBridgeBuildInfo = {
    extensionVersion: '1.3.0',
    bridgeProtocolVersion: 2,
    buildHash: 'a'.repeat(64),
    builtAt: '2026-10-21T12:00:00.000Z'
};

suite('Build fingerprint', () => {
    test('formats a single greppable line carrying version, hash and protocol', () => {
        const line = formatBuildFingerprint({
            extensionVersion: '1.3.0',
            build: BUILD,
            nodeVersion: 'v22.11.0',
            vscodeVersion: '1.106.1'
        });

        assert.match(line, FINGERPRINT_PATTERN);
        assert.ok(line.includes('buildHash=' + BUILD.buildHash), 'the full hash must be logged so it can be compared');
        assert.ok(line.includes('bridgeProtocol=2'));
    });

    test('degrades to unknown instead of failing when the descriptor is missing', () => {
        const line = formatBuildFingerprint({
            extensionVersion: '1.3.0',
            build: null,
            nodeVersion: 'v22.11.0',
            vscodeVersion: '1.106.1'
        });

        assert.match(line, /buildHash=unknown builtAt=unknown/);
        assert.ok(line.includes(`bridgeProtocol=${BRIDGE_PROTOCOL_VERSION}`), line);
    });

    test('reads the packaged bridge descriptor and tolerates a broken one', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webcode-build-info-'));
        const bridgeDir = path.join(root, 'browser-extension');
        fs.mkdirSync(bridgeDir, { recursive: true });

        assert.strictEqual(readBrowserBridgeBuild(root), null, 'a missing descriptor must not throw');

        fs.writeFileSync(path.join(bridgeDir, 'bridge-build.json'), '{ not json', 'utf8');
        assert.strictEqual(readBrowserBridgeBuild(root), null, 'a malformed descriptor must not throw');

        fs.writeFileSync(
            path.join(bridgeDir, 'bridge-build.json'),
            JSON.stringify({ schemaVersion: 1, ...BUILD }),
            'utf8'
        );
        assert.deepStrictEqual(readBrowserBridgeBuild(root), BUILD);
    });

    test('reads the running extension version only from context.packageJSON', () => {
        assert.strictEqual(resolveExtensionVersion({ extension: { packageJSON: { version: '1.3.0' } } }), '1.3.0');
        assert.strictEqual(resolveExtensionVersion({ extension: { packageJSON: {} } }), 'unknown');
        assert.strictEqual(resolveExtensionVersion({}), 'unknown');
        assert.strictEqual(resolveExtensionVersion({ extension: { packageJSON: { version: '   ' } } }), 'unknown');
    });
});
