import { randomUUID } from 'node:crypto';

import express from 'express';
import type { Server as HttpServer } from 'http';
import { BRIDGE_PROTOCOL_VERSION } from '@webcode/shared';

import { getErrorMessage, formatLogLine } from './gateway/errorUtils';
import { resolveCommandConfig } from './gateway/commandConfig';
import { SkillManager } from './skillManager';
import { TerminalSessionManager } from './terminalSessionManager';
import { GatewayWatchdog } from './gateway/watchdog';
import { createDefaultGatewayHostServices, type ExtensionVersionSource, type GatewayHostServices, type Logger } from './host/types';
import {
    createLocalToolMap,
    type LocalTool,
    type ToolDefinition,
    type ToolExecutionContext
} from './tools';
import {
    registerBridgeRoute,
    issueBridgeCodeForLaunch
} from './gateway/bridgeRoute';
import { BridgeSessionManager, DEFAULT_BRIDGE_CODE_TTL_MS } from './gateway/bridgeSession';
import { registerConfigRoutes } from './gateway/initRoutes';
import type { InFlightToolCall } from './extension/shutdownSnapshot';
import { SessionMaintenance, type SessionPersistenceState } from './gateway/sessionMaintenance';
import { InFlightCallRegistry } from './gateway/inFlightCalls';
import { DEFAULT_MAX_CONCURRENT_TOOL_CALLS, ToolConcurrencyGate } from './gateway/toolConcurrency';
import { DEFAULT_IDLE_TIMEOUT_MINUTES, resolveSessionIdleTimeoutMinutes } from './gateway/idleTimeout';
import * as timeouts from './gateway/timeouts';
import { WriteLock } from './gateway/writeLock';
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
    GatewayLifecycleOptions,
    GatewayManagerHooks,
    RemoteToolRoute,
    StartResult
} from './gateway/types';
import type { GatewayRuntimeTraceSink } from './gateway/runtimeTrace';
import { CommandApprovalManager, DEFAULT_APPROVAL_TTL_MS } from './gateway/commandApproval';
import type { ApprovalAuditSink } from './gateway/approvalAudit';
import { registerPairingRoutes, type SessionRequestPrompt } from './gateway/pairingRoutes';
import { readBrowserBridgeBuild, resolveExtensionVersion } from './gateway/buildInfo';
import { listenOnAvailablePort } from './gateway/portListener';
import { readToolResultCompressionPolicy } from './gateway/compressionPolicy';

export type { GatewayLifecycleOptions, GatewayManagerHooks } from './gateway/types';

export class GatewayManager {
    private app: express.Express | null = null;
    private server: HttpServer | null = null;
    private toolRouter = new Map<string, RemoteToolRoute>();
    private connectedClients: ConnectedClient[] = [];
    private localTools: Map<string, LocalTool> = createLocalToolMap();
    private logger: Logger;
    private extensionPath: string;
    private context: ExtensionVersionSource;
    private readonly host: GatewayHostServices;
    private idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MINUTES * 60 * 1000;
    private inFlightRequestCount = 0;
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
    private lastInterrupted: { count: number; savedAt: string } | null = null;
    private readonly inFlightCalls = new InFlightCallRegistry(toolName => this.toolRouter.get(toolName)?.serverId);
    private readonly toolConcurrencyGate = new ToolConcurrencyGate(DEFAULT_MAX_CONCURRENT_TOOL_CALLS);
    private readonly writeLock = new WriteLock({
        timeoutMs: timeouts.DEFAULT_WRITE_LOCK_TIMEOUT_MS,
        audit: event => this.approvalAuditSink?.(event)
    });
    private readonly sessionMaintenance = new SessionMaintenance(this.bridgeSessionManager, this.writeLock, {
        log: message => this.log(message),
        error: (message, err) => this.error(message, err)
    });
    private readonly watchdog = new GatewayWatchdog({
        idleTimeoutMs: () => this.idleTimeoutMs,
        inFlightCount: () => this.inFlightRequestCount,
        onIdle: idleTimeoutMs => {
            void this.stop();
            this.onAutoStop?.(idleTimeoutMs);
        },
        log: message => this.log(message)
    });

