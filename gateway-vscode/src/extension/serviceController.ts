import * as vscode from 'vscode';

import type { GatewayLifecycleOptions, GatewayManager } from '../gateway';
import { t } from '../i18n';
import { getConfiguredAiSites } from '../platforms';
import { filterCustomServers, type BuiltinServerConfig } from './customServers';
import { getErrorMessage } from './errorUtils';
import type { PersistentLogger } from './persistentLog';
import { updateGatewayStatusBar } from './statusBar';
import type { AISiteConfig, ResolvedAiSiteConfig } from './types';
import { resolveCommandAllowedRoots } from './commandAllowedRoots';
import { resolveCommandDenyRules } from './commandDenyRules';
import { resolveIdleTimeoutMs } from '../gateway/idleTimeout';
import {
    resolveApprovalTtlSeconds,
    resolveBridgeCodeTtlSeconds,
    resolveBridgeRequestMs,
    resolveBrowserLaunchWaitMs,
    resolveCommandExecutionMaxMs,
    resolveCommandExecutionMs,
    resolveToolCallMs
} from '../gateway/timeouts';

export interface GatewayServiceSnapshot {
    currentPort: number | null;
    isStarting: boolean;
    isRunning: boolean;
}

export interface GatewayServiceController {
    start(options?: GatewayLifecycleOptions): Promise<void>;
    stop(): Promise<void>;
    restart(): Promise<void>;
    issueBridgeCode(siteId: string, targetUrl: string): string;
    markAutoStopped(idleTimeoutMs: number): void;
    markBridgeConnected(): void;
    markOffline(): void;
    getState(): GatewayServiceSnapshot;
}

interface CreateGatewayServiceControllerOptions {
    manager: GatewayManager;
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    statusBarItem: vscode.StatusBarItem;
    persistentLogger: PersistentLogger;
}

export function createGatewayServiceController(options: CreateGatewayServiceControllerOptions): GatewayServiceController {
    let currentPort: number | null = null;
    let isStarting = false;
    let isRunning = false;
    const getState = () => ({ currentPort, isStarting, isRunning });
    // The bridge session token is the single source of truth for whether a tab
    // is connected; hot restarts keep it, cold restarts and stop revoke it.
    const updateStatus = () =>
        updateGatewayStatusBar(options.statusBarItem, isRunning, currentPort ?? undefined, false, options.manager.hasActiveBridgeSession());
    const issueBridgeCode = createBridgeCodeIssuer(options.manager, getState);

    const resetToOffline = () => {
        isStarting = false;
        isRunning = false;
        currentPort = null;
        updateStatus();
    };

    const start = async (startOptions?: GatewayLifecycleOptions) => {
        if (!hasWorkspaceFolder()) {
            if (isRunning || isStarting) {
                await options.manager.stop();
            }
            resetToOffline();
            void vscode.window.showErrorMessage(t('start_requires_workspace'));
            return;
        }

        // Set Loading State
        isStarting = true;
        updateGatewayStatusBar(options.statusBarItem, true, undefined, true);

        const config = vscode.workspace.getConfiguration('webcodeGateway');
        const portConfig = config.get<number>('port') ?? 34567;
        const startParams = buildStartParams(config, options);

        try {
            const result = await options.manager.start({
                port: portConfig,
                idleTimeoutMs: startParams.idleTimeoutMs,
                preferredPort: startParams.lastUsedPort,
                mcpServers: startParams.customServers,
                allowedOrigins: startParams.allowedOrigins,
                aiSites: startParams.aiSites,
                skillDirectories: startParams.skillDirectories,
                ...startParams.commandConfig,
                ...startParams.timeoutConfig
            }, startOptions);

            currentPort = result.port;
            if (currentPort !== startParams.lastUsedPort) {
                await options.context.workspaceState.update('mcp.lastPort', currentPort);
            }

            isStarting = false;
            isRunning = true;
            updateStatus();
            options.persistentLogger.info(`Gateway started on port ${currentPort}.`);
        } catch (error: unknown) {
            void vscode.window.showErrorMessage(t('start_failed', { message: getErrorMessage(error) }));
            options.persistentLogger.error('Gateway start failed', error);
            resetToOffline();
        }
    };

    const markOffline = () => resetToOffline();

    const markBridgeConnected = () => updateStatus();

    const stop = async () => {
        await options.manager.stop();
        markOffline();
        options.persistentLogger.info('Gateway stopped by user.');
        void vscode.window.showInformationMessage(t('server_stopped'));
    };

    const restart = async () => {
        options.outputChannel.appendLine("🔄 Manual restart triggered.");
        options.persistentLogger.info('Gateway restart requested by user.');
        await options.manager.stop();
        await start();
        void vscode.window.showInformationMessage(t('server_restarted'));
    };

    const markAutoStopped = (idleTimeoutMs: number) => {
        markOffline();
        const minutes = Math.round(idleTimeoutMs / (60 * 1000));
        void vscode.window.showInformationMessage(t('auto_stop_message', { minutes }));
        options.outputChannel.appendLine("💤 Auto-shutdown triggered due to inactivity.");
        options.persistentLogger.warn(`Gateway auto-stopped after ${minutes} minutes of inactivity.`);
    };

    return {
        start,
        stop,
        restart,
        issueBridgeCode,
        markAutoStopped,
        markBridgeConnected,
        markOffline,
        getState
    };
}

