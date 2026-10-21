import * as path from 'node:path';

import * as vscode from 'vscode';

import { shouldAutoStart } from './extension/autoStart';
import { registerGatewayConfigurationWatcher } from './extension/configurationWatcher';
import { buildBridgeUrl } from './extension/bridgeUrl';
import { createBrowserExtensionManager } from './extension/browserExtensionManager';
import { registerGatewayConnectCommand } from './extension/connectCommand';
import { registerCopyContextCommand } from './extension/copyContextCommand';
import { registerIsolatedProfileCleanupCommand } from './extension/isolatedProfileCleanupCommand';
import { createPersistentLogger, TeeOutputChannel, type PersistentLogger } from './extension/persistentLog';
import { createApprovalAuditLog } from './extension/approvalAuditLog';
import {
    createGatewayServiceController,
    type GatewayServiceController
} from './extension/serviceController';
import { createSkillWatcherController } from './extension/skillWatchers';
import { registerGatewayConnectDeepLink } from './extension/uriHandler';
import type { SessionRequestPrompt } from './gateway/pairingRoutes';
import { updateGatewayStatusBar } from './extension/statusBar';
import { GatewayManager } from './gateway';
import { createWorkspaceId } from './gateway/bridgeRoute';
import { readShutdownSnapshot, shutdownSnapshotPath } from './extension/shutdownSnapshot';
import { runDeactivate } from './extension/deactivateSession';
import { createSessionTokenSource } from './extension/sessionToken';
import { formatBuildFingerprint, readBrowserBridgeBuild, resolveExtensionVersion } from './gateway/buildInfo';
import { createGatewayRuntimeTraceSinkFromEnvironment } from './gateway/runtimeTrace';
import { t } from './i18n';
import {
    findAiSiteById,
    getConfiguredAiSites,
    type AISiteConfig,
    type ResolvedAiSiteConfig
} from './platforms';

interface RuntimeHolder {
    serviceController?: GatewayServiceController;
}

/**
 * 激活期行为：初始化状态栏、挂接“浏览器已连接”钩子、按需自动启动。
 * 单独抽出，让 activate() 保持为一份可读的装配清单。
 */
function applyActivationBehavior(options: {
    manager: GatewayManager;
    serviceController: GatewayServiceController;
    statusBarItem: vscode.StatusBarItem;
}): void {
    updateGatewayStatusBar(options.statusBarItem, false, undefined, false);
    // 浏览器标签页兑换连接码后刷新状态栏；token 被撤销时状态栏自动回落到未连接。
    options.manager.setBridgeSessionActivatedHandler(() => options.serviceController.markBridgeConnected());

    // 配对请求必须由用户在这里当面确认；未注册处理器时网关默认拒绝。
    options.manager.setSessionRequestConfirmationHandler(confirmSessionRequest);

    // 自动启动是显式开关（webcodeGateway.autoStart，默认 false）：默认不在激活时
    // 占用端口；开启后也只启动网关，不会自动打开浏览器，且无工作区时不启动。
    const autoStart = vscode.workspace.getConfiguration('webcodeGateway').get<boolean>('autoStart');
    if (shouldAutoStart(autoStart, (vscode.workspace.workspaceFolders?.length ?? 0) > 0)) {
        void options.serviceController.start();
    }
}

/**
 * 配对确认弹窗。文案带上请求来源 origin 与工作区名，让用户能判断是谁在请求；
 * 关闭弹窗（Esc / 点叉）返回 undefined，按拒绝处理。
 */
async function confirmSessionRequest(request: SessionRequestPrompt): Promise<boolean> {
    const allow = t('session_request_allow');
    const choice = await vscode.window.showInformationMessage(
        t('session_request_prompt', {
            origin: request.requestOrigin,
            site: request.siteName,
            workspace: request.workspaceName
        }),
        { modal: true },
        allow,
        t('session_request_deny')
    );
    return choice === allow;
}

/**
 * 构建指纹：每次会话的头几行就写清"正在跑的到底是哪份构建"，
 * 让"装的 vsix 是不是 HEAD"能从日志直接回答，而不是靠比对文件哈希。
 * 读不到描述文件时降级为 unknown，绝不打断激活。
 */
function logBuildFingerprint(context: vscode.ExtensionContext, logger: PersistentLogger): void {
    logger.info(formatBuildFingerprint({
        extensionVersion: resolveExtensionVersion(context),
        build: readBrowserBridgeBuild(context.extensionPath),
        nodeVersion: process.version,
        vscodeVersion: vscode.version
    }));
}

/**
 * State `deactivate()` needs. The extension host calls deactivate on window
 * close and on reload; everything here is captured during activate so the
 * teardown path never touches the VS Code API or the network.
 */
let resumeSession: {
    manager: GatewayManager;
    logger: PersistentLogger;
    snapshotPath: string;
    workspaceId: string;
    workspaceName: string | null;
} | null = null;

/**
 * Prepares restart continuity:
 * 1. resolves the persisted bridge token source (SecretStorage, with a derived
 *    and an in-memory fallback) and hands it to the manager, so a reconnecting
 *    browser tab keeps working after the host restarts;
 * 2. reads the snapshot written by the previous session and exposes the
 *    interrupted-call count on `/v1/status` (notification only, never replayed).
 */
