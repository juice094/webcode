import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { classifyGatewayConfigurationChange } from '../extension/gatewayConfigurationPolicy';

suite('Gateway configuration change policy', () => {
    test('classifies tooling and deadline keys as hot reloads', () => {
        const hotKeys = [
            'webcodeGateway.servers',
            'webcodeGateway.skillDirectories',
            'webcodeGateway.commandShell.path',
            'webcodeGateway.command.allowedRoots',
            'webcodeGateway.timeouts'
        ];

        for (const key of hotKeys) {
            assert.strictEqual(
                classifyGatewayConfigurationChange(changed => changed === key),
                'hot',
                `${key} should be a hot reload key`
            );
        }
    });

    test('classifies connection identity keys as cold restarts', () => {
        const coldKeys = [
            'webcodeGateway.port',
            'webcodeGateway.idleTimeoutMinutes',
            'webcodeGateway.aiSites',
            'webcodeGateway.browser'
        ];

        for (const key of coldKeys) {
            assert.strictEqual(
                classifyGatewayConfigurationChange(changed => changed === key),
                'cold',
                `${key} should be a cold restart key`
            );
        }
    });

    test('lets cold keys win when a single event touches both kinds', () => {
        assert.strictEqual(
            classifyGatewayConfigurationChange(
                changed => changed === 'webcodeGateway.servers' || changed === 'webcodeGateway.port'
            ),
            'cold'
        );
    });

    test('keeps every command and deadline setting on the hot reload list', () => {
        // Any setting that only changes tooling or deadlines must be hot, otherwise
        // editing it would revoke the bridge session of a connected tab.
        const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            contributes?: { configuration?: { properties?: Record<string, unknown> } };
        };
        const keys = Object.keys(packageJson.contributes?.configuration?.properties ?? {})
            .filter(key => /^webcodeGateway\.(command\.|commandShell\.|timeouts$)/.test(key));

        assert.ok(keys.length > 0, 'the extension must contribute command and deadline settings');
        for (const key of keys) {
            assert.strictEqual(
                classifyGatewayConfigurationChange(changed => changed === key),
                'hot',
                `${key} must be added to HOT_RELOAD_KEYS`
            );
        }

        assert.ok(keys.includes('webcodeGateway.command.denyRules'), 'deny rules must be contributed');
        assert.ok(keys.includes('webcodeGateway.command.allowedRoots'), 'allowed roots must be contributed');
    });

    test('ignores unrelated configuration changes', () => {
        assert.strictEqual(
            classifyGatewayConfigurationChange(changed => changed === 'editor.fontSize'),
            'none'
        );
    });
});
