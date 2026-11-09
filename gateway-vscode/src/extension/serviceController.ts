import type * as vscode from 'vscode';

import type { GatewayLifecycleOptions, GatewayManager } from '../gateway';
import type { GatewayConfig } from '../gateway/types';
import type { ConfigStore, PairingUI, SessionStore, WorkspaceProvider } from '../host/types';
import { t } from '../i18n';
import { getConfiguredAiSites } from '../platforms';
import { filterCustomServers, type BuiltinServerConfig } from './customServers';
import { getErrorMessage } from './errorUtils';
import type { PersistentLogger } from './persistentLog';
import { updateGatewayStatusBar } from './statusBar';
import type { AISiteConfig, ResolvedAiSiteConfig } from './types';
import { resolveCommandAllowedRoots } from './commandAllowedRoots';
import { resolveCommandDenyRules } from './commandDenyRules';
import { resolveCommandAllowRules } from './commandAllowRules';
import { resolveIdleTimeoutMs, resolveSessionIdleTimeoutMinutes } from '../gateway/idleTimeout';
import {
    resolveApprovalTtlSeconds,
    resolveBridgeCodeTtlSeconds,
    resolveBridgeRequestMs,
    resolveBrowserLaunchWaitMs,
    resolveCommandExecutionMaxMs,
    resolveCommandExecutionMs,
    resolveToolCallMs,
    resolveWriteLockTimeoutMs
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
    /** Rotates every browser session token; returns how many were revoked. */
    disconnectAllBrowsers(): number;
    markAutoStopped(idleTimeoutMs: number): void;
    markBridgeConnected(): void;
    markOffline(): void;
    getState(): GatewayServiceSnapshot;
}

interface CreateGatewayServiceControllerOptions {
    manager: GatewayManager;
    config: ConfigStore;
    pairing: PairingUI;
    sessionStore: SessionStore;
    workspace: WorkspaceProvider;
    outputChannel: vscode.OutputChannel;
    statusBarItem: vscode.StatusBarItem;
    persistentLogger: PersistentLogger;
}