function createBridgeCodeIssuer(
    manager: GatewayManager,
    getState: () => GatewayServiceSnapshot
): (siteId: string, targetUrl: string) => string {
    return (siteId, targetUrl) => {
        const state = getState();
        if (!state.isRunning || !state.currentPort) {
            throw new Error('Gateway server is not running.');
        }
        return manager.issueBridgeCode(siteId, targetUrl);
    };
}

interface GatewayStartParams {
    idleTimeoutMs: number;
    commandConfig: { commandAllowedRoots: string[]; commandDenyRules: string[]; commandShellPath?: string };
    timeoutConfig: {
        approvalTtlMs: number;
        bridgeCodeTtlMs: number;
        bridgeRequestMs: number;
        browserLaunchWaitMs: number;
        commandExecutionMs: number;
        commandExecutionMaxMs: number;
        toolCallMs: number;
    };
    customServers: ReturnType<typeof filterCustomServers>;
    skillDirectories: string[];
    lastUsedPort: number | undefined;
    aiSites: ReturnType<typeof getConfiguredAiSites>;
    allowedOrigins: string[];
}

function buildStartParams(
    config: vscode.WorkspaceConfiguration,
    options: CreateGatewayServiceControllerOptions
): GatewayStartParams {
    const aiSites = getConfiguredAiSites(config.get<AISiteConfig[]>('aiSites'));
    return {
        idleTimeoutMs: resolveIdleTimeoutMs(config.get<number>('idleTimeoutMinutes')),
        commandConfig: getCommandExecutionConfig(config, options.outputChannel),
        timeoutConfig: {
            approvalTtlMs: resolveApprovalTtlSeconds(config.get<number>('timeouts.approvalTtlSeconds')) * 1000,
            bridgeCodeTtlMs: resolveBridgeCodeTtlSeconds(config.get<number>('timeouts.bridgeCodeTtlSeconds')) * 1000,
            bridgeRequestMs: resolveBridgeRequestMs(config.get<number>('timeouts.bridgeRequestMs')),
            browserLaunchWaitMs: resolveBrowserLaunchWaitMs(config.get<number>('timeouts.browserLaunchWaitMs')),
            commandExecutionMs: resolveCommandExecutionMs(config.get<number>('timeouts.commandExecutionMs')),
            commandExecutionMaxMs: resolveCommandExecutionMaxMs(config.get<number>('timeouts.commandExecutionMaxMs')),
            toolCallMs: resolveToolCallMs(config.get<number>('timeouts.toolCallMs'))
        },
        customServers: filterCustomServers(
            config.get<Record<string, BuiltinServerConfig>>('servers') ?? {},
            options.outputChannel
        ),
        skillDirectories: config.get<string[]>('skillDirectories') ?? [],
        lastUsedPort: options.context.workspaceState.get<number>('mcp.lastPort'),
        aiSites,
        allowedOrigins: buildAllowedOrigins(aiSites)
    };
}

function getCommandShellPath(config: vscode.WorkspaceConfiguration): string | undefined {    const configuredCommandShellPath = config.get<string>('commandShell.path')?.trim();
    return configuredCommandShellPath === '' ? undefined : configuredCommandShellPath;
}

function getCommandExecutionConfig(
    config: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
): { commandAllowedRoots: string[]; commandDenyRules: string[]; commandShellPath?: string } {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    return {
        commandShellPath: getCommandShellPath(config),
        commandAllowedRoots: resolveCommandAllowedRoots(
            config.get<string[]>('command.allowedRoots') ?? [],
            workspaceRoot,
            outputChannel
        ),
        commandDenyRules: resolveCommandDenyRules(
            config.get<string[]>('command.denyRules'),
            outputChannel
        )
    };
}

function hasWorkspaceFolder(): boolean {
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
}

function buildAllowedOrigins(aiSites: ResolvedAiSiteConfig[]): string[] {
    return aiSites.map(site => {
        try {
            return new URL(site.address).origin;
        } catch {
            return '';
        }
    }).filter(origin => origin !== '');
}