async function prepareResumeSession(
    context: vscode.ExtensionContext,
    manager: GatewayManager,
    logger: PersistentLogger
): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
    const workspaceId = createWorkspaceId(workspaceRoot);
    const storageDir = context.globalStorageUri.fsPath;
    const snapshotPath = shutdownSnapshotPath(path.join(storageDir, 'state'), workspaceId);
    const tokenProvider = await createSessionTokenSource({
        secrets: context.secrets,
        workspaceId,
        storageDir,
        log: message => logger.warn(message)
    });
    const interrupted = readShutdownSnapshot(snapshotPath);
    const lastInterrupted = interrupted && interrupted.inFlight.length > 0
        ? { count: interrupted.inFlight.length, savedAt: interrupted.savedAt }
        : null;
    if (lastInterrupted) {
        logger.warn(`Previous session was interrupted with ${lastInterrupted.count} tool call(s) in flight at ${lastInterrupted.savedAt}.`);
    }

    manager.setResumeState({ tokenProvider, lastInterrupted });
    resumeSession = {
        manager,
        logger,
        snapshotPath,
        workspaceId,
        workspaceName: workspaceRoot ? path.basename(workspaceRoot) : null
    };
    logger.info(`Bridge session token source: ${tokenProvider.mode}.`);
}

/**
 * Window close / reload teardown. The work lives in deactivateSession.ts so it
 * can be unit-tested; this wrapper only guards against an inactive session.
 */
export async function deactivate(): Promise<void> {
    if (!resumeSession) {
        return;
    }
    await runDeactivate(resumeSession);
}

// 异常兜底：扩展宿主进程由多个扩展共享，这里只负责把现场落盘，不改变默认行为。
function registerCrashHandlers(logger: PersistentLogger): void {
    process.on('uncaughtException', (error: unknown) => {
        logger.error('Uncaught exception in extension host', error);
    });
    process.on('unhandledRejection', (reason: unknown) => {
        logger.error('Unhandled promise rejection in extension host', reason);
    });
}

export interface GatewayExtensionState {
    currentPort: number | null;
    isStarting: boolean;
    isRunning: boolean;
}

export interface GatewayExtensionApi {
    getGatewayState(): GatewayExtensionState;
    evaluation?: {
        getSiteConfiguration(siteId: string): ResolvedAiSiteConfig;
        startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string>;
        stop(): Promise<void>;
    };
}

/**
 * VS Code 扩展激活入口。
 *
 * 这个文件只负责把扩展启动时需要的对象串起来，不直接承载具体业务逻辑：
 * - GatewayManager 负责本地 HTTP/MCP 网关的生命周期和路由。
 * - GatewayServiceController 负责 VS Code 侧的启动、停止、重启状态管理。
 * - 各个 register* 函数负责注册命令、配置监听和编辑器交互。
 *
 * 保持入口层只做编排，可以让后续修复命令菜单、服务状态或技能监听时，
 * 直接进入对应模块，而不是继续把逻辑堆到 extension.ts 里。
 */
