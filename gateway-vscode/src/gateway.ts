import express from 'express';
import type { Server as HttpServer } from 'http';
import * as vscode from 'vscode';
import { BRIDGE_PORT_RANGE_END, BRIDGE_PORT_RANGE_START } from '@webcode/shared';

import { getErrorMessage } from './gateway/errorUtils';
import { SkillManager } from './skillManager';
import { TerminalSessionManager } from './terminalSessionManager';
import {
    createLocalToolMap,
    type LocalTool,
    type ToolDefinitionContext,
    type ToolDefinition,
    type ToolExecutionContext
} from './tools';
import {
    registerBridgeRoute,
    resolveAllowedBridgeTarget,
    resolveBridgeSite
} from './gateway/bridgeRoute';
import { BridgeSessionManager, DEFAULT_BRIDGE_CODE_TTL_MS } from './gateway/bridgeSession';
import { registerConfigRoutes } from './gateway/initRoutes';
import { DEFAULT_IDLE_TIMEOUT_MINUTES, formatIdleTimeoutMinutes } from './gateway/idleTimeout';
import * as timeouts from './gateway/timeouts';
import {
    createAuthMiddleware,
    createCorsMiddleware,
    createGatewayActivityMiddleware,
    createInFlightRequestMiddleware,
    createRequestLoggerMiddleware
} from './gateway/middleware';
import { connectToConfiguredServers } from './gateway/serverConnector';
import {
    createToolApprovalHandler,
    createToolCallHandler,
    createToolPreflightHandler
} from './gateway/toolCallRoute';
import { generateGroupedTools } from './gateway/toolGroups';
import type {
    ConnectedClient,
    GatewayConfig,
    RemoteToolRoute,
    ServerConfig,
    StartResult
} from './gateway/types';
import type { GatewayRuntimeTraceSink } from './gateway/runtimeTrace';
import { CommandApprovalManager, DEFAULT_APPROVAL_TTL_MS } from './gateway/commandApproval';

/**
 * The browser bridge content scripts only match the loopback port window
 * 34567-34576, so the gateway scans at most this many consecutive ports
 * starting from the configured one. Landing outside the window leaves the
 * bridge page without an injected extension.
 */
const MAX_PORT_RETRY_ATTEMPTS = BRIDGE_PORT_RANGE_END - BRIDGE_PORT_RANGE_START + 1;

/**
 * QA-calibrated value: covers the worst case of one long MCP tool call
 * spanning 4 idle periods. Calibration method: once the Phase 1 timeout
 * configuration lands, re-verify this bound against the default toolCallMs
 * budget.
 */
const MAX_WATCHDOG_POSTPONEMENTS = 3;

export interface GatewayLifecycleOptions {
    /**
     * Keep the browser bridge session token (and pending launch codes) across
     * this stop/start cycle. Used by hot configuration reloads so connected
     * browser tabs keep working with the token they already hold. Cold starts
     * and cold configuration changes always revoke the token.
     */
    preserveBridgeSession?: boolean;
}

export class GatewayManager {
    private app: express.Express | null = null;
    private server: HttpServer | null = null;
    private toolRouter = new Map<string, RemoteToolRoute>();
    private connectedClients: ConnectedClient[] = [];
    private localTools: Map<string, LocalTool> = createLocalToolMap();
    private outputChannel: vscode.OutputChannel;
    private extensionPath: string;
    private context: vscode.ExtensionContext;
    private watchdogTimer: NodeJS.Timeout | null = null;
    private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000;
    private inFlightRequestCount = 0;
    private watchdogPostponements = 0;
    private onAutoStop: ((idleTimeoutMs: number) => void) | null = null;
    private skillManager: SkillManager;
    private terminalSessionManager: TerminalSessionManager;
    private skillDirectories: string[] = [];
    private currentAiSites: NonNullable<GatewayConfig['aiSites']> = [];
    private commandShellPath: string | undefined;
    private commandAllowedRoots: string[] = [];
    private toolCallMs = timeouts.DEFAULT_TOOL_CALL_MS;
    private commandExecutionMs = timeouts.DEFAULT_COMMAND_EXECUTION_MS;
    private bridgeRequestMs = timeouts.DEFAULT_BRIDGE_REQUEST_MS;
    private readonly commandApprovalManager = new CommandApprovalManager();
    private readonly bridgeSessionManager = new BridgeSessionManager();
    private readonly traceSink: GatewayRuntimeTraceSink | undefined;

