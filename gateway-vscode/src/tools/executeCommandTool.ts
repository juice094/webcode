import { execFile } from 'child_process';
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
    resolveCommandExecutionMs
} from '../gateway/timeouts';

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
        return createExecuteCommandDefinition(context.commandShellPath, context.commandExecutionMs);
    },
    async assessRisk(args, context) {
        return (await resolveExecuteCommandRequest(args, context)).risk;
    },
    async execute(args, context) {
        if (!context.workspaceRoot) {
            return errorResult('Security Error: A VS Code workspace folder is required to run commands.');
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

            const timeout = typeof args.timeout === 'number'
                ? args.timeout
                : resolveCommandExecutionMs(context.commandExecutionMs);
            const result = await runCommand(
                request.execution.file,
                request.execution.args,
                request.absolutePath,
                timeout
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
    commandExecutionMs: number = DEFAULT_COMMAND_EXECUTION_MS
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
                timeout: {
                    ...EXECUTE_COMMAND_INPUT_SCHEMA.properties.timeout,
                    default: commandExecutionMs,
                    description: `Timeout in milliseconds. Default: ${commandExecutionMs}.`
                }
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
    timeout: number
): Promise<{ stdout: string; stderr: string; exitCode: number; signal: NodeJS.Signals | null; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
        execFile(file, args, {
            cwd,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
            windowsHide: true
        }, (error, stdout, stderr) => {
            if (!error) {
                resolve({ stdout, stderr, exitCode: 0, signal: null, timedOut: false });
                return;
            }

            const execError = error as NodeJS.ErrnoException & {
                code?: number | string;
                signal?: NodeJS.Signals | null;
                killed?: boolean;
            };
            if (execError.code === 'ENOENT') {
                reject(new Error(`Command shell not found: ${file}`));
                return;
            }

            resolve({
                stdout: stdout || '',
                stderr: stderr || execError.message,
                exitCode: typeof execError.code === 'number' ? execError.code : 1,
                signal: execError.signal ?? null,
                // The only kill source in this tool is the execFile timeout, so a
                // reported kill identifies an overrun. Only the shell process is
                // stopped; children it spawned may keep running.
                timedOut: execError.killed === true && execError.signal != null
            });
        });
    });
}
