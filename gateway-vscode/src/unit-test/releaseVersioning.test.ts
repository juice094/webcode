import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Release guards. The 1.2.1 release shipped two different builds under one
 * version number (the tag vs a working-tree snapshot taken minutes later), and
 * nothing failed because no test compared the three manifests. These checks turn
 * that drift into a red test instead of a silent install.
 */
const repoRoot = path.resolve(__dirname, '../../..');
const extensionPackagePath = path.join(repoRoot, 'gateway-vscode', 'package.json');
const bridgePackagePath = path.join(repoRoot, 'bridge-browser', 'package.json');
const bridgeManifestPath = path.join(repoRoot, 'bridge-browser', 'manifest.json');
const bridgeProtocolPath = path.join(repoRoot, 'shared', 'src', 'bridgeProtocol.json');
const packagingDescriptorPath = path.join(repoRoot, 'gateway-vscode', 'browser-extension', 'bridge-build.json');

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type Versioned = { version?: unknown };
type BridgeDescriptor = {
    extensionVersion?: unknown;
    bridgeProtocolVersion?: unknown;
    buildHash?: unknown;
    builtAt?: unknown;
};

function readVersion(filePath: string): string {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Versioned;
    assert.strictEqual(typeof parsed.version, 'string', filePath + ' must declare a string version');
    return parsed.version as string;
}

suite('Release versioning', () => {
    test('ships the same version from the extension and the browser bridge', () => {
        const extensionVersion = readVersion(extensionPackagePath);
        const bridgePackageVersion = readVersion(bridgePackagePath);
        const bridgeManifestVersion = readVersion(bridgeManifestPath);

        assert.strictEqual(bridgePackageVersion, extensionVersion, 'bridge package.json drifted from the extension');
        assert.strictEqual(bridgeManifestVersion, extensionVersion, 'bridge manifest.json drifted from the extension');
    });

    test('uses a real semver release version instead of an internal placeholder', () => {
        for (const filePath of [extensionPackagePath, bridgePackagePath, bridgeManifestPath]) {
            const version = readVersion(filePath);
            assert.match(version, SEMVER_PATTERN, filePath + ' version must be dotted semver, got ' + version);
            assert.notStrictEqual(version, '0.0.1', filePath + ' must not reuse the internal workspace version');
        }
    });

    test('keeps the packaged bridge descriptor on the released version', function () {
        // browser-extension/ is generated and gitignored: absent on a fresh
        // clone, present after any packaging run. When present it must describe
        // the version currently in the manifests, otherwise the vsix would ship
        // a bridge that reports a different build than the extension.
        if (!fs.existsSync(packagingDescriptorPath)) {
            this.skip();
            return;
        }

        const descriptor = JSON.parse(fs.readFileSync(packagingDescriptorPath, 'utf8')) as BridgeDescriptor;
        const releaseVersion = readVersion(extensionPackagePath);
        const protocol = JSON.parse(fs.readFileSync(bridgeProtocolPath, 'utf8')) as { version?: unknown };

        assert.strictEqual(
            descriptor.extensionVersion,
            releaseVersion,
            'browser-extension/bridge-build.json is stale: repackage before tagging'
        );
        assert.strictEqual(
            descriptor.bridgeProtocolVersion,
            protocol.version,
            'bridge-build.json protocol drifted from shared/src/bridgeProtocol.json'
        );
        assert.strictEqual(typeof descriptor.buildHash, 'string', 'buildHash must be a string');
        assert.match(descriptor.buildHash as string, SHA256_PATTERN, 'buildHash must be a sha256 hex digest');
        assert.strictEqual(typeof descriptor.builtAt, 'string', 'builtAt must be a string');
        assert.ok(
            Number.isFinite(Date.parse(descriptor.builtAt as string)),
            'builtAt must be an ISO timestamp'
        );
    });
});
