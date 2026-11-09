/**
 * Host 抽象层（路线 A · A0）。
 *
 * 网关核心（gateway.ts、gateway/、tools/、skillManager、terminalSessionManager）
 * 通过这里的 6 个接口访问宿主能力，不再直接 import 'vscode'。
 * A0 是零行为变化的纯内部重构：所有接口的当前语义 = 现有 VS Code 调用的
 * 原样平移，VS Code 实现见 host/vscodeHost.ts。
 *
 * 行号注释指向重构前的调用位置（文件:行号），重构后行号会漂移，以文件为准。
 */
import type * as vscode from 'vscode';

import type { StoredBridgeSession } from '../extension/sessionToken';
import type { SessionRequestPrompt } from '../gateway/pairingRoutes';

/**
 * 扩展版本来源。今天 GatewayManager 持有整个 vscode.ExtensionContext 只是
 * 为了取版本号（gateway.ts:359-361 → buildInfo.resolveExtensionVersion）；
 * 该函数本来就只读 context.extension.packageJSON，这里把依赖收窄成同形结构。
 * 调用方：extension.ts（装配，createGatewayManager）。
 */
export interface ExtensionVersionSource {
    extension?: { packageJSON?: unknown };
}

/**
 * 工作区根目录提供者。替代 `vscode.workspace.workspaceFolders` 触点。
 *
 * 当前语义（= extension/workspaceRoots.ts 的实现，vscodeHost 直接委托给它）：
 * - getWorkspaceRoots()：返回所有工作区文件夹的 uri.fsPath，无工作区时返回 []。
 *   调用方：gateway.ts createToolExecutionContext（原 245-246）、
 *   serviceController.ts 原 243/281、extension.ts 原 63/127。
 * - getPrimaryWorkspaceRoot()：第一个根，无工作区时返回 null。
 *   调用方：gateway.ts 原 289/305/342/433（路由与 MCP 连接的 workspaceRoot）。
 * - getWorkspaceFolders()：返回 { name, fsPath }，无工作区时返回 []。
 *   仅 SkillManager 扫描用（gateway.ts 原 147）：内部 id 需要宿主文件夹
 *   display name（多根工作区可被用户重命名，name 不一定等于 basename），
 *   用它保住 listSkills 的既有排序。
 */
export interface WorkspaceProvider {
    getWorkspaceRoots(): string[];
    getPrimaryWorkspaceRoot(): string | null;
    getWorkspaceFolders(): WorkspaceFolderInfo[];
}

/** 工作区文件夹的宿主无关视图（display name + 绝对路径）。 */
export interface WorkspaceFolderInfo {
    name: string;
    fsPath: string;
}

/**
 * 配置读取/写回。替代 `vscode.workspace.getConfiguration` 触点。
 *
 * 当前语义：store 在创建时绑定配置节（VS Code 实现绑定 'webcodeGateway'），
 * get/update 的 key 均为节内相对键。所有 schema 默认值只存在于
 * package.json contributes.configuration（如 webcodeGateway.port 默认 34567、
 * idleTimeoutMinutes 默认 30、compression.toolResult 默认 "smart"），
 * 代码侧默认值由各调用方的 `??` 回退或 gateway/timeouts 等 resolver 提供，
 * 本接口不做默认值合并——get 未命中时返回 defaultValue（可为 undefined），
 * 与今天 vscode.WorkspaceConfiguration.get 的行为一致。
 *
 * 调用方：serviceController.ts 原 91-92/201-221/247-259（启动参数装配）、
 * gateway/compressionPolicy.ts 原 15-18（每次工具调用读压缩策略，
 * 由 gateway.ts 注入）、tools/ripgrep.ts（webcodeGateway.ripgrep.path，
 * 经 ToolExecutionContext.configStore 注入）、extension.ts 原 62/331-333
 * （autoStart 与 eval 的 aiSites）。extension/connectCommand.ts 原 143-144 与
 * extension/skillWatchers.ts 原 25-26 同属 getConfiguration 触点，但这两处
 * 位于宿主适配层（extension/），A0 保留直接调用（见 src/README「Host 抽象」
 * 一节的遗留清单）。
 *
 * update：A0 无任何写回调用方；保留该方法是为下一期宿主（headless/DSH）
 * 实现预留的对称接口，VS Code 实现原样委托 configuration.update。
 */
