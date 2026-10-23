import { spawn } from 'child_process';
import type * as vscode from 'vscode';
import type { LocalTool } from './types';
import { textResult } from './result';
import { getNumberArg } from './filesystemUtils';
import { createSearchCodeFallbackNotice, searchCodeInProcess } from './searchCodeFallback';
import { formatSearchCodeOutput, type SearchCodeResult } from './searchCodeOutput';
import { appendRipgrepMatch } from './searchCodeRipgrepOutput';
import { createRipgrepStartError, resolveRipgrepCommand, RipgrepUnavailableError } from './ripgrep';
import { killProcessTree } from '../servers/processTree';
import { getAbortReasonText } from './abortUtils';
import { createSearchCodeRipgrepArgs } from './searchCodeRipgrepArgs';
import {
    DEFAULT_MATCH_LINE_MAX_CHARS,
    getBoundedSearchLineMaxChars,
    getSearchCodeMatchMode,
    MAX_MATCH_LINE_MAX_CHARS,
    MIN_MATCH_LINE_MAX_CHARS,
} from './searchCodeUtils';
import type { SearchCodeOptions } from './searchCodeTypes';
import { WORKSPACE_SEARCH_PATH_DESCRIPTION, resolveWorkspaceRelativeDirectory } from './workspacePath';

export const searchCodeTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'search_code',
        description: [
            'Search text content inside workspace files.',
            'Returns relative file paths with line numbers and matching lines, ordered by path and line number.',
            'Backed by ripgrep when available and follows ripgrep default ignore behavior, so .gitignore/.ignore/.rgignore may hide files.',
            'Git metadata directories are always skipped.'
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    minLength: 1,
                    description: [
                        'Text to search for.',
                        'match "substring" searches for a literal contained substring.',
                        'match "regex" treats this as a ripgrep regular expression.',
                        'When using regex syntax such as |, .*, groups, character classes, or \\b, set match to "regex".'
                    ].join(' ')
                },
                path: { type: 'string', description: WORKSPACE_SEARCH_PATH_DESCRIPTION },
                include: { type: 'string', description: 'Optional glob for files to include, for example "**/*.ts".' },
                case_sensitive: { type: 'boolean', description: 'Whether matching is case-sensitive. Default: false.', default: false },
                match: {
                    type: 'string',
                    enum: ['substring', 'regex'],
                    description: [
                        'How to interpret query.',
                        '"substring" is a literal contained substring and treats regex metacharacters as plain text.',
                        '"regex" is a ripgrep regular expression; use it for |, .*, groups, character classes, or \\b.',
                        'Default: substring.'
                    ].join(' '),
                    default: 'substring'
                },
                max_results: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 500,
                    description: 'Maximum matching lines to return. If this limit is reached, output includes a limited-results notice. Default: 100.',
                    default: 100
                },
                max_line_chars: {
                    type: 'integer',
                    minimum: MIN_MATCH_LINE_MAX_CHARS,
                    maximum: MAX_MATCH_LINE_MAX_CHARS,
                    description: [
                        'Maximum characters to return from each matching line.',
                        'Long lines are cropped around the match. Default: 500.'
                    ].join(' '),
                    default: DEFAULT_MATCH_LINE_MAX_CHARS
                }
            },
            required: ['query']
        },
        annotations: { readOnlyHint: true }
    },
    async execute(args, context, signal) {
        if (signal?.aborted) {
            throw new Error(`search_code aborted: ${getAbortReasonText(signal)}`);
        }
        const searchRoot = (await resolveWorkspaceRelativeDirectory(context.workspaceRoot, args.path ?? '.')).absolutePath;
        const workspaceRoot = context.workspaceRoot ?? searchRoot;
        const query = String(args.query);
        const maxResults = getNumberArg(args.max_results, 100);
        const options = {
            searchRoot,
            workspaceRoot,
            query,
            maxResults,
            includePattern: typeof args.include === 'string' ? args.include : undefined,
            caseSensitive: args.case_sensitive === true,
            useRegex: getSearchCodeMatchMode(args.match) === 'regex',
            matchLineMaxChars: getBoundedSearchLineMaxChars(args.max_line_chars)
        };
        const result = await runRipgrepWithFallback(options, context.outputChannel, signal);

        return textResult(formatSearchCodeOutput(result, options));
    }
};

async function runRipgrepWithFallback(
    options: SearchCodeOptions,
    outputChannel: vscode.OutputChannel,
    signal?: AbortSignal
): Promise<SearchCodeResult> {
    try {
        return await runRipgrep(options, signal);
    } catch (error) {
        if (error instanceof RipgrepUnavailableError) {
            logRipgrepFallback(outputChannel, error);
            const result = await searchCodeInProcess(options);
            return {
                ...result,
                notices: createSearchCodeFallbackNotice().split('\n')
            };
        }

        throw error;
    }
}

function logRipgrepFallback(outputChannel: vscode.OutputChannel, error: RipgrepUnavailableError): void {
    outputChannel.appendLine('[search_code] ripgrep unavailable; using in-process fallback.');
    for (const line of error.message.split('\n')) {
        outputChannel.appendLine(`[search_code] ${line}`);
    }
}

async function runRipgrep(options: SearchCodeOptions, signal?: AbortSignal): Promise<SearchCodeResult> {
    const rgCommand = resolveRipgrepCommand();
    const args = createSearchCodeRipgrepArgs(options);
    const matches: string[] = [];
    let limitReached = false;
    let stdoutBuffer = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (action: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            signal?.removeEventListener('abort', onAbort);
            action();
        };

        const child = spawn(rgCommand.command, args, {
            cwd: options.searchRoot,
            windowsHide: true,
            // POSIX: lead a process group so an abort reaches ripgrep and any
            // worker it forked. Windows has no group signal; the helper falls
            // back to taskkill /T there.
            detached: process.platform !== 'win32'
        });
        let spawnFailed = false;

        const onAbort = (): void => {
            if (child.pid) {
                killProcessTree(child.pid);
            }
            finish(() => reject(new Error(`search_code aborted: ${getAbortReasonText(signal)}`)));
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
            stdoutBuffer += chunk;

            // Consume with a cursor instead of re-slicing the whole buffer per
            // line: JSON match lines can be large, so slicing inside the loop
            // is O(chunk^2) on dense matches.
            let consumed = 0;
            let newlineIndex = stdoutBuffer.indexOf('\n');
            while (newlineIndex >= 0) {
                const line = stdoutBuffer.slice(consumed, newlineIndex);
                appendRipgrepMatch(line, options, matches);
                consumed = newlineIndex + 1;

                if (matches.length >= options.maxResults) {
                    limitReached = true;
                    if (child.pid) {
                        killProcessTree(child.pid);
                    }
                    break;
                }

                newlineIndex = stdoutBuffer.indexOf('\n', consumed);
            }
            if (consumed > 0) {
                stdoutBuffer = stdoutBuffer.slice(consumed);
            }
        });

        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', error => {
            spawnFailed = true;
            finish(() => reject(createRipgrepStartError(error, rgCommand)));
        });
        child.on('close', code => {
            if (spawnFailed) {
                return;
            }
            if (stdoutBuffer.trim() && matches.length < options.maxResults) {
                appendRipgrepMatch(stdoutBuffer, options, matches);
            }

            if (code === 0 || code === 1 || limitReached) {
                finish(() => resolve({
                    matches: matches.slice(0, options.maxResults),
                    limited: limitReached
                }));
                return;
            }

            finish(() => reject(new Error(`search_code failed: ${stderr.trim() || `ripgrep exited with code ${code ?? 'unknown'}`}`)));
        });
    });
}
