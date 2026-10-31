import { randomUUID } from 'node:crypto';

import express from 'express';
import type { Server as HttpServer } from 'http';
import * as vscode from 'vscode';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { getErrorMessage } from './gateway/errorUtils';
import { resolveCommandConfig } from './gateway/commandConfig';
import { SkillManager } from './skillManager';
import { TerminalSessionManager } from './terminalSessionManager';
import {
    createLocalToolMap,
    type LocalTool,
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
import type { InFlightToolCall } from './extension/shutdownSnapshot';
import { seedSessionToken, type SessionTokenSource } from './extension/sessionToken';
import { getPrimaryWorkspaceRoot, getWorkspaceRoots } from './extension/workspaceRoots';
import { InFlightCallRegistry } from './gateway/inFlightCalls';
import { DEFAULT_MAX_CONCURRENT_TOOL_CALLS, ToolConcurrencyGate } from './gateway/toolConcurrency';
import { DEFAULT_IDLE_TIMEOUT_MINUTES, formatIdleTimeoutMinutes } from './gateway/idleTimeout';
import * as timeouts from './gateway/timeouts';
import {
    createAuthMiddleware,
    createCorsMiddleware,
    createGatewayActivityMiddleware,
    createInFlightRequestMiddleware,
    createRequestLoggerMiddleware,
    createShutdownGuardMiddleware
} from './gateway/middleware';
import { connectToConfiguredServers } from './gateway/serverConnector';
import { registerToolRoutes } from './gateway/toolRoutes';
import type { ToolCallHandlerOptions } from './gateway/toolCallRoute';
import {
    findToolDefinition,
    listToolDefinitions,
    type ToolDefinitionSources
} from './gateway/toolDefinitions';
import type {
    ConnectedClient,
    GatewayConfig,
    RemoteToolRoute,
    ServerConfig,
    StartResult
} from './gateway/types';
import type { GatewayRuntimeTraceSink } from './gateway/runtimeTrace';
import { CommandApprovalManager, DEFAULT_APPROVAL_TTL_MS } from './gateway/commandApproval';
import type { ApprovalAuditSink } from './gateway/approvalAudit';
import { registerPairingRoutes, type SessionRequestPrompt } from './gateway/pairingRoutes';
import { readBrowserBridgeBuild, resolveExtensionVersion } from './gateway/buildInfo';
import { listenOnAvailablePort } from './gateway/portListener';

/** QA-calibrated: one long MCP call spanning 4 idle periods; re-verify once Phase 1 config lands. */
const MAX_WATCHDOG_POSTPONEMENTS = 3;

export interface GatewayLifecycleOptions {
    /**
     * Deactivate path only: skip the MCP client shutdown handshake so the whole
     * stop stays inside the extension-host teardown budget.
     */
    fast?: boolean;
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
    private commandDenyRules: string[] = [];
    private commandAllowRules: string[] = [];
    private commandRequireApproval = true;
    private toolCallMs = timeouts.DEFAULT_TOOL_CALL_MS;
    private commandExecutionMs = timeouts.DEFAULT_COMMAND_EXECUTION_MS;
    private commandExecutionMaxMs = timeouts.DEFAULT_COMMAND_EXECUTION_MAX_MS;
    private bridgeRequestMs = timeouts.DEFAULT_BRIDGE_REQUEST_MS;
    private readonly commandApprovalManager = new CommandApprovalManager();
    private readonly bridgeSessionManager = new BridgeSessionManager();
    private readonly traceSink: GatewayRuntimeTraceSink | undefined;
    private approvalAuditSink: ApprovalAuditSink | undefined;
    private onBridgeSessionActivated: (() => void) | null = null;
    private onSessionRequestConfirmation: ((prompt: SessionRequestPrompt) => Promise<boolean>) | null = null;
    private currentPort: number | null = null;
    private startedAt: string | null = null;
    private gatewayInstanceId = randomUUID();
    private browserLaunchWaitMs = timeouts.DEFAULT_BROWSER_LAUNCH_WAIT_MS;
    private shuttingDown = false;
    private bridgeSessionTokenProvider: SessionTokenSource | null = null;
    private lastInterrupted: { count: number; savedAt: string } | null = null;
    private readonly inFlightCalls = new InFlightCallRegistry(toolName => this.toolRouter.get(toolName)?.serverId);
    private readonly toolConcurrencyGate = new ToolConcurrencyGate(DEFAULT_MAX_CONCURRENT_TOOL_CALLS);

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

    /** Extension hook: a browser tab redeemed a launch code and is now live. */
    setBridgeSessionActivatedHandler(handler: (() => void) | null): void {
        this.onBridgeSessionActivated = handler;
    }

    /** Extension hook: every approval decision is appended to the audit log. */
    setApprovalAuditSink(sink: ApprovalAuditSink | undefined): void { this.approvalAuditSink = sink; }

    /** True while a browser tab holds a session token (the token is the truth). */
    hasActiveBridgeSession(): boolean {
        return this.bridgeSessionManager.hasActiveSession();
    }

    /**
     * Extension hook: asks the user to approve a pairing request. With no handler
     * registered the pairing route declines, so an unwired gateway cannot pair.
     */
    setSessionRequestConfirmationHandler(
        handler: ((prompt: SessionRequestPrompt) => Promise<boolean>) | null
    ): void {
        this.onSessionRequestConfirmation = handler;
    }

    /** Extension hook: persisted token source plus the previous session's loss report. */
    setResumeState(state: {
        tokenProvider: SessionTokenSource | null;
        lastInterrupted: { count: number; savedAt: string } | null;
    }): void {
        this.bridgeSessionTokenProvider = state.tokenProvider;
        this.lastInterrupted = state.lastInterrupted;
    }

    /** Rejects new work; called first thing in `deactivate()`. */
    markShuttingDown(): void { this.shuttingDown = true; }

    /** Tool calls running right now (notification only, never replayed). */
    getInFlightToolCalls(): InFlightToolCall[] { return this.inFlightCalls.snapshot(); }

    private toolDefinitionSources(): ToolDefinitionSources {
        return {
            localTools: this.localTools,
            toolRouter: this.toolRouter,
            context: {
                commandShellPath: this.commandShellPath,
                commandExecutionMs: this.commandExecutionMs,
                commandExecutionMaxMs: this.commandExecutionMaxMs
            }
        };
    }

    private getToolDefinition(name: string): ToolDefinition | null {
        return findToolDefinition(this.toolDefinitionSources(), name);
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

    private createToolExecutionContext(): ToolExecutionContext {
        return {
            workspaceRoot: getPrimaryWorkspaceRoot(),
            workspaceRoots: getWorkspaceRoots(),
            outputChannel: this.outputChannel,
            skillManager: this.skillManager,
            terminalSessionManager: this.terminalSessionManager,
            skillDirectories: this.skillDirectories,
            commandShellPath: this.commandShellPath,
            commandAllowedRoots: this.commandAllowedRoots,
            commandExecutionMs: this.commandExecutionMs,
            commandExecutionMaxMs: this.commandExecutionMaxMs,
            commandDenyRules: this.commandDenyRules,
            commandAllowRules: this.commandAllowRules,
            commandRequireApproval: this.commandRequireApproval,
            listTools: () => listToolDefinitions(this.toolDefinitionSources()),
            getToolDefinition: (name: string) => this.getToolDefinition(name)
        };
    }

    async connectToServers(servers: Record<string, ServerConfig>) {
        this.connectedClients = await connectToConfiguredServers({
            connectedClients: this.connectedClients,
            extensionPath: this.extensionPath,
            clientVersion: this.getExtensionVersion(),
            log: this.log.bind(this),
            error: this.error.bind(this),
            servers,
            toolRouter: this.toolRouter,
            workspaceRoot: getPrimaryWorkspaceRoot()
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

        this.app.use(createShutdownGuardMiddleware(() => this.shuttingDown));
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
            getGatewayInstanceId: () => this.gatewayInstanceId,
            getIdleTimeoutMs: () => this.idleTimeoutMs,
            getBridgeRequestMs: () => this.bridgeRequestMs,
            getWorkspaceRoot: () => getPrimaryWorkspaceRoot(),
            log: this.log.bind(this),
            recordActivity: () => this.resetWatchdog(),
            onSessionActivated: () => this.onBridgeSessionActivated?.()
        });
        // Discovery and pairing are the only unauthenticated surface: a browser
        // without a session cannot present a token yet. Their own guard rails
        // (origin allowlist, JSON-only, rate window, modal approval) live in
        // pairingRoutes.ts.
        registerPairingRoutes(this.app, {
            getAiSites: () => this.currentAiSites,
            getBridgeCodeTtlMs: () => this.bridgeSessionManager.getBridgeCodeTtlMs(),
            getPort: () => this.currentPort,
            getWorkspaceRoot: () => getPrimaryWorkspaceRoot(),
            hasActiveSession: () => this.bridgeSessionManager.hasActiveSession(),
            issueBridgeCode: (siteId, targetUrl) => this.issueBridgeCode(siteId, targetUrl),
            requestUserConfirmation: prompt => this.onSessionRequestConfirmation
                ? this.onSessionRequestConfirmation(prompt)
                : Promise.resolve(false),
            log: this.log.bind(this)
        });
        this.app.use(createAuthMiddleware(
            token => this.bridgeSessionManager.isSessionTokenValid(token),
            this.log.bind(this)
        ));
        this.app.use(createGatewayActivityMiddleware(() => this.resetWatchdog()));

        registerConfigRoutes(this.app, config, this.log.bind(this), {
            extensionVersion: this.getExtensionVersion(),
            buildHash: readBrowserBridgeBuild(this.extensionPath)?.buildHash ?? null,
            bridgeProtocolVersion: BRIDGE_PROTOCOL_VERSION,
            startedAt: this.startedAt,
            gatewayInstanceId: this.gatewayInstanceId,
            lastInterrupted: this.lastInterrupted
        });

        const toolCallOptions: ToolCallHandlerOptions = {
            audit: this.approvalAuditSink,
            concurrencyGate: this.toolConcurrencyGate,
            commandApprovalManager: this.commandApprovalManager,
            createToolExecutionContext: () => this.createToolExecutionContext(),
            error: this.error.bind(this),
            getToolCallTimeoutMs: () => this.toolCallMs,
            getToolDefinition: (name: string) => this.getToolDefinition(name),
            getWorkspaceRoot: () => getPrimaryWorkspaceRoot(),
            localTools: this.localTools,
            log: this.log.bind(this),
            onToolCallEnd: callId => this.inFlightCalls.end(callId),
            onToolCallStart: info => this.inFlightCalls.start(info),
            trace: this.trace.bind(this),
            toolRouter: this.toolRouter
        };
        registerToolRoutes({
            app: this.app,
            approvalAuditSink: this.approvalAuditSink,
            commandApprovalManager: this.commandApprovalManager,
            toolCallOptions
        });
    }

    private getExtensionVersion(): string {
        return resolveExtensionVersion(this.context);
    }

    async start(config: GatewayConfig, options?: GatewayLifecycleOptions): Promise<StartResult> {
        const preserveBridgeSession = options?.preserveBridgeSession === true;
        if (this.server) {
            await this.stop({ preserveBridgeSession });
        }
        this.shuttingDown = false;
        this.gatewayInstanceId = randomUUID();
        this.skillDirectories = config.skillDirectories ?? [];
        Object.assign(this, resolveCommandConfig(config));
        this.currentAiSites = config.aiSites ?? [];
        this.idleTimeoutMs = config.idleTimeoutMs;
        // Resolved here as well so a direct GatewayManager caller cannot bypass
        // the documented ranges, even though the extension already resolves
        // these values from the webcodeGateway.timeouts settings.
        this.toolCallMs = timeouts.resolveToolCallMs(config.toolCallMs);
        this.commandExecutionMs = timeouts.resolveCommandExecutionMs(config.commandExecutionMs);
        this.commandExecutionMaxMs = timeouts.resolveCommandExecutionMaxMs(config.commandExecutionMaxMs);
        this.bridgeRequestMs = timeouts.resolveBridgeRequestMs(config.bridgeRequestMs);
        this.browserLaunchWaitMs = config.browserLaunchWaitMs === undefined
            ? timeouts.DEFAULT_BROWSER_LAUNCH_WAIT_MS
            : timeouts.resolveBrowserLaunchWaitMs(config.browserLaunchWaitMs);
        // TTLs arrive already clamped in milliseconds (the extension resolves
        // seconds-native settings), and are retargeted instead of recreating the
        // managers: a hot reload must keep the bridge session token that
        // connected tabs already hold.
        this.bridgeSessionManager.setBridgeCodeTtlMs(config.bridgeCodeTtlMs ?? DEFAULT_BRIDGE_CODE_TTL_MS);
        this.commandApprovalManager.setTtlMs(config.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS);
        this.commandApprovalManager.clear();
        // One line with every resolved deadline, so "what is this gateway
        // actually enforcing?" is answerable from the log instead of guessing
        // whether a setting was picked up.
        this.log(
            `⏱️ timeouts: toolCallMs=${this.toolCallMs} commandExecutionMs=${this.commandExecutionMs} ` +
            `commandExecutionMaxMs=${this.commandExecutionMaxMs} commandDenyRules=${this.commandDenyRules.length} commandAllowRules=${this.commandAllowRules.length} requireApproval=${this.commandRequireApproval} ` +
            `bridgeRequestMs=${this.bridgeRequestMs} bridgeCodeTtlMs=${this.bridgeSessionManager.getBridgeCodeTtlMs()} ` +
            `approvalTtlMs=${this.commandApprovalManager.getTtlMs()} browserLaunchWaitMs=${this.browserLaunchWaitMs} ` +
            `idleTimeoutMs=${this.idleTimeoutMs}`
        );
        this.startedAt = new Date().toISOString();
        // Bridge session token lifecycle: the token is revoked on every cold
        // start (fresh launch, manual stop/start, cold configuration keys such
        // as port or idleTimeoutMinutes). Hot configuration reloads (servers,
        // skillDirectories, commandShell.path, command.allowedRoots) pass
        // preserveBridgeSession so connected browser tabs keep using the
        // token they already hold instead of being logged out mid-session.
        if (!preserveBridgeSession) {
            this.bridgeSessionManager.clear();
        }
        // Re-seed from the persisted source on every start (including cold
        // starts): this is what lets a reconnecting tab keep its token.
        await seedSessionToken(this.bridgeSessionManager, this.bridgeSessionTokenProvider, message => this.error(message));
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

        const bound = await this.listenOnAvailablePort(config);
        return { ...bound, instanceId: this.gatewayInstanceId, startedAt: this.startedAt ?? undefined };
    }

    private listenOnAvailablePort(config: GatewayConfig): Promise<StartResult> {
        return listenOnAvailablePort({
            app: this.app as express.Express,
            config,
            log: this.log.bind(this),
            trace: this.trace.bind(this),
            onBound: (port, server) => {
                this.currentPort = port;
                this.server = server;
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
        this.startedAt = null;
        if (this.server) {
            this.server.close();
            this.server = null;
            this.currentPort = null;
            this.log('🛑 Gateway server stopped.');
            this.trace({ event: 'gateway_stopped', status: 'success' });
        }
        if (options?.fast !== true) {
            this.connectedClients.forEach(c => {
                try {
                    void c.client.close();
                } catch { }
            });
        }
        this.connectedClients = [];
        // Abort before clear so a still-running call performs its own cleanup.
        this.inFlightCalls.abortAll(new Error('gateway stopped'));
        this.inFlightCalls.clear();
        this.commandApprovalManager.clear();
        if (!options?.preserveBridgeSession) {
            this.bridgeSessionManager.clear();
        }
        this.currentAiSites = [];
    }
}
