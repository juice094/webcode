import * as assert from 'assert';

import { classifyGatewayConfigurationChange } from '../extension/gatewayConfigurationPolicy';

suite('Gateway configuration change policy', () => {
    test('classifies tooling-surface keys as hot reloads', () => {
        const hotKeys = [
            'webcodeGateway.servers',
            'webcodeGateway.skillDirectories',
            'webcodeGateway.commandShell.path',
            'webcodeGateway.command.allowedRoots'
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

    test('ignores unrelated configuration changes', () => {
        assert.strictEqual(
            classifyGatewayConfigurationChange(changed => changed === 'editor.fontSize'),
            'none'
        );
    });
});