export async function activate(context: vscode.ExtensionContext): Promise<GatewayExtensionApi> {
    // 创建扩展专用输出通道。GatewayManager、服务控制器和命令菜单都会复用它，
    // 这样启动日志、重启日志、错误信息都集中显示在同一个 VS Code Output 面板里。
    // 同时把内容 tee 一份到 globalStorage/logs 下的按天滚动日志文件，窗口关闭后仍可复盘。
    const persistentLogger = createPersistentLogger(context.globalStorageUri.fsPath);
    const outputChannel = new TeeOutputChannel(
        vscode.window.createOutputChannel(t('output_channel_name')),
        persistentLogger
    );
    persistentLogger.info('MCP Gateway extension activating.');
    logBuildFingerprint(context, persistentLogger);
    registerCrashHandlers(persistentLogger);
    // outputChannel.show(true); // 静默启动，不自动弹出面板
    outputChannel.appendLine("🚀 MCP Gateway Extension Activating...");

    // GatewayManager 构造时需要传入自动停止回调；但 serviceController 要等
    // manager 创建后才能创建。这个 holder 用来打破初始化顺序上的循环引用，
    // 让自动停止回调触发时仍然能通知 VS Code 状态栏和内部运行状态。
    const runtime: RuntimeHolder = {};

    // 创建本地网关管理器。它持有 Express 服务、MCP server 连接、本地工具、
    // 技能缓存、终端会话等核心运行时能力；extension.ts 只保留它的实例引用，
    // 具体启动参数由 serviceController 在用户点击启动或配置变更重启时组装。
    const manager = createGatewayManager(context, outputChannel, runtime);

    // 创建技能目录监听控制器，并在激活时立即按当前 workspace/config 扫一遍。
    // watcher 只负责在 SKILL.md 或技能目录内容变化时通知 manager 失效缓存，
    // 真正的技能读取和缓存逻辑仍然留在 GatewayManager/SkillManager 内部。
    const skillWatcherController = createSkillWatcherController(context, manager);
    skillWatcherController.refresh();

    // workspace folder 变化会改变可扫描的技能目录集合，所以这里重新创建 watcher。
    // 同时主动失效技能缓存，避免用户切换/新增 workspace 后仍拿到旧目录的技能。
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
        skillWatcherController.refresh();
        manager.invalidateSkillCache('workspace folders changed');
    }));

    // 创建右下角状态栏入口。它既展示网关状态，也作为用户打开网关菜单的入口。
    // 具体显示文案和颜色由 statusBar 模块根据 offline/starting/online 状态统一处理。
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'webcode-gateway.connect';
    context.subscriptions.push(statusBarItem);

    // 创建 VS Code 侧服务控制器。它把“启动网关需要读取哪些配置、保存端口、
    // 更新状态栏、展示启动失败/停止/重启消息”封装起来，命令菜单和配置监听
    // 都通过这个对象控制服务，避免各处直接修改 currentPort/isRunning。
    const serviceController = createGatewayServiceController({
        manager,
        context,
        outputChannel,
        statusBarItem,
        persistentLogger
    });

    // 把 controller 写回 holder，补上 GatewayManager 自动停止回调需要的引用。
    // 从这一行之后，manager 的 watchdog 触发自动关闭时可以正确同步 VS Code UI 状态。
    runtime.serviceController = serviceController;

    // 重启可续：持久化 token 源 + 上次中断的调用清单（只告知不重放）。
    await prepareResumeSession(context, manager, persistentLogger);

    // bundled bridge 会先复制到版本无关的用户数据目录。准备过程不阻塞扩展激活；
    // 真正启动隔离浏览器时仍会等待同一个任务完成，并在需要时提示重启旧进程。
    const browserExtensionManager = createBrowserExtensionManager(context, outputChannel);
    browserExtensionManager.prepareInBackground();

    // 注册编辑器右键菜单命令：复制当前选中文本，并在剪贴板里附带相对文件路径。
    // 该命令和网关服务本身没有运行依赖，所以激活时直接注册。
    registerCopyContextCommand(context);
    registerIsolatedProfileCleanupCommand(context);

    // 注册状态栏点击后的主菜单命令。菜单会根据 serviceController 当前状态切换：
    // starting 时显示日志，offline 时提供启动/日志/设置，online 时提供打开站点、
    // 自定义浏览器启动、重启、停止等操作。
    registerGatewayConnectCommand({
        context,
        outputChannel,
        serviceController,
        browserExtensionManager
    });

    // vscode:// 深链入口。它只打开上面的连接菜单，不启动服务、不发连接码；
    // 威胁模型与白名单规则见 extension/uriHandler.ts。
    registerGatewayConnectDeepLink(context, message => outputChannel.appendLine(message));

    // 注册 webcodeGateway 配置监听。端口、MCP server、技能目录变化时，
    // 如果服务正在运行就走 serviceController 重启；技能目录变化还会刷新 watcher
    // 并失效技能缓存，保证后续工具列表能反映最新配置。
    registerGatewayConfigurationWatcher({
        context,
        manager,
        outputChannel,
        serviceController,
        skillWatcherController
    });

    applyActivationBehavior({ manager, serviceController, statusBarItem });

    const api: GatewayExtensionApi = {
        getGatewayState() {
            const { currentPort, isStarting, isRunning } = serviceController.getState();
            return { currentPort, isStarting, isRunning };
        }
    };

    if (process.env.WEBCODE_EVAL_MODE === '1') {
        api.evaluation = {
            getSiteConfiguration(siteId: string): ResolvedAiSiteConfig {
                const configured = vscode.workspace
                    .getConfiguration('webcodeGateway')
                    .get<AISiteConfig[]>('aiSites');
                const site = findAiSiteById(getConfiguredAiSites(configured), siteId);
                if (!site) {
                    throw new Error(`Evaluation site is not configured: ${siteId}`);
                }
                return site;
            },
            async startAndCreateBridgeUrl(siteId: string, targetUrl: string): Promise<string> {
                await serviceController.start();
                const state = serviceController.getState();
                if (!state.isRunning || !state.currentPort) {
                    throw new Error('Evaluation Gateway failed to start.');
                }
                const bridgeCode = serviceController.issueBridgeCode(siteId, targetUrl);
                return buildBridgeUrl(state.currentPort, bridgeCode);
            },
            async stop(): Promise<void> {
                await serviceController.stop();
            }
        };
    }

    return api;
}

/**
 * Creates the gateway manager and attaches the approval audit sink. Approval
 * decisions land next to the human log, so "who approved this command" stays
 * answerable after the output channel is gone.
 */
function createGatewayManager(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    runtime: RuntimeHolder
): GatewayManager {
    const manager = new GatewayManager(
        outputChannel,
        context.extensionPath,
        context,
        idleTimeoutMs => {
            runtime.serviceController?.markAutoStopped(idleTimeoutMs);
        },
        createGatewayRuntimeTraceSinkFromEnvironment()
    );
    const auditLog = createApprovalAuditLog(context.globalStorageUri.fsPath);
    manager.setApprovalAuditSink(event => auditLog.append(event));
    return manager;
}