    constructor(
        logger: Logger,
        extensionPath: string,
        context: ExtensionVersionSource,
        hooks: GatewayManagerHooks = {}
    ) {
        this.logger = logger;
        this.extensionPath = extensionPath;
        this.context = context;
        this.onAutoStop = hooks.onAutoStop ?? null;
        this.traceSink = hooks.traceSink;
        this.host = hooks.host ?? createDefaultGatewayHostServices();
        this.skillManager = new SkillManager(logger, extensionPath, () => this.host.workspace.getWorkspaceFolders());
        this.terminalSessionManager = new TerminalSessionManager(logger, this.host.terminal);
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

    /** Live browser session count, after an idle-expiry sweep. */
    getBridgeSessionCount(): number {
        return this.bridgeSessionManager.getSessionCount();
    }

    /**
     * Rotates every browser session token (the disconnect-browsers command):
     * all connected tabs must re-pair. Returns how many sessions were revoked.
     */
    disconnectAllBridgeSessions(): number {
        return this.sessionMaintenance.disconnectAll();
    }

    /** Extension hook: refresh UI that shows the connected-session count. */
    setBridgeSessionsChangedHandler(handler: (() => void) | null): void {
        this.sessionMaintenance.setOnChanged(handler);
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

    /**
     * Extension hook: session persistence plus the legacy-token migration
     * source and the previous session's loss report. The Memento-backed store
     * is the primary restart-continuity source; SecretStorage is only read
     * once to import the pre-upgrade single token.
     */
    setResumeState(state: SessionPersistenceState & {
        lastInterrupted: { count: number; savedAt: string } | null;
    }): void {
        this.sessionMaintenance.configure(state);
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

    private log(message: string) {
        this.logger.info(formatLogLine(message));
    }

    private error(message: string, err?: unknown) {
        this.logger.error(formatLogLine(`❌ ${message} ${getErrorMessage(err)}`));
    }

    private trace(event: Parameters<GatewayRuntimeTraceSink>[0]): void {
        this.traceSink?.(event);
    }

    invalidateSkillCache(reason?: string) {
        this.skillManager.invalidateCache(reason);
    }

    private createToolExecutionContext(): ToolExecutionContext {
        return {
            workspaceRoot: this.host.workspace.getPrimaryWorkspaceRoot(),
            workspaceRoots: this.host.workspace.getWorkspaceRoots(),
            logger: this.logger,
            configStore: this.host.config,
            editorAppRoot: this.host.appRoot,
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

    issueBridgeCode(siteId: string, targetUrl: string): string {
        if (!this.server) {
            throw new Error('Gateway server is not running.');
        }
        return issueBridgeCodeForLaunch(this.bridgeSessionManager, this.currentAiSites, siteId, targetUrl);
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
            activateSession: identity => this.bridgeSessionManager.activateSession(identity),
            consumeBridgeCode: code => this.bridgeSessionManager.consumeBridgeCode(code),
            getBridgeLaunch: code => this.bridgeSessionManager.getBridgeLaunch(code),
            getAiSites: () => config.aiSites ?? [],
            getExtensionVersion: () => resolveExtensionVersion(this.context),
            getGatewayInstanceId: () => this.gatewayInstanceId,
            getIdleTimeoutMs: () => this.idleTimeoutMs,
            getBridgeRequestMs: () => this.bridgeRequestMs,
            getWorkspaceRoot: () => this.host.workspace.getPrimaryWorkspaceRoot(),
            log: this.log.bind(this),
            recordActivity: () => this.watchdog.reset(),
            onSessionActivated: () => {
                this.onBridgeSessionActivated?.();
                this.sessionMaintenance.persist();
            }
        });
        // Discovery and pairing are the only unauthenticated surface: a browser
        // without a session cannot present a token yet. Their own guard rails
        // (origin allowlist, JSON-only, rate window, modal approval) live in
        // pairingRoutes.ts.
        registerPairingRoutes(this.app, {
            getAiSites: () => this.currentAiSites,
            getBridgeCodeTtlMs: () => this.bridgeSessionManager.getBridgeCodeTtlMs(),
            getPort: () => this.currentPort,
            getWorkspaceRoot: () => this.host.workspace.getPrimaryWorkspaceRoot(),
            hasActiveSession: () => this.bridgeSessionManager.hasActiveSession(),
            getSessionCount: () => this.bridgeSessionManager.getSessionCount(),
            issueBridgeCode: (siteId, targetUrl) => this.issueBridgeCode(siteId, targetUrl),
            requestUserConfirmation: prompt => this.onSessionRequestConfirmation
                ? this.onSessionRequestConfirmation(prompt)
                : Promise.resolve(false),
            log: this.log.bind(this)
        });
        this.app.use(createAuthMiddleware(
            token => this.bridgeSessionManager.lookupSession(token),
            this.log.bind(this),
            {
                sweepExpired: () => this.sessionMaintenance.sweepExpired(),
                onSessionsRevoked: tokens => this.writeLock.releaseForTokens(tokens)
            }
        ));
        this.app.use(createGatewayActivityMiddleware(() => this.watchdog.reset()));

        registerConfigRoutes(this.app, config, this.log.bind(this), {
            extensionVersion: resolveExtensionVersion(this.context),
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
            getCompressionPolicy: () => readToolResultCompressionPolicy(this.host.config),
            getToolDefinition: (name: string) => this.getToolDefinition(name),
            getWorkspaceRoot: () => this.host.workspace.getPrimaryWorkspaceRoot(),
            localTools: this.localTools,
            log: this.log.bind(this),
            onToolCallEnd: callId => this.inFlightCalls.end(callId),
            onToolCallStart: info => this.inFlightCalls.start(info),
            trace: this.trace.bind(this),
            toolRouter: this.toolRouter,
            writeLock: this.writeLock
        };
        registerToolRoutes({
            app: this.app,
            approvalAuditSink: this.approvalAuditSink,
            commandApprovalManager: this.commandApprovalManager,
            toolCallOptions
        });
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
        this.bridgeSessionManager.setSessionIdleTimeoutMs(
            resolveSessionIdleTimeoutMinutes(config.sessionIdleTimeoutMinutes) * 60 * 1000
        );
        this.writeLock.setTimeoutMs(timeouts.resolveWriteLockTimeoutMs(config.writeLockTimeoutMs));
        // TTLs arrive already clamped in milliseconds (the extension resolves
        // seconds-native settings), and are retargeted instead of recreating the
        // managers: a hot reload must keep the bridge sessions being preserved.
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
            `idleTimeoutMs=${this.idleTimeoutMs} sessionIdleTimeoutMinutes=${resolveSessionIdleTimeoutMinutes(config.sessionIdleTimeoutMinutes)} ` +
            `writeLockTimeoutMs=${timeouts.resolveWriteLockTimeoutMs(config.writeLockTimeoutMs)}`
        );
        this.startedAt = new Date().toISOString();
        // Bridge session lifecycle: sessions are revoked on every cold start
        // (fresh launch, manual stop/start, cold configuration keys such as
        // port or idleTimeoutMinutes). Hot configuration reloads (servers,
        // skillDirectories, commandShell.path, command.allowedRoots) pass
        // preserveBridgeSession so connected browser tabs keep using the
        // tokens they already hold instead of being logged out mid-session.
        if (!preserveBridgeSession) {
            this.bridgeSessionManager.clear();
        }
        // Re-seed from the persisted source on every start (including cold
        // starts): the session table from workspaceState keeps every connected
        // tab working, and a legacy single token is imported on first start.
        await this.sessionMaintenance.restore();
        this.sessionMaintenance.startSweep();
        this.trace({
            event: 'gateway_starting',
            status: 'started',
            details: { requestedPort: config.port }
        });
        this.connectedClients = await connectToConfiguredServers({
            connectedClients: this.connectedClients,
            extensionPath: this.extensionPath,
            clientVersion: resolveExtensionVersion(this.context),
            log: this.log.bind(this),
            error: this.error.bind(this),
            servers: config.mcpServers,
            toolRouter: this.toolRouter,
            workspaceRoot: this.host.workspace.getPrimaryWorkspaceRoot()
        });

        // Start Watchdog
        this.watchdog.reset();

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
            setStatusBarMessage: (message, timeoutMs) => this.host.pairing.showStatusBarMessage(message, timeoutMs),
            onBound: (port, server) => {
                this.currentPort = port;
                this.server = server;
            }
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async stop(options?: GatewayLifecycleOptions) {
        this.watchdog.stop();
        this.sessionMaintenance.stopSweep();
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
