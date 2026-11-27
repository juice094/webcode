/**
 * headless 装载期 vscode 桩（过渡手段，应随遗留项清零而删除）。
 *
 * 背景：terminalSessionManager.ts 在模块顶层 `import * as vscode from 'vscode'`
 * （README §遗留 点名的延后项），而纯 Node 下不存在 'vscode' 模块，
 * 网关核心一装载就抛 Cannot find module。本模块必须在任何 gateway 代码
 * 之前 import（headless.ts 的第一行 import），拦截 CommonJS 解析，
 * 为 'vscode' 返回最小桩。
 *
 * 桩的语义与 createDshTerminalHost 一致：装载与只读路径可用；
 * 真正创建终端时抛错，不静默降级。
 *
 * 删除条件：terminalSessionManager 完成 TerminalHost 结构化抽象
 * （README §遗留 第一项）后，本文件连同 headless.ts 里的首行 import 一起移除。
 */
import Module from 'module';

interface WindowStub {
    createTerminal: () => never;
    onDidChangeTerminalShellIntegration: () => { dispose(): void };
    onDidEndTerminalShellExecution: () => { dispose(): void };
    onDidCloseTerminal: () => { dispose(): void };
    showInformationMessage: () => Promise<undefined>;
    showErrorMessage: () => Promise<undefined>;
    showWarningMessage: () => Promise<undefined>;
}

const disposable = { dispose(): void { /* no-op */ } };
const resolvedUndefined = (): Promise<undefined> => Promise.resolve(undefined);

const vscodeStub = {
    window: {
        createTerminal: (): never => {
            throw new Error('vscode.window.createTerminal is not available in the headless host.');
        },
        onDidChangeTerminalShellIntegration: () => disposable,
        onDidEndTerminalShellExecution: () => disposable,
        onDidCloseTerminal: () => disposable,
        showInformationMessage: resolvedUndefined,
        showErrorMessage: resolvedUndefined,
        showWarningMessage: resolvedUndefined
    } satisfies WindowStub,
    env: {
        language: 'zh-cn',
        appRoot: undefined as string | undefined,
        shell: undefined as string | undefined
    },
    workspace: {
        getConfiguration: () => ({
            get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
            update: () => Promise.resolve()
        }),
        workspaceFolders: [] as unknown[],
        onDidChangeConfiguration: () => disposable
    }
};

type LoadFn = (request: string, ...rest: unknown[]) => unknown;
const moduleWithLoad = Module as unknown as { _load: LoadFn };
const originalLoad = moduleWithLoad._load;

moduleWithLoad._load = function patchedLoad(this: unknown, request: string, ...rest: unknown[]): unknown {
    if (request === 'vscode') {
        return vscodeStub;
    }
    return originalLoad.call(this, request, ...rest);
};