export interface ConfigStore {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): PromiseLike<void> | void;
}

/**
 * 日志出口。替代网关核心对 vscode.OutputChannel 的直接依赖。
 *
 * 当前语义：三个级别都是「按原样写一行」，实现不得再添加任何前缀、时间戳或
 * 级别标记——所有格式化都留在调用方，保证与 A0 之前写入 OutputChannel 的
 * 字节完全一致：
 * - info：gateway.ts 原 228（log，调用方已套 formatLogLine 时间戳）、
 *   skillManager.ts 原 427（调用方自带 `[SkillManager] ` 前缀）、
 *   terminalSessionManager.ts 原 354（调用方自带 `[HH:MM:SS] ` 前缀）、
 *   searchCodeTool.ts 原 185-188 / searchFilesTool.ts 原 185-187
 *   （ripgrep 降级提示）。
 * - warn：A0 核心侧暂无 warn 调用方（serviceController/extension 走
 *   PersistentLogger.warn，不经此接口）。
 * - error：gateway.ts 原 231-233（调用方已套 formatLogLine + `❌ ` 前缀 +
 *   getErrorMessage(err)）；error 的第二参数 A0 在 VS Code 实现中不追加
 *   任何内容（详情已被调用方格式化进 message）。
 *
 * 「OutputChannel 降级」：VS Code 实现就是把三级别原样转发给现有的
 * TeeOutputChannel.appendLine（host/vscodeHost.ts），即 OutputChannel 是
 * 本接口的唯一降级目标；下一期 headless 实现可直接写文件/stdout。
 */
export interface Logger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

/**
 * 会话持久化存储。替代 Memento 触点（workspaceState）。
 *
 * 当前语义：一个 store 实例绑定一个 workspaceId（VS Code 实现 =
 * extension/sessionToken.ts 的 createWorkspaceSessionStore + memento 原语
 * 的平移组合，迁移/校验逻辑一行未改）：
 * - loadSessionTable/saveSessionTable：读写 `webcode.bridgeSessions.<id>`
 *   会话表（StoredBridgeSession 校验规则见 sessionToken.ts）。
 *   调用方：extension.ts 原 131 → GatewayManager.setResumeState →
 *   gateway/sessionMaintenance.ts restore()/persist()。
 * - readLegacyToken/deleteLegacyToken：一次性迁移源（旧版 SecretStorage
 *   单 token，key = `webcode.bridgeToken.<id>`）。readLegacyToken 必须把
 *   读取错误向上抛（sessionMaintenance/migrateLegacySessionToken 依赖
 *   try/catch 记录 "Failed to read the legacy bridge session token"）。
 *   调用方：extension.ts 原 142（legacySecrets）→ sessionMaintenance 原 77-83。
 * - getLastPort/setLastPort：读写 workspaceState 的 `mcp.lastPort`
 *   （端口偏好记忆，key 与 workspaceId 无关）。
 *   调用方：extension/serviceController.ts 原 100/221。
 */
export interface SessionStore {
    loadSessionTable(): Promise<StoredBridgeSession[] | null>;
    saveSessionTable(sessions: readonly StoredBridgeSession[]): Promise<void>;
    readLegacyToken(): Promise<string | undefined>;
    deleteLegacyToken(): Promise<void>;
    getLastPort(): number | undefined;
    setLastPort(port: number): Promise<void>;
}

