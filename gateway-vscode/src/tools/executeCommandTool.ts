import { execFile, type ChildProcess } from 'child_process';
import type { LocalTool, ToolDefinition, ToolExecutionContext, ToolRiskPreflight } from './types';
import { errorResult, jsonResult } from './result';
import { WORKSPACE_COMMAND_PATH_DESCRIPTION, resolveWorkspaceRelativeDirectory } from './workspacePath';
import { normalizeShellCommand } from '../servers/commandShell';
import { formatCommandRiskAssessment } from '../servers/commandRisk';
import { getErrorMessage } from '../gateway/errorUtils';
import {
    describeBackgroundShellProfiles,
    resolveBackgroundShellExecutionPlan,
    type BackgroundShellExecutionPlan
} from '../servers/backgroundShell';
import { assessCommandToolRisk } from '../servers/commandToolRisk';
import {
    DEFAULT_COMMAND_EXECUTION_MS,
    MAX_COMMAND_EXECUTION_MS,
    MIN_COMMAND_EXECUTION_MS,
    resolveCommandExecutionMs,
    resolveCommandExecutionTimeoutMs
} from '../gateway/timeouts';
import { buildExecuteCommandTimeoutSchema } from './executeCommandTimeout';
import { killProcessTree } from '../servers/processTree';
import { getAbortReasonText } from './abortUtils';

export const executeCommandTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'execute_command',
        description: 'Execute a short-lived shell command in the background and return stdout, stderr, and exitCode.',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', minLength: 1, description: 'Command to execute using the selected shell profile syntax, for example "git status" or "pnpm test". Use dedicated file/search tools for ordinary workspace inspection.' },
                path: { type: 'string', description: WORKSPACE_COMMAND_PATH_DESCRIPTION },
                profile: { type: 'string', description: 'Optional shell profile id. Omit to preserve the default POSIX/Git Bash behavior.' },
                timeout: {
                    type: 'integer',
                    minimum: MIN_COMMAND_EXECUTION_MS,
                    maximum: MAX_COMMAND_EXECUTION_MS,
                    description: `Timeout in milliseconds. Default: ${DEFAULT_COMMAND_EXECUTION_MS}.`,
                    default: DEFAULT_COMMAND_EXECUTION_MS
                }
            },
            required: ['command']
        }
    },
    getDefinition(context) {
        return getCachedExecuteCommandDefinition(
            context.commandShellPath,
            context.commandExecutionMs,
            context.commandExecutionMaxMs
        );
    },
    async assessRisk(args, context) {
        return (await resolveExecuteCommandRequest(args, context)).risk;
    },
    async execute(args, context, signal) {
        if (!context.workspaceRoot) {
            return errorResult('Security Error: A VS Code workspace folder is required to run commands.');
        }
        if (signal?.aborted) {
            return errorResult(`Execution aborted: ${getAbortReasonText(signal)}`);
        }

        try {
            const request = await resolveExecuteCommandRequest(args, context);
            if (request.risk.assessment.level === 'blocked') {
                return errorResult(`Security Error: ${formatCommandRiskAssessment(request.risk.assessment)}`);
            }
            if (request.risk.assessment.level === 'requires_confirmation'
                && context.approvedCommandFingerprint !== request.risk.fingerprint) {
                return errorResult(`Approval Required: ${formatCommandRiskAssessment(request.risk.assessment)}`);
            }

            const timeout = resolveCommandExecutionTimeoutMs(
                args.timeout,
                resolveCommandExecutionMs(context.commandExecutionMs),
                context.commandExecutionMaxMs
            );
            const result = await runCommand(
                request.execution.file,
                request.execution.args,
                request.absolutePath,
                timeout,
                signal
            );
            const isError = result.exitCode !== 0;
            const stdout = result.stdout.trim();
            const stderr = result.stderr.trim();
            const status = isError ? 'error' : (stderr ? 'completed_with_stderr' : 'success');

            return jsonResult({
                summary: summarizeCommandResult({
                    stdout,
                    stderr,
                    exitCode: result.exitCode,
                    signal: result.signal,
                    status,
                    timedOut: result.timedOut,
                    timeoutMs: timeout
                }),
                stdout,
                stderr,
                exitCode: result.exitCode,
                signal: result.signal,
                timedOut: result.timedOut,
                shell: {
                    id: request.execution.profile.id,
                    path: request.execution.profile.path,
                    syntax: request.execution.profile.shellKind
                },
                status
            }, isError);
        } catch (error: unknown) {
            if (signal?.aborted) {
                return errorResult(`Execution aborted: ${getAbortReasonText(signal)}`);
            }
            return errorResult(`Execution System Error: ${getErrorMessage(error)}`);
        }
    }
};

type ResolvedExecuteCommandRequest = {
    absolutePath: string;
    execution: BackgroundShellExecutionPlan;
    risk: ToolRiskPreflight;
};

async function resolveExecuteCommandRequest(
    args: Record<string, unknown>,
    context: ToolExecutionContext
): Promise<ResolvedExecuteCommandRequest> {
    if ('cwd' in args) {
        throw new Error('Parameter "cwd" has been removed. Use workspace-relative "path" instead.');
    }
    if (!context.workspaceRoot) {
        throw new Error('A VS Code workspace folder is required to run commands.');
    }

    const commandLine = normalizeShellCommand(args.command);
    const directory = await resolveWorkspaceRelativeDirectory(context.workspaceRoot, args.path ?? '.');
    const execution = resolveBackgroundShellExecutionPlan(commandLine, args.profile, {
        platform: process.platform,
        env: process.env,
        configuredCommandShellPath: context.commandShellPath
    });
    const risk = assessCommandToolRisk({
        command: commandLine,
        commandPath: directory.relativePath,
        profileId: `${execution.profile.id}\0${execution.profile.path}`,
        shellKind: execution.profile.shellKind,
        toolName: 'execute_command',
        riskContext: {
            workspaceRoot: context.workspaceRoot,
            cwd: directory.absolutePath,
            allowedRoots: context.commandAllowedRoots,
            denyRules: context.commandDenyRules,
            platform: process.platform
        }
    });

    return {
        absolutePath: directory.absolutePath,
        execution,
        risk
    };
}