export function createGatewayServiceController(options: CreateGatewayServiceControllerOptions): GatewayServiceController {
    let currentPort: number | null = null;
    let isStarting = false;
    let isRunning = false;
    const getState = () => ({ currentPort, isStarting, isRunning });
    // The bridge session table is the source of truth for how many tabs are
    // connected; hot restarts keep it, cold restarts and stop revoke it.
    const updateStatus = () => updateGatewayStatusBar(options.statusBarItem, {
        online: isRunning,
        port: currentPort ?? undefined,
        bridgeConnected: options.manager.hasActiveBridgeSession(),
        sessionCount: options.manager.getBridgeSessionCount()
    });
    const issueBridgeCode = createBridgeCodeIssuer(options.manager, getState);
    const disconnectAllBrowsers = createDisconnectAllBrowsers(options.manager, updateStatus);

    const resetToOffline = () => {
        isStarting = false;
        isRunning = false;
        currentPort = null;
        updateStatus();
    };

    const start = async (startOptions?: GatewayLifecycleOptions) => {
        if (!hasWorkspaceFolder(options.workspace)) {
            if (isRunning || isStarting) {
                await options.manager.stop();
            }
            resetToOffline();
            options.pairing.notifyError(t('start_requires_workspace'));
            return;
        }

        // Set Loading State
        isStarting = true;
        updateGatewayStatusBar(options.statusBarItem, { online: false, isLoading: true });

        const config = options.config;
        const portConfig = config.get<number>('port') ?? 34567;
        const startParams = buildStartParams(config, options);

        try {
            const result = await options.manager.start(buildGatewayStartConfig(portConfig, startParams), startOptions);

            currentPort = result.port;
            if (currentPort !== startParams.lastUsedPort) {
                await options.sessionStore.setLastPort(currentPort);
            }

            isStarting = false;
            isRunning = true;
            updateStatus();
            options.persistentLogger.info(`Gateway started on port ${currentPort}.`);
        } catch (error: unknown) {
            options.pairing.notifyError(t('start_failed', { message: getErrorMessage(error) }));
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
        options.pairing.notify(t('server_stopped'));
    };

    const restart = async () => {
        options.outputChannel.appendLine("🔄 Manual restart triggered.");
        options.persistentLogger.info('Gateway restart requested by user.');
        await options.manager.stop();
        await start();
        options.pairing.notify(t('server_restarted'));
    };

    const markAutoStopped = (idleTimeoutMs: number) => {
        markOffline();
        const minutes = Math.round(idleTimeoutMs / (60 * 1000));
        options.pairing.notify(t('auto_stop_message', { minutes }));
        options.outputChannel.appendLine("💤 Auto-shutdown triggered due to inactivity.");
        options.persistentLogger.warn(`Gateway auto-stopped after ${minutes} minutes of inactivity.`);
    };

    return {
        start,
        stop,
        restart,
        issueBridgeCode,
        disconnectAllBrowsers,
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

/** Rotates every browser session token, then mirrors the new count in the status bar. */
function createDisconnectAllBrowsers(manager: GatewayManager, updateStatus: () => void): () => number {
    return () => {
        const revoked = manager.disconnectAllBridgeSessions();
        updateStatus();
        return revoked;
    };
}

interface GatewayStartParams {
    idleTimeoutMs: number;
    sessionIdleTimeoutMinutes: number;
    writeLockTimeoutMs: number;
    commandConfig: CommandExecutionConfig;
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
    config: ConfigStore,
    options: CreateGatewayServiceControllerOptions
): GatewayStartParams {
    const aiSites = getConfiguredAiSites(config.get<AISiteConfig[]>('aiSites'));
    return {
        idleTimeoutMs: resolveIdleTimeoutMs(config.get<number>('idleTimeoutMinutes')),
        sessionIdleTimeoutMinutes: resolveSessionIdleTimeoutMinutes(config.get<number>('sessionIdleTimeoutMinutes')),
        writeLockTimeoutMs: resolveWriteLockTimeoutMs(config.get<number>('writeLockTimeoutMs')),
        commandConfig: getCommandExecutionConfig(config, options),
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
        lastUsedPort: options.sessionStore.getLastPort(),
        aiSites,
        allowedOrigins: buildAllowedOrigins(aiSites)
    };
}

function getCommandShellPath(config: ConfigStore): string | undefined {    const configuredCommandShellPath = config.get<string>('commandShell.path')?.trim();
    return configuredCommandShellPath === '' ? undefined : configuredCommandShellPath;
}

export interface CommandExecutionConfig {
    commandAllowedRoots: string[];
    commandDenyRules: string[];
    commandAllowRules: string[];
    commandRequireApproval: boolean;
    commandShellPath?: string;
}

function getCommandExecutionConfig(
    config: ConfigStore,
    options: CreateGatewayServiceControllerOptions
): CommandExecutionConfig {
    const workspaceRoot = options.workspace.getPrimaryWorkspaceRoot() ?? '';
    return {
        commandShellPath: getCommandShellPath(config),
        commandAllowedRoots: resolveCommandAllowedRoots(
            config.get<string[]>('command.allowedRoots') ?? [],
            workspaceRoot,
            options.outputChannel
        ),
        commandDenyRules: resolveCommandDenyRules(
            config.get<string[]>('command.denyRules'),
            options.outputChannel
        ),
        commandAllowRules: resolveCommandAllowRules(
            config.get<string[]>('command.allowRules'),
            options.outputChannel
        ),
        commandRequireApproval: config.get<boolean>('command.requireApproval') ?? true
    };
}

/** Assembles the GatewayConfig for one start from the resolved start params. */
function buildGatewayStartConfig(portConfig: number, startParams: GatewayStartParams): GatewayConfig {
    return {
        port: portConfig,
        idleTimeoutMs: startParams.idleTimeoutMs,
        preferredPort: startParams.lastUsedPort,
        mcpServers: startParams.customServers,
        allowedOrigins: startParams.allowedOrigins,
        aiSites: startParams.aiSites,
        skillDirectories: startParams.skillDirectories,
        sessionIdleTimeoutMinutes: startParams.sessionIdleTimeoutMinutes,
        writeLockTimeoutMs: startParams.writeLockTimeoutMs,
        ...startParams.commandConfig,
        ...startParams.timeoutConfig
    };
}

function hasWorkspaceFolder(workspace: WorkspaceProvider): boolean {
    return workspace.getWorkspaceRoots().length > 0;
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