/**
 * 用户确认与通知界面。替代模态弹窗触点。
 *
 * 当前语义（VS Code 实现 = 现有弹窗代码原样平移，host/vscodeHost.ts）：
 * - confirmSessionRequest：配对确认模态框。返回 true 表示用户点了「允许」；
 *   关闭弹窗（Esc/点叉）按拒绝处理。今天的实现是
 *   `showInformationMessage(prompt, { modal: true }, allow, deny)`。
 *   调用方：extension.ts 原 72-85 → manager.setSessionRequestConfirmationHandler
 *   （extension.ts 原 58）→ gateway/pairingRoutes 的 requestUserConfirmation
 *   （gateway.ts 原 309-311）。未注入时网关默认拒绝配对（语义不变）。
 * - notify：非模态信息通知（fire-and-forget）。今天 =
 *   `void vscode.window.showInformationMessage(message)`。
 *   调用方：serviceController.ts 原 122/130/136（停止/重启/自动停止）、
 *   extension.ts 原 166/170（断开浏览器会话）。
 * - notifyError：错误通知（fire-and-forget）。今天 =
 *   `void vscode.window.showErrorMessage(message)`。
 *   调用方：serviceController.ts 原 83/108（无工作区/启动失败）。
 * - showStatusBarMessage：瞬态状态栏文字。今天 =
 *   `vscode.window.setStatusBarMessage(message, timeoutMs)`。
 *   调用方：gateway/portListener.ts 原 56（绑定成功后的 5 秒提示）。
 */
export interface PairingUI {
    confirmSessionRequest(request: SessionRequestPrompt): Promise<boolean>;
    notify(message: string): void;
    notifyError(message: string): void;
    showStatusBarMessage(message: string, timeoutMs: number): void;
}

/**
 * 集成终端入口。本期只把「创建终端」收进接口（交付项 3），
 * terminalSessionManager 内部的 shell integration 事件、输出采集、会话状态
 * 机一律不抽象。
 *
 * 当前语义：VS Code 实现是 `vscode.window.createTerminal` 的直通
 * （terminalSessionManager.ts 原 62），options 构造（name/cwd/env/
 * shellPath/shellArgs/isTransient）保持现有代码不动。返回的 Terminal
 * 句柄本期仍是 vscode.Terminal 形状——接口文件因此保留对 vscode 的
 * 纯类型引用（编译期擦除，无运行时依赖）；下一期 headless 实现把它替换为
 * 结构化的 HostTerminal（show/dispose/sendText/processId/shellIntegration）。
 * 调用方：terminalSessionManager.createSession（tools/runInTerminalTool.ts
 * 原 56 经 terminalSessionManager 间接到达）。
 */
export interface TerminalHost {
    createTerminal(options: vscode.TerminalOptions): vscode.Terminal;
}

/** 一次注入的全部宿主服务（gateway.ts 的 hooks.host）。 */
export interface GatewayHostServices {
    workspace: WorkspaceProvider;
    config: ConfigStore;
    pairing: PairingUI;
    terminal: TerminalHost;
    /** 宿主应用根目录，用于定位宿主内置 ripgrep（今天 = vscode.env.appRoot）。 */
    appRoot: string | undefined;
}

/** 终端宿主缺失时的占位实现：创建终端即报错（本期仅注入点可替换，不静默降级）。 */
export function createUnavailableTerminalHost(): TerminalHost {
    return {
        createTerminal: () => {
            throw new Error('TerminalHost is not available in this host.');
        }
    };
}

/**
 * 未注入宿主时的默认服务：每个成员的取值精确复刻 A0 之前 vscodeStub 在
 * 单测环境下的行为（空工作区、配置全部回退默认值、确认一律拒绝、
 * 通知/状态栏静默、无终端宿主），保证既有单测在不注入宿主的前提下
 * 行为零漂移。生产装配（extension.ts）总是注入 createVscodeHost 的服务。
 */
export function createDefaultGatewayHostServices(): GatewayHostServices {
    return {
        workspace: {
            getWorkspaceRoots: () => [],
            getPrimaryWorkspaceRoot: () => null,
            getWorkspaceFolders: () => []
        },
        config: {
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
            update: () => Promise.resolve()
        },
        pairing: {
            confirmSessionRequest: () => Promise.resolve(false),
            notify: () => undefined,
            notifyError: () => undefined,
            showStatusBarMessage: () => undefined
        },
        terminal: createUnavailableTerminalHost(),
        appRoot: undefined
    };
}