    constructor(
        outputChannel: vscode.OutputChannel,
        extensionPath: string,
        context: vscode.ExtensionContext,
        onAutoStop?: (idleTimeoutMs: number) => void,
        traceSink?: GatewayRuntimeTraceSink
    ) {
        this.outputChannel = outputChannel;
        this.extensionPath = extensionPath;
        this.context = context;
        this.onAutoStop = onAutoStop ?? null;
        this.traceSink = traceSink;
        this.skillManager = new SkillManager(outputChannel, extensionPath, () => vscode.workspace.workspaceFolders);
        this.terminalSessionManager = new TerminalSessionManager(outputChannel);
    }

    private _generateGroupedTools() {
        return generateGroupedTools(this.toolRouter, this.localTools, tool => this.getLocalToolDefinition(tool));
    }

    private getToolDefinition(name: string): ToolDefinition | null {
        const localTool = this.localTools.get(name);
        if (localTool) {
            return this.getLocalToolDefinition(localTool);
        }

        return this.toolRouter.get(name)?.definition ?? null;
    }

    private getLocalToolDefinition(tool: LocalTool): ToolDefinition {
        return tool.getDefinition?.(this.createToolDefinitionContext()) ?? tool.definition;
    }

    private createToolDefinitionContext(): ToolDefinitionContext {
        return {
            commandShellPath: this.commandShellPath,
            commandExecutionMs: this.commandExecutionMs
        };
    }

    private resetWatchdog() {
        if (this.watchdogTimer) {clearTimeout(this.watchdogTimer);}
        // Genuine activity starts a fresh idle window, including the budget
        // of in-flight postponements.
        this.watchdogPostponements = 0;
        this.watchdogTimer = setTimeout(() => this.handleWatchdogFired(), this.idleTimeoutMs);
    }

    private handleWatchdogFired() {
        if (this.inFlightRequestCount > 0 && this.watchdogPostponements < MAX_WATCHDOG_POSTPONEMENTS) {
            this.watchdogPostponements += 1;
            this.log(`⏳ ${this.inFlightRequestCount} request(s) still in flight. Postponing idle shutdown (${this.watchdogPostponements}/${MAX_WATCHDOG_POSTPONEMENTS}).`);
            this.watchdogTimer = setTimeout(() => this.handleWatchdogFired(), this.idleTimeoutMs);
            return;
        }

        if (this.inFlightRequestCount > 0) {
            this.log(`⚠️ Forcing idle shutdown with ${this.inFlightRequestCount} request(s) still in flight after ${MAX_WATCHDOG_POSTPONEMENTS} postponements.`);
        }
        this.log(`💤 No activity for ${formatIdleTimeoutMinutes(this.idleTimeoutMs)} minutes. Shutting down...`);
        void this.stop();
        if (this.onAutoStop) {this.onAutoStop(this.idleTimeoutMs);}
    }