type ExecuteCommandInputSchema = {
    properties: Record<string, Record<string, unknown>>;
    [key: string]: unknown;
};

const EXECUTE_COMMAND_INPUT_SCHEMA = executeCommandTool.definition.inputSchema as ExecuteCommandInputSchema;

function createExecuteCommandDefinition(
    commandShellPath?: string,
    commandExecutionMs: number = DEFAULT_COMMAND_EXECUTION_MS,
    commandExecutionMaxMs?: number
): ToolDefinition {
    const profiles = describeBackgroundShellProfiles({
        platform: process.platform,
        env: process.env,
        configuredCommandShellPath: commandShellPath
    });
    return {
        name: 'execute_command',
        description: [
            'Execute a short-lived command in the background and return stdout, stderr, and exitCode.',
            'Use this for builds, tests, package managers, git, and project scripts.',
            'Omit profile to preserve the existing POSIX/Git Bash behavior, or select an available profile.',
            'PowerShell profiles run without loading the user profile and use non-interactive mode.',
            'For long-running commands or visible output, use run_in_terminal.',
            'Available background shell profiles:',
            profiles
        ].join('\n'),
        inputSchema: {
            ...EXECUTE_COMMAND_INPUT_SCHEMA,
            properties: {
                ...EXECUTE_COMMAND_INPUT_SCHEMA.properties,
                timeout: buildExecuteCommandTimeoutSchema(
                    EXECUTE_COMMAND_INPUT_SCHEMA.properties.timeout,
                    commandExecutionMs,
                    commandExecutionMaxMs
                )
            }
        }
    };
}

function summarizeCommandResult(result: {
    stdout: string;
    stderr: string;
    exitCode: number;
    signal: NodeJS.Signals | null;
    status: 'success' | 'completed_with_stderr' | 'error';
    timedOut: boolean;
    timeoutMs: number;
}): string {
    if (result.timedOut) {
        return `Command timed out after ${result.timeoutMs} ms. Only the shell process is stopped; the process may still be running.`;
    }

    if (result.status === 'success') {
        return result.stdout
            ? 'Command completed successfully.'
            : 'Command completed successfully with no stdout or stderr output.';
    }

    if (result.status === 'completed_with_stderr') {
        return 'Command completed successfully with stderr output.';
    }

    if (result.signal) {
        return `Command failed with exit code ${result.exitCode} and signal ${result.signal}.`;
    }

    return result.stdout || result.stderr
        ? `Command failed with exit code ${result.exitCode}.`
        : `Command failed with exit code ${result.exitCode} and no stdout or stderr output.`;
}

async function runCommand(
    file: string,
    args: string[],
    cwd: string,
    timeout: number,
    signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        // A holder keeps `child` const for lint while still letting the abort
        // listener registered before spawn read the pid once spawn returns.
        const holder: { child?: ChildProcess } = {};

        const finish = (action: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            action();
        };

        const onAbort = (): void => {
            // The deadline is a watchdog: the caller stopped waiting, so the
            // command must not keep running. Kill the whole tree instead of the
            // shell only, because `bash -lc` forks the real work.
            if (holder.child?.pid) {
                killProcessTree(holder.child.pid);
            }
            finish(() => resolve({
                stdout: '',
                stderr: `Aborted: ${getAbortReasonText(signal)}`,
                exitCode: 124,
                signal: 'SIGKILL',
                timedOut: true
            }));
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        holder.child = execFile(file, args, {
            cwd,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            windowsHide: true
        }, (error, stdout, stderr) => {
            if (!error) {
                finish(() => resolve({ stdout, stderr, exitCode: 0, signal: null, timedOut: false }));
                return;
            }

            const execError = error as NodeJS.ErrnoException & {
                code?: number | string;
                signal?: NodeJS.Signals | null;
                killed?: boolean;
            };
            if (execError.code === 'ENOENT') {
                finish(() => reject(new Error(`Command shell not found: ${file}`)));
                return;
            }

            finish(() => resolve({
                stdout: stdout || '',
                stderr: stderr || execError.message,
                exitCode: typeof execError.code === 'number' ? execError.code : 1,
                signal: execError.signal ?? null,
                // The only kill source on this path is the execFile timeout, so a
                // reported kill identifies an overrun. Only the shell process is
                // stopped; children it spawned may keep running.
                timedOut: execError.killed === true && execError.signal != null
            }));
        });
    });
}

const definitionCache = new Map<string, ToolDefinition>();

function getCachedExecuteCommandDefinition(
    commandShellPath?: string,
    commandExecutionMs?: number,
    commandExecutionMaxMs?: number
): ToolDefinition {
    const key = [
        commandShellPath ?? '',
        commandExecutionMs ?? DEFAULT_COMMAND_EXECUTION_MS,
        commandExecutionMaxMs ?? ''
    ].join('\0');

    const cached = definitionCache.get(key);
    if (cached) {
        return cached;
    }

    // The description embeds the resolved shell profiles, so a definition is
    // rebuilt only when the caller's context changes. A small bound keeps a
    // pathological settings churn from growing the cache without limit.
    const definition = createExecuteCommandDefinition(commandShellPath, commandExecutionMs, commandExecutionMaxMs);
    if (definitionCache.size >= 16) {
        definitionCache.clear();
    }
    definitionCache.set(key, definition);
    return definition;
}

