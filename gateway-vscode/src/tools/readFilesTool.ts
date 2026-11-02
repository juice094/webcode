import * as crypto from 'crypto';
import * as fs from 'fs/promises';

import { isBuiltinSkillVirtualPathCandidate } from '../builtinSkills';
import { getSensitiveFileApprovalError, isSensitiveFilePath } from '../servers/sensitivePathPolicy';
import type { LocalTool, ToolExecutionContext, ToolResult, ToolRiskPreflight } from './types';
import { errorResult } from './result';
import { getErrorMessage } from '../gateway/errorUtils';
import { getAbortReasonText } from './abortUtils';
import { hasAttachmentExtension } from './attachmentSupport';
import { readFileContent, readBuiltinSkillVirtualContent } from './readFileTool';
import { WORKSPACE_FILE_PATH_DESCRIPTION, getContextWorkspaceRoots, resolveWorkspaceRelativePath } from './workspacePath';

/** Batch ceiling: more paths than this must be split into repeated calls. */
export const READ_FILES_MAX_PATHS = 16;

const READ_FILES_PATHS_DESCRIPTION = [
    `Workspace-relative text file paths using "/" separators, 1 to ${READ_FILES_MAX_PATHS} per call.`,
    'In a multi-root workspace, prefix with the folder name to address a sibling folder directly.',
    'Absolute paths, home paths, and backslashes are rejected, same as read_file.'
].join(' ');

type ReadFilesItem =
    | { path: string; ok: true; content: string; truncated?: unknown }
    | { path: string; ok: false; error: string };

/**
 * Batch read: one call fetches many workspace text files. Each path is read
 * with the same security semantics as read_file (workspace-relative
 * resolution, sensitive-file approval, builtin skill virtual paths) and
 * produces its own result entry, so one bad path never fails the batch.
 * Binary attachments are out of scope: read them with read_file one by one.
 */
export const readFilesTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'read_files',
        description: 'Read several UTF-8 text files from the current VS Code workspace in one call. ' +
            'Returns one result entry per path (content or error) in structuredContent.results; ' +
            'a failed path never aborts the remaining reads. ' +
            'Supports head, tail, start_line/end_line, and show_line_numbers, applied to every file. ' +
            `Accepts at most ${READ_FILES_MAX_PATHS} paths per call; split larger batches into multiple calls. ` +
            'For binary attachments (images, PDF) use read_file instead.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION },
                    minItems: 1,
                    description: READ_FILES_PATHS_DESCRIPTION
                },
                head: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the start of every file.' },
                tail: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the end of every file.' },
                start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based first line to read. Must be used with end_line and without head or tail.' },
                end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based last line to read, inclusive. Must be used with start_line and without head or tail.' },
                show_line_numbers: { type: 'boolean', description: 'Prefix each returned line with its 1-based line number. Default: false.', default: false }
            },
            required: ['paths']
        },
        annotations: { readOnlyHint: true }
    },
    assessRisk: args => Promise.resolve(assessReadFilesRisk(args)),
    async execute(args, context, signal) {
        if (signal?.aborted) {
            return errorResult(`read_files aborted: ${getAbortReasonText(signal)}`);
        }

        const paths = readRequestedPaths(args.paths);
        if (typeof paths === 'string') {
            return errorResult(paths);
        }

        const approvalError = getSensitiveFileApprovalError(assessReadFilesRisk(args), context.approvedCommandFingerprint);
        if (approvalError) {
            return errorResult(approvalError);
        }

        const roots = getContextWorkspaceRoots(context);
        const results: ReadFilesItem[] = [];
        for (const itemPath of paths) {
            if (signal?.aborted) {
                results.push({ path: itemPath, ok: false, error: `read_files aborted: ${getAbortReasonText(signal)}` });
                continue;
            }
            results.push(await readOneWorkspaceFile(itemPath, args, context, roots, signal));
        }

        return formatReadFilesResult(results);
    }
};

/**
 * Batch risk view: the batch needs confirmation when any requested path is
 * sensitive. The fingerprint covers the whole path list so an approval grant
 * matches exactly the batch that was assessed.
 */
function assessReadFilesRisk(args: Record<string, unknown>): ToolRiskPreflight {
    const paths = readRequestedPaths(args.paths);
    const requestedPaths = typeof paths === 'string' ? [] : paths;
    const sensitivePath = requestedPaths.find(path => isSensitiveFilePath(path));
    const assessment = sensitivePath
        ? {
            level: 'requires_confirmation' as const,
            reasons: [`Access to sensitive file "${sensitivePath}" requires explicit approval.`]
        }
        : { level: 'allowed' as const, reasons: [] };
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        tool: 'read_files',
        paths: requestedPaths
    })).digest('hex');

    return { assessment, fingerprint };
}

/** Returns the validated path list, or the retryable error text when invalid. */
function readRequestedPaths(value: unknown): string[] | string {
    if (!Array.isArray(value)) {
        return 'read_files requires a "paths" array of workspace-relative file paths.';
    }
    const paths = value.map(entry => (typeof entry === 'string' ? entry.trim() : ''));
    if (paths.some(entry => entry === '')) {
        return 'read_files requires every paths entry to be a non-empty string.';
    }
    if (paths.length > READ_FILES_MAX_PATHS) {
        return `read_files accepts at most ${READ_FILES_MAX_PATHS} paths per call; ` +
            `this call listed ${paths.length}. Split the batch into smaller read_files calls and retry.`;
    }
    return paths;
}

async function readOneWorkspaceFile(
    itemPath: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    roots: ReturnType<typeof getContextWorkspaceRoots>,
    signal?: AbortSignal
): Promise<ReadFilesItem> {
    try {
        if (isBuiltinSkillVirtualPathCandidate(itemPath)) {
            const virtual = await readBuiltinSkillVirtualContent({ ...args, path: itemPath }, context, signal);
            if (virtual) {
                return toOkItem(itemPath, virtual);
            }
        }

        const resolved = await resolveWorkspaceRelativePath(roots, itemPath);
        if (hasAttachmentExtension(resolved.relativePath)) {
            return {
                path: itemPath,
                ok: false,
                error: 'read_files reads text files only; use read_file to read this file as an attachment.'
            };
        }

        const fileStats = await fs.stat(resolved.absolutePath);
        const result = await readFileContent(resolved.absolutePath, fileStats.size, args, signal);
        return toOkItem(itemPath, result);
    } catch (error: unknown) {
        return { path: itemPath, ok: false, error: getErrorMessage(error) };
    }
}

function toOkItem(itemPath: string, result: { text: string; metadata?: unknown }): ReadFilesItem {
    return result.metadata === undefined
        ? { path: itemPath, ok: true, content: result.text }
        : { path: itemPath, ok: true, content: result.text, truncated: result.metadata };
}

function formatReadFilesResult(results: readonly ReadFilesItem[]): ToolResult {
    const okCount = results.filter(item => item.ok).length;
    const header = `[read_files] ${okCount}/${results.length} file(s) read successfully.`;
    const text = [header, ...results.map(formatReadFilesItemText)].join('\n\n');
    return {
        content: [{ type: 'text', text }],
        structuredContent: { results: results.map(item => ({ ...item })) },
        isError: results.length > 0 && okCount === 0
    };
}

function formatReadFilesItemText(item: ReadFilesItem, index: number): string {
    const label = `[${index + 1}] ${item.path}`;
    return item.ok ? `${label}\n${item.content}` : `${label}\nERROR: ${item.error}`;
}