    private log(message: string) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        this.outputChannel.appendLine(`[${time}] ${message}`);
    }

    private error(message: string, err?: unknown) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        this.outputChannel.appendLine(`[${time}] ❌ ${message} ${getErrorMessage(err)}`);
    }

    private trace(event: Parameters<GatewayRuntimeTraceSink>[0]): void {
        this.traceSink?.(event);
    }

    invalidateSkillCache(reason?: string) {
        this.skillManager.invalidateCache(reason);
    }

    private getPrimaryWorkspaceRoot(): string | null {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    }

    private createToolExecutionContext(): ToolExecutionContext {
        return {
            workspaceRoot: this.getPrimaryWorkspaceRoot(),
            outputChannel: this.outputChannel,
            skillManager: this.skillManager,
            terminalSessionManager: this.terminalSessionManager,
            skillDirectories: this.skillDirectories,
            commandShellPath: this.commandShellPath,
            commandAllowedRoots: this.commandAllowedRoots,
            commandExecutionMs: this.commandExecutionMs,
            listTools: () => this._generateGroupedTools(),
            getToolDefinition: (name: string) => this.getToolDefinition(name)
        };
    }

    async connectToServers(servers: Record<string, ServerConfig>) {
        this.connectedClients = await connectToConfiguredServers({
            connectedClients: this.connectedClients,
            extensionPath: this.extensionPath,
            log: this.log.bind(this),
            error: this.error.bind(this),
            servers,
            toolRouter: this.toolRouter,
            workspaceRoot: this.getPrimaryWorkspaceRoot()
        });
    }

    issueBridgeCode(siteId: string, targetUrl: string): string {
        if (!this.server) {
            throw new Error('Gateway server is not running.');
        }

        const site = resolveBridgeSite(siteId, this.currentAiSites);
        const resolvedTarget = site ? resolveAllowedBridgeTarget(targetUrl, site) : null;
        if (!site || !resolvedTarget) {
            throw new Error('Bridge target does not match a configured AI site.');
        }

        return this.bridgeSessionManager.issueBridgeCode({
            siteId: site.id,
            targetUrl: resolvedTarget
        });
    }

    private registerRoutes(config: GatewayConfig): void {
        if (!this.app) {return;}

        this.app.use(createInFlightRequestMiddleware(
            () => { this.inFlightRequestCount += 1; },
            () => { this.inFlightRequestCount = Math.max(0, this.inFlightRequestCount - 1); }
        ));
        this.app.use(createCorsMiddleware(config, this.log.bind(this)));
        this.app.use(createRequestLoggerMiddleware(this.log.bind(this)));
        registerBridgeRoute(this.app, {
            activateSession: () => this.bridgeSessionManager.activateSession(),
            consumeBridgeCode: code => this.bridgeSessionManager.consumeBridgeCode(code),
            getBridgeLaunch: code => this.bridgeSessionManager.getBridgeLaunch(code),
            getAiSites: () => config.aiSites ?? [],
            getExtensionVersion: () => this.getExtensionVersion(),
            getIdleTimeoutMs: () => this.idleTimeoutMs,
            getBridgeRequestMs: () => this.bridgeRequestMs,
            getWorkspaceRoot: () => this.getPrimaryWorkspaceRoot(),
            log: this.log.bind(this),
            recordActivity: () => this.resetWatchdog()
        });
        this.app.use(createAuthMiddleware(
            token => this.bridgeSessionManager.isSessionTokenValid(token),
            this.log.bind(this)
        ));
        this.app.use(createGatewayActivityMiddleware(() => this.resetWatchdog()));

        registerConfigRoutes(this.app, config, this.log.bind(this));

        const toolCallOptions = {
            commandApprovalManager: this.commandApprovalManager,
            createToolExecutionContext: () => this.createToolExecutionContext(),
            error: this.error.bind(this),
            getToolCallTimeoutMs: () => this.toolCallMs,
            getToolDefinition: (name: string) => this.getToolDefinition(name),
            getWorkspaceRoot: () => this.getPrimaryWorkspaceRoot(),
            localTools: this.localTools,
            log: this.log.bind(this),
            trace: this.trace.bind(this),
            toolRouter: this.toolRouter
        };
        this.app.post('/v1/tools/preflight', createToolPreflightHandler(toolCallOptions));
        this.app.post('/v1/tools/approve', createToolApprovalHandler(this.commandApprovalManager));
        this.app.post('/v1/tools/call', createToolCallHandler(toolCallOptions));
    }

    private getExtensionVersion(): string {
        const version = (this.context.extension.packageJSON as { version?: unknown }).version;
        return typeof version === 'string' && version.trim() ? version : 'unknown';
    }

    async start(config: GatewayConfig, options?: GatewayLifecycleOptions): Promise<StartResult> {
        const preserveBridgeSession = options?.preserveBridgeSession === true;
        if (this.server) {
            await this.stop({ preserveBridgeSession });
        }
        this.skillDirectories = config.skillDirectories ?? [];
        const commandShellPath = config.commandShellPath?.trim();
        this.commandShellPath = commandShellPath === '' ? undefined : commandShellPath;
        this.commandAllowedRoots = config.commandAllowedRoots ?? [];
        this.currentAiSites = config.aiSites ?? [];
        this.idleTimeoutMs = config.idleTimeoutMs;
        // Resolved here as well so a direct GatewayManager caller cannot bypass
        // the documented ranges, even though the extension already resolves
        // these values from the webcodeGateway.timeouts settings.
        this.toolCallMs = timeouts.resolveToolCallMs(config.toolCallMs);
        this.commandExecutionMs = timeouts.resolveCommandExecutionMs(config.commandExecutionMs);
        this.bridgeRequestMs = timeouts.resolveBridgeRequestMs(config.bridgeRequestMs);
        // TTLs arrive already clamped in milliseconds (the extension resolves
        // seconds-native settings), and are retargeted instead of recreating the
        // managers: a hot reload must keep the bridge session token that
        // connected tabs already hold.
        this.bridgeSessionManager.setBridgeCodeTtlMs(config.bridgeCodeTtlMs ?? DEFAULT_BRIDGE_CODE_TTL_MS);
        this.commandApprovalManager.setTtlMs(config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS);
        this.commandApprovalManager.clear();
        // Bridge session token lifecycle: the token is revoked on every cold
        // start (fresh launch, manual stop/start, cold configuration keys such
        // as port or idleTimeoutMinutes). Hot configuration reloads (servers,
        // skillDirectories, commandShell.path, command.allowedRoots) pass
        // preserveBridgeSession so connected browser tabs keep using the
        // token they already hold instead of being logged out mid-session.
        if (!preserveBridgeSession) {
            this.bridgeSessionManager.clear();
        }
        this.trace({
            event: 'gateway_starting',
            status: 'started',
            details: { requestedPort: config.port }
        });
        await this.connectToServers(config.mcpServers);

        // Start Watchdog
        this.resetWatchdog();

        this.app = express();
        this.app.use(express.json());
        this.registerRoutes(config);

        return this.listenOnAvailablePort(config);
    }

    private listenOnAvailablePort(config: GatewayConfig): Promise<StartResult> {
        return new Promise<StartResult>((resolve, reject) => {
            const tryListen = (currentPort: number, attempt: number) => {
                if (attempt >= MAX_PORT_RETRY_ATTEMPTS) {
                    reject(new Error("No ports available"));
                    return;
                }

                if (!this.app) {return;}
                this.server = this.app.listen(currentPort, '127.0.0.1', () => {
                    this.log(`🌐 Gateway running on http://127.0.0.1:${currentPort}`);
                    if (currentPort < BRIDGE_PORT_RANGE_START || currentPort > BRIDGE_PORT_RANGE_END) {
                        this.log(`⚠️ Port ${currentPort} is outside the browser bridge supported range ${BRIDGE_PORT_RANGE_START}-${BRIDGE_PORT_RANGE_END}. The browser extension will not inject on this port; check the webcodeGateway.port setting.`);
                    }
                    this.trace({
                        event: 'gateway_started',
                        status: 'success',
                        details: { port: currentPort }
                    });
                    vscode.window.setStatusBarMessage(`MCP Gateway: On (${currentPort})`, 5000);
                    resolve({ port: currentPort });
                });

                this.server.on('error', (e: NodeJS.ErrnoException) => {
                    if (e.code === 'EADDRINUSE') {
                        // Fix: Prevent infinite loop if preferredPort equals config.port
                        if (config.preferredPort && currentPort === config.preferredPort && currentPort !== config.port) {
                            this.log(`⚠️ Preferred port ${currentPort} busy. Falling back to default range.`);
                            tryListen(config.port, 0);
                        } else {
                            tryListen(currentPort + 1, attempt + 1);
                        }
                    } else {
                        reject(e);
                    }
                });
            };

            if (config.preferredPort && config.preferredPort !== config.port) {
                tryListen(config.preferredPort, 0);
            } else {
                tryListen(config.port, 0);
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async stop(options?: GatewayLifecycleOptions) {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
        this.watchdogPostponements = 0;
        if (this.server) {
            this.server.close();
            this.server = null;
            this.log('🛑 Gateway server stopped.');
            this.trace({ event: 'gateway_stopped', status: 'success' });
        }
        this.connectedClients.forEach(c => {
            try {
                void c.client.close();
            } catch { }
        });
        this.connectedClients = [];
        this.commandApprovalManager.clear();
        if (!options?.preserveBridgeSession) {
            this.bridgeSessionManager.clear();
        }
        this.currentAiSites = [];
    }
}
