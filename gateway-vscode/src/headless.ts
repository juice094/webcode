/**
 * headless 入口：在纯 Node 下装配并启动 webcode 网关核心，不依赖 VS Code。
 *
 * 这是「dsh 接管 webcode 网关宿主」的承载进程：DSH 侧（插件或 dsh-shell）
 * 以子进程方式拉起本入口，浏览器扩展按既有协议接入 34567–34576。
 * 协议兼容由复用 gateway/ 原码保证，本文件只做装配，不碰协议。
 *
 * 配置全部来自环境变量（前缀 WEBCODE_）：
 *   WEBCODE_PORT                    监听端口，默认 34567（须落 34567–34576）
 *   WEBCODE_WORKSPACE_ROOTS         工作区根目录列表，Windows 用 ';' 分隔，
 *                                   其他平台用 ':'；第一个为主根（决定 workspaceId）
 *   WEBCODE_CONFIG                  JSON 配置文件路径（嵌套对象，键与
 *                                   webcodeGateway 配置节相对键一致，如
 *                                   { "compression": { "toolResult": "smart" } }）
 *   WEBCODE_SESSION_STORE           会话表 JSON 文件路径，
 *                                   默认 <主根>/.webcode/bridge-sessions.json，
 *                                   无工作区时 ~/.webcode/bridge-sessions.json
 *   WEBCODE_PAIRING                 配对策略：reject（默认）| approve（仅调试）
 *   WEBCODE_IDLE_TIMEOUT_MINUTES    空闲自动停止分钟数，默认 30
 *   WEBCODE_ALLOWED_ORIGINS         额外允许的 Origin，',' 分隔
 *   WEBCODE_COMMAND_SHELL           execute_command 的 POSIX shell 路径
 *                                   （Windows 上应为 Git Bash bash.exe）
 *   WEBCODE_LOG                     日志文件路径；缺省只写 stderr
 *
 * 退出行为：空闲超时自动停止后进程以 0 退出（看护方应重启）；
 * SIGINT/SIGTERM 先 markShuttingDown 再 stop，然后退出。
 */
// 首两行 import：装载期垫片必须先于一切 gateway 代码生效（见各文件头注释）。
import './host/vscodeStub';
import './host/markdownLoader';

import { appendFileSync, existsSync, readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, isAbsolute, join } from 'path';

import { GatewayManager } from './gateway';
import { createWorkspaceId } from './gateway/bridgeRoute';
import type { GatewayConfig } from './gateway/types';
import { createDshHostServices, createDshPairingUI, type LogSink, type PairingPolicy } from './host/dshHost';
import { createWorkspaceSessionStore, type MementoLike } from './extension/sessionToken';
import { getConfiguredAiSites, type AISiteConfig } from './platforms';

const env = process.env;

