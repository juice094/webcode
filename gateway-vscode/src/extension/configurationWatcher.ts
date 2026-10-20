import * as vscode from 'vscode';

import type { GatewayManager } from '../gateway';
import { classifyGatewayConfigurationChange } from './gatewayConfigurationPolicy';
import type { GatewayServiceController } from './serviceController';
import type { SkillWatcherController } from './skillWatchers';

interface RegisterGatewayConfigurationWatcherOptions {
    context: vscode.ExtensionContext;
    manager: GatewayManager;
    outputChannel: vscode.OutputChannel;
    serviceController: GatewayServiceController;
    skillWatcherController: SkillWatcherController;
}

export function registerGatewayConfigurationWatcher(options: RegisterGatewayConfigurationWatcherOptions): void {
    options.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
        const changeKind = classifyGatewayConfigurationChange(key => event.affectsConfiguration(key));
        if (changeKind === 'none') {
            return;
        }

        if (event.affectsConfiguration('webcodeGateway.skillDirectories')) {
            options.skillWatcherController.refresh();
            options.manager.invalidateSkillCache('skillDirectories configuration changed');
        }

        if (options.serviceController.getState().isRunning) {
            if (changeKind === 'hot') {
                // Hot reload: restart the gateway but keep the bridge session
                // token so already-connected browser tabs continue working.
                options.outputChannel.appendLine("⚙️ Configuration changed, restarting gateway (preserving browser bridge session)...");
                await options.serviceController.start({ preserveBridgeSession: true });
            } else {
                options.outputChannel.appendLine("⚙️ Server configuration changed, restarting...");
                await options.serviceController.start();
            }
        }
    }));
}
