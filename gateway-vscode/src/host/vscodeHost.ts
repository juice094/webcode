/**
 * VS Code 宿主实现（路线 A · A0）。
 *
 * 用现有 vscode API 实现 host/types.ts 的 6 个接口。所有逻辑都是从原调用点
 * 原样平移，不做任何行为改动：日志/通知/确认的字节流与 A0 之前写进
 * OutputChannel / 弹窗的内容逐字节一致（格式化留在调用方，见 types.ts 注释）。
 */
import * as vscode from 'vscode';

import { t } from '../i18n';
import { getPrimaryWorkspaceRoot, getWorkspaceFolderInfos, getWorkspaceRoots } from '../extension/workspaceRoots';
import {
    createWorkspaceSessionStore,
    sessionTokenKey,
    type BridgeSessionPersistence,
    type SecretStorageLike
} from '../extension/sessionToken';
import {
    type ConfigStore,
    type GatewayHostServices,
    type Logger,
    type PairingUI,
    type SessionStore,
    type TerminalHost,
    type WorkspaceProvider
} from './types';

/** gateway-vscode 扩展的配置节，与 package.json contributes.configuration 对应。 */
const CONFIG_SECTION = 'webcodeGateway';

/** workspaceState 里记忆上次成功端口的 key（从 serviceController.ts 平移）。 */
const LAST_PORT_MEMENTO_KEY = 'mcp.lastPort';

/** Logger：三级别原样转发到 OutputChannel，不加任何前缀（格式化在调用方）。 */
export function createVscodeLogger(outputChannel: vscode.OutputChannel): Logger {
    return {
        info: message => outputChannel.appendLine(message),
        warn: message => outputChannel.appendLine(message),
        error: message => outputChannel.appendLine(message)
    };
}

/** WorkspaceProvider：直接委托 extension/workspaceRoots.ts（实现一行未动）。 */
export function createVscodeWorkspaceProvider(): WorkspaceProvider {
    return { getWorkspaceRoots, getPrimaryWorkspaceRoot, getWorkspaceFolders: getWorkspaceFolderInfos };
}

/** ConfigStore：委托 vscode.workspace.getConfiguration(section)。 */
export function createVscodeConfigStore(section: string): ConfigStore {
    const config = vscode.workspace.getConfiguration(section);
    return {
        get: <T>(key: string, defaultValue?: T): T | undefined => config.get(key, defaultValue as T),
        update: (key, value) => config.update(key, value)
    };
}

/** PairingUI：配对确认弹窗 + 信息/错误通知 + 瞬态状态栏，均为现有代码平移。 */
export function createVscodePairingUI(): PairingUI {
    return {
        confirmSessionRequest: async request => {
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
        },
        notify: message => {
            void vscode.window.showInformationMessage(message);
        },
        notifyError: message => {
            void vscode.window.showErrorMessage(message);
        },
        showStatusBarMessage: (message, timeoutMs) => {
            vscode.window.setStatusBarMessage(message, timeoutMs);
        }
    };
}

/**
 * SessionStore：createWorkspaceSessionStore（会话表）+ workspaceState 的
 * mcp.lastPort + SecretStorage 旧 key 的平移组合；校验与迁移逻辑仍在
 * extension/sessionToken.ts，这里不复制任何逻辑。
 */
export function createVscodeSessionStore(context: vscode.ExtensionContext, workspaceId: string): SessionStore {
    const persistence = createWorkspaceSessionStore({ memento: context.workspaceState, workspaceId });
    const legacyKey = sessionTokenKey(workspaceId);
    return {
        loadSessionTable: () => persistence.load(),
        saveSessionTable: sessions => persistence.save(sessions),
        readLegacyToken: () => Promise.resolve(context.secrets.get(legacyKey)),
        deleteLegacyToken: () => Promise.resolve(context.secrets.delete(legacyKey)),
        getLastPort: () => context.workspaceState.get<number>(LAST_PORT_MEMENTO_KEY),
        setLastPort: port => Promise.resolve(context.workspaceState.update(LAST_PORT_MEMENTO_KEY, port))
    };
}

/** SessionStore → GatewayManager.setResumeState 现有 BridgeSessionPersistence 接缝的适配器。 */
export function toBridgeSessionPersistence(store: SessionStore): BridgeSessionPersistence {
    return {
        load: () => store.loadSessionTable(),
        save: sessions => store.saveSessionTable(sessions)
    };
}

/**
 * SessionStore → 现有 SecretStorageLike 迁移源的适配器。key 参数被忽略：
 * legacy key 在创建 store 时已按 workspaceId 绑定（见 createVscodeSessionStore）。
 */
export function toLegacySecrets(store: SessionStore): SecretStorageLike {
    return {
        get: () => store.readLegacyToken(),
        delete: () => store.deleteLegacyToken()
    };
}

/** TerminalHost：本期为 vscode.window.createTerminal 直通（交付项 3）。 */
export function createVscodeTerminalHost(): TerminalHost {
    return {
        createTerminal: options => vscode.window.createTerminal(options)
    };
}

/** 装配产物：extension.ts 激活时注入网关核心的全部 VS Code 宿主能力。 */
export interface VscodeHost {
    readonly logger: Logger;
    readonly services: GatewayHostServices;
    createSessionStore(workspaceId: string): SessionStore;
}

export function createVscodeHost(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): VscodeHost {
    return {
        logger: createVscodeLogger(outputChannel),
        services: {
            workspace: createVscodeWorkspaceProvider(),
            config: createVscodeConfigStore(CONFIG_SECTION),
            pairing: createVscodePairingUI(),
            terminal: createVscodeTerminalHost(),
            appRoot: vscode.env.appRoot
        },
        createSessionStore: workspaceId => createVscodeSessionStore(context, workspaceId)
    };
}