function numberFrom(raw: string | undefined, fallback: number): number {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listFrom(raw: string | undefined, separator: string): string[] {
    if (!raw) {
        return [];
    }
    return raw.split(separator).map(item => item.trim()).filter(item => item.length > 0);
}

const isWindows = process.platform === 'win32';
const roots = listFrom(env.WEBCODE_WORKSPACE_ROOTS, isWindows ? ';' : ':')
    .map(root => (isAbsolute(root) ? root : join(process.cwd(), root)));
const primaryRoot = roots[0] ?? null;

// ── 日志：stderr 恒开，文件可选。Logger 契约要求原样写行，不加前缀。
const logFile = env.WEBCODE_LOG;
const sink: LogSink = (line) => {
    process.stderr.write(`${line}\n`);
    if (logFile) {
        try {
            appendFileSync(logFile, `${line}\n`, 'utf8');
        } catch {
            // 日志文件写失败不阻断网关；stderr 已有同一行。
        }
    }
};

// ── 配置值：JSON 文件 + 环境变量覆盖个别高频项。
let configValues: Record<string, unknown> = {};
const configPath = env.WEBCODE_CONFIG;
if (configPath && existsSync(configPath)) {
    try {
        configValues = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
        sink(`⚠️ WEBCODE_CONFIG 解析失败，按空配置继续：${String(error)}`);
    }
}

const pairingPolicy: PairingPolicy = env.WEBCODE_PAIRING === 'approve' ? 'approve' : 'reject';
const port = numberFrom(env.WEBCODE_PORT, 34567);
const idleTimeoutMinutes = numberFrom(env.WEBCODE_IDLE_TIMEOUT_MINUTES, 30);
const commandShellPath = env.WEBCODE_COMMAND_SHELL;

// 站点注册表与 CORS 白名单：与 extension/serviceController 同一条路径——
// 配置为空时回退到内置平台注册表（gateway 本身不做这个回退，
// config.aiSites 缺省即空表，配对会全部 unknown-site）。
const aiSites = getConfiguredAiSites(configValues.aiSites as AISiteConfig[] | undefined);
const siteOrigins = aiSites.map((site) => {
    try {
        return new URL(site.address).origin;
    } catch {
        return '';
    }
}).filter(origin => origin !== '');
const allowedOrigins = [...siteOrigins, ...listFrom(env.WEBCODE_ALLOWED_ORIGINS, ',')];

// ── 会话持久化：JSON 文件版 MementoLike + 官方 createWorkspaceSessionStore。
// key 形状 webcode.bridgeSessions.<workspaceId> / mcp.lastPort 与 VS Code 版一致。
const storePath = env.WEBCODE_SESSION_STORE
    ?? (primaryRoot
        ? join(primaryRoot, '.webcode', 'bridge-sessions.json')
        : join(homedir(), '.webcode', 'bridge-sessions.json'));

function createJsonFileMemento(filePath: string): MementoLike {
    let data: Record<string, unknown> = {};
    try {
        data = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
        // 文件不存在或损坏：从空表起步（与 Memento 空态一致），不阻断启动。
    }
    let writing: Promise<void> = Promise.resolve();
    const flush = (): Promise<void> => {
        const run = writing.then(async () => {
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        });
        // 链保持不断；本次错误传给调用方（sessionMaintenance 会记录）。
        writing = run.catch(() => undefined);
        return run;
    };
    return {
        get: (key: string) => data[key],
        update: (key: string, value: unknown) => {
            if (value === undefined) {
                delete data[key];
            } else {
                data[key] = value;
            }
            return flush();
        }
    };
}

async function main(): Promise<void> {
    const memento = createJsonFileMemento(storePath);
    const workspaceId = createWorkspaceId(primaryRoot);
    const sessionStore = createWorkspaceSessionStore({ memento, workspaceId });
    const lastPort = memento.get('mcp.lastPort');

    const host = createDshHostServices({
        workspaceRoots: roots,
        configValues,
        pairingPolicy,
        sink
    });
    const pairing = createDshPairingUI(pairingPolicy, sink);
    const logger = { info: sink, warn: sink, error: sink };

    // extensionPath 供 SkillManager 扫描 skills/：编译产物在 out/，包根是其上一级。
    const extensionPath = join(__dirname, '..');
    const packageJson = JSON.parse(
        readFileSync(join(extensionPath, 'package.json'), 'utf8')
    ) as { version?: string };
    const versionSource = { extension: { packageJSON: packageJson } };

    const manager = new GatewayManager(logger, extensionPath, versionSource, {
        host,
        onAutoStop: (idleTimeoutMs) => {
            sink(`🛑 空闲 ${Math.round(idleTimeoutMs / 60000)} 分钟，网关自动停止；进程退出，由看护方决定重启。`);
            process.exit(0);
        }
    });
    manager.setSessionRequestConfirmationHandler(prompt => pairing.confirmSessionRequest(prompt));
    manager.setResumeState({ sessionStore, lastInterrupted: null });

    const config: GatewayConfig = {
        port,
        idleTimeoutMs: idleTimeoutMinutes * 60_000,
        preferredPort: typeof lastPort === 'number' ? lastPort : undefined,
        mcpServers: {},
        allowedOrigins,
        aiSites,
        commandShellPath,
        commandRequireApproval: true
    };

    const started = await manager.start(config);
    sink(`🌐 webcode 网关（headless/DSH 宿主）已启动：http://127.0.0.1:${started.port}`
        + ` workspace=${primaryRoot ?? '(无)'} workspaceId=${workspaceId}`
        + ` 配对=${pairingPolicy} 会话表=${storePath}`);
    await memento.update('mcp.lastPort', started.port);

    let closing = false;
    const shutdown = (signal: string): void => {
        if (closing) {
            return;
        }
        closing = true;
        sink(`🛑 收到 ${signal}，正在停止网关…`);
        manager.markShuttingDown();
        void manager.stop().finally(() => process.exit(0));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
    sink(`❌ 网关启动失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
