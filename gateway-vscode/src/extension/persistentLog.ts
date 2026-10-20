import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as vscode from 'vscode';

export const LOG_RETENTION_DAYS = 7;

const LOG_FILE_PREFIX = 'gateway-';
export const LOG_FILE_PATTERN = /^gateway-\d{8}\.log$/;

export interface PersistentLogger {
    readonly directory: string;
    readonly currentLogPath: string | null;
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

/**
 * 网关持久化日志：把关键事件追加到 globalStorage/logs/gateway-YYYYMMDD.log，
 * 按天滚动并保留最近 LOG_RETENTION_DAYS 天。所有文件操作都尽力而为——
 * 日志系统自身绝不允许拖垮扩展宿主。
 */
export function createPersistentLogger(storageRoot: string): PersistentLogger {
    const directory = path.join(storageRoot, 'logs');
    let currentLogPath: string | null = null;
    let currentDateKey = '';

    const write = (level: 'INFO' | 'WARN' | 'ERROR', message: string): void => {
        try {
            const dateKey = formatLocalDateKey(new Date());
            if (currentLogPath === null || dateKey !== currentDateKey) {
                fs.mkdirSync(directory, { recursive: true });
                pruneOldLogs(directory);
                currentDateKey = dateKey;
                currentLogPath = path.join(directory, `${LOG_FILE_PREFIX}${dateKey}.log`);
            }
            fs.appendFileSync(currentLogPath, `${new Date().toISOString()} [${level}] ${message}\n`, 'utf8');
        } catch {
            // Logging must never break the extension host; silently drop on any IO failure.
        }
    };

    return {
        directory,
        get currentLogPath() {
            return currentLogPath;
        },
        info: message => write('INFO', message),
        warn: message => write('WARN', message),
        error: (message, error) => write('ERROR', error === undefined ? message : `${message}: ${formatError(error)}`)
    };
}

function formatLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

function formatError(error: unknown): string {
    return error instanceof Error ? `${error.message}\n${error.stack ?? ''}`.trim() : String(error);
}

function pruneOldLogs(directory: string): void {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !LOG_FILE_PATTERN.test(entry.name)) {
            continue;
        }

        const fullPath = path.join(directory, entry.name);
        try {
            if (fs.statSync(fullPath).mtimeMs < cutoff) {
                fs.unlinkSync(fullPath);
            }
        } catch {
            // Best effort cleanup; ignore per-file failures.
        }
    }
}

/**
 * 把 VS Code OutputChannel 的内容同步 tee 一份到持久化日志，
 * 网关管理器、服务控制器等现有组件无需改动即可获得落盘能力。
 */
export class TeeOutputChannel implements vscode.OutputChannel {
    constructor(
        private readonly target: vscode.OutputChannel,
        private readonly logger: PersistentLogger
    ) { }

    get name(): string {
        return this.target.name;
    }

    append(value: string): void {
        this.target.append(value);
    }

    appendLine(value: string): void {
        this.target.appendLine(value);
        this.logger.info(value);
    }

    clear(): void {
        this.target.clear();
    }

    replace(value: string): void {
        this.target.replace(value);
    }

    show(preserveFocus?: boolean): void;
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        this.target.show(columnOrPreserveFocus as vscode.ViewColumn, preserveFocus);
    }

    hide(): void {
        this.target.hide();
    }

    dispose(): void {
        this.target.dispose();
    }
}
