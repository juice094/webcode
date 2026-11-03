import * as assert from 'node:assert';
import * as vscode from 'vscode';

interface GatewayExtensionApi {
    getGatewayState(): {
        currentPort: number | null;
        isStarting: boolean;
        isRunning: boolean;
    };
}

const EXTENSION_ID = 'juice094.gateway-vscode';
const EXPECTED_COMMANDS = [
    'gateway-vscode.restart',
    'webcode-gateway.cleanLegacyIsolatedBrowserProfiles',
    'webcode-gateway.connect',
    'webcode-gateway.copyContext',
    'webcode-gateway.resetIsolatedBrowserProfiles'
] as const;

suite('Extension Host smoke test', () => {
    test('activates safely and registers its commands', async () => {
        assert.ok(vscode.workspace.workspaceFolders?.length, 'The test workspace should be open.');

        const extension = vscode.extensions.getExtension<GatewayExtensionApi>(EXTENSION_ID);
        assert.ok(extension, `Extension ${EXTENSION_ID} should be installed in the test host.`);

        const api = await extension.activate();
        assert.strictEqual(extension.isActive, true, 'The extension should be active.');
        assert.strictEqual(typeof api.getGatewayState, 'function');

        const commands = new Set(await vscode.commands.getCommands(true));
        for (const command of EXPECTED_COMMANDS) {
            assert.ok(commands.has(command), `Command ${command} should be registered.`);
        }

        assert.deepStrictEqual(api.getGatewayState(), {
            currentPort: null,
            isStarting: false,
            isRunning: false
        });
    });
});
