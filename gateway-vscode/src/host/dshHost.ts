/**
 * DSH 宿主实现（路线 A · 下一期 headless/DSH）。
 *
 * 实现 host/types.ts 的宿主能力接口，使网关核心脱离 VS Code 运行。
 * 与 vscodeHost.ts 的对应关系：
 * - WorkspaceProvider：VS Code 读 workspaceFolders；这里来自启动参数，
 *   DSH 侧由装配层（dsh 插件）把会话工作目录传进来。
 * - ConfigStore：VS Code 绑 'webcodeGateway' 配置节；这里是嵌套键读取普通对象，
 *   值来自 JSON 配置文件与环境变量，update 只写内存（headless 的配置真源是启动参数）。
 * - PairingUI：VS Code 用模态弹窗；headless 没有 UI，配对确认默认拒绝，
 *   可显式配置为批准（仅限调试），通知类全部写日志。
 * - TerminalHost：本期不提供。terminalSessionManager 的 shell integration 订阅
 *   是 README §遗留 点名的延后项，createTerminal 直接抛错——
 *   与 createUnavailableTerminalHost 同语义，不静默降级。
 * - Logger：三级别原样写一行到注入的输出口（stderr 或文件），不加任何前缀——
 *   格式化全部在调用方，与 Logger 契约一致。
 *
 * 会话持久化不在本文件：装配层用 JSON 文件实现 MementoLike 后复用
 * extension/sessionToken 的 createWorkspaceSessionStore，key 形状
 * `webcode.bridgeSessions.<id>` / `mcp.lastPort` 与 VS Code 版一致，
 * 两个宿主的会话表可互迁。
 */
import { basename } from 'path';

import type { SessionRequestPrompt } from '../gateway/pairingRoutes';
import type {
    ConfigStore,
    GatewayHostServices,
    Logger,
    PairingUI,
    TerminalHost,
    WorkspaceFolderInfo,
    WorkspaceProvider
} from './types';

/** 日志输出口：一行一条，已格式化（Logger 契约要求实现不得再加工）。 */
export type LogSink = (line: string) => void;

/** 配对确认策略：headless 默认拒绝；approve 仅供调试，须显式配置。 */
export type PairingPolicy = 'reject' | 'approve';

export function createDshLogger(sink: LogSink): Logger {
    return {
        info: message => sink(message),
        warn: message => sink(message),
        error: message => sink(message)
    };
}

export function createDshWorkspaceProvider(roots: readonly string[]): WorkspaceProvider {
    const folders: WorkspaceFolderInfo[] = roots.map(root => ({
        name: basename(root) || root,
        fsPath: root
    }));
    return {
        getWorkspaceRoots: () => [...roots],
        getPrimaryWorkspaceRoot: () => roots[0] ?? null,
        getWorkspaceFolders: () => [...folders]
    };
}

/**
 * 嵌套键 ConfigStore：以 '.' 分隔的路径读取普通对象。
 * 未命中返回 defaultValue——与 vscode.WorkspaceConfiguration.get 的行为一致；
 * 数组与 null 视为叶子，不再下钻（`timeouts.bridgeRequestMs` 这类键依赖此语义）。
 */
export function createDshConfigStore(values: Record<string, unknown>): ConfigStore {
    const data: Record<string, unknown> = { ...values };
    return {
        get: <T>(key: string, defaultValue?: T): T | undefined => {
            let current: unknown = data;
            for (const part of key.split('.')) {
                if (current === null || typeof current !== 'object' || Array.isArray(current)) {
                    return defaultValue;
                }
                current = (current as Record<string, unknown>)[part];
            }
            return current === undefined ? defaultValue : (current as T);
        },
        update: (key: string, value: unknown) => {
            const parts = key.split('.');
            let current: Record<string, unknown> = data;
            for (const part of parts.slice(0, -1)) {
                const next = current[part];
                if (next === null || typeof next !== 'object' || Array.isArray(next)) {
                    current[part] = {};
                }
                current = current[part] as Record<string, unknown>;
            }
            current[parts[parts.length - 1]] = value;
        }
    };
}

export function createDshPairingUI(policy: PairingPolicy, sink: LogSink): PairingUI {
    return {
        confirmSessionRequest: (request: SessionRequestPrompt) => {
            const decision = policy === 'approve' ? '批准（显式配置）' : '拒绝（headless 默认）';
            sink(`🤝 配对请求：site=${request.siteName} origin=${request.requestOrigin} `
                + `workspace=${request.workspaceName} → ${decision}`);
            return Promise.resolve(policy === 'approve');
        },
        notify: message => sink(`ℹ️ ${message}`),
        notifyError: message => sink(`❌ ${message}`),
        showStatusBarMessage: (message, _timeoutMs) => sink(`▸ ${message}`)
    };
}

/**
 * 终端宿主本期不可用：terminalSessionManager 的 shell integration 事件订阅
 * 属 README §遗留 的延后项。抛错而非静默降级——调用方（run_in_terminal 等
 * 终端工具）会把错误原样回给模型，与 VS Code 缺终端宿主时的行为一致。
 */
export function createDshTerminalHost(): TerminalHost {
    return {
        createTerminal: (): never => {
            throw new Error('TerminalHost is not available in the DSH headless host yet.');
        }
    };
}

export interface DshHostOptions {
    /** 工作区根目录，第一个为主根（决定 workspaceId 与工具默认 cwd）。 */
    workspaceRoots: readonly string[];
    /** ConfigStore 初始值（嵌套对象，键与 webcodeGateway 配置节相对键一致）。 */
    configValues?: Record<string, unknown>;
    /** 配对策略，默认 'reject'。 */
    pairingPolicy?: PairingPolicy;
    /** 日志输出口。 */
    sink: LogSink;
    /** 宿主应用根目录（定位内置 ripgrep 用）；headless 通常为 undefined。 */
    appRoot?: string;
}

export function createDshHostServices(options: DshHostOptions): GatewayHostServices {
    return {
        workspace: createDshWorkspaceProvider(options.workspaceRoots),
        config: createDshConfigStore(options.configValues ?? {}),
        pairing: createDshPairingUI(options.pairingPolicy ?? 'reject', options.sink),
        terminal: createDshTerminalHost(),
        appRoot: options.appRoot
    };
}
