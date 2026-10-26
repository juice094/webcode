import * as fs from 'fs/promises';
import * as path from 'path';
import { BUILTIN_SKILL_VIRTUAL_ROOT, isBuiltinSkillVirtualPathCandidate } from '../builtinSkills';
import type { LocalTool, ToolExecutionContext, ToolResult } from './types';
import { errorResult } from './result';
import { normalizeLineEndings } from './filesystemUtils';
import { readFilePrefix } from './readFilePrefix';
import { readSelectedFileLines, type LineSelectionOptions } from './readFileLineStream';
import {
    capLineSelectionOptions,
    didLineSelectionHitOutputLimit,
    getLineSelectionOptions,
    hasLineSelection
} from './readFileLineSelection';
import { WORKSPACE_FILE_PATH_DESCRIPTION, getContextWorkspaceRoots, resolveWorkspaceRelativePath } from './workspacePath';
import { assessSensitiveFileRisk, getSensitiveFileApprovalError } from '../servers/sensitivePathPolicy';
import { getAbortReasonText } from './abortUtils';
import {
    formatLimitedReadFileOutput,
    READ_FILE_OUTPUT_MAX_BYTES,
    type LimitedReadFileOutput,
    type ReadFileTruncationReason
} from './readFileOutputLimit';
import {
    ATTACH_FILE_MAX_BYTES,
    createAttachmentResult,
    formatBytes as formatAttachmentBytes,
    hasAttachmentExtension,
    resolveSupportedAttachment
} from './attachmentSupport';

export { readFilePrefix } from './readFilePrefix';

const READ_FILE_PATH_DESCRIPTION = `${WORKSPACE_FILE_PATH_DESCRIPTION} Read-only built-in skill virtual paths under ` +
    `${BUILTIN_SKILL_VIRTUAL_ROOT}/ are also supported.`;

export const readFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'read_file',
        description: 'Read a UTF-8 text file inside the current VS Code workspace, or a read-only built-in skill virtual path. ' +
            'Supports head, tail, start_line/end_line, and show_line_numbers to inspect code without shell commands. ' +
            'When path points to a PNG, JPEG, WebP, GIF, or PDF file, the file is delivered as a browser attachment instead of text; ' +
            'line selection arguments are rejected for those files.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: READ_FILE_PATH_DESCRIPTION },
                head: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the start of the file.' },
                tail: { type: 'integer', minimum: 1, description: 'Optional number of lines to read from the end of the file.' },
                start_line: { type: 'integer', minimum: 1, description: 'Optional 1-based first line to read. Must be used with end_line and without head or tail.' },
                end_line: { type: 'integer', minimum: 1, description: 'Optional 1-based last line to read, inclusive. Must be used with start_line and without head or tail.' },
                show_line_numbers: { type: 'boolean', description: 'Prefix each returned line with its 1-based line number. Default: false.', default: false }
            },
            required: ['path']
        },
        annotations: { readOnlyHint: true }
    },
    assessRisk: (args) => Promise.resolve(assessSensitiveFileRisk('read_file', args)),
    async execute(args, context, signal) {
        if (signal?.aborted) {
            return errorResult(`read_file aborted: ${getAbortReasonText(signal)}`);
        }

        const builtinResult = await readBuiltinSkillVirtualContent(args, context, signal);
        if (builtinResult) {
            return formatReadFileToolResult(builtinResult);
        }

        const risk = assessSensitiveFileRisk('read_file', args);
        if (getSensitiveFileApprovalError(risk, context.approvedCommandFingerprint)) { return errorResult(`Approval Required: ${risk.assessment.reasons.join(' ')}`); }

        const resolved = await resolveWorkspaceRelativePath(getContextWorkspaceRoots(context), args.path);
        const fileStats = await fs.stat(resolved.absolutePath);

        if (hasAttachmentExtension(resolved.relativePath)) {
            return readAttachmentResult(resolved.absolutePath, resolved.relativePath, args);
        }

        const result = await readFileContent(resolved.absolutePath, fileStats.size, args, signal);
        return formatReadFileToolResult(result);
    }
};

async function readAttachmentResult(
    filePath: string,
    relativePath: string,
    args: Record<string, unknown>
): Promise<ToolResult> {
    if (hasLineSelection(getLineSelectionOptions(args))) {
        throw new Error(
            'read_file cannot apply line selection to a binary attachment. ' +
            'Read the full file or use attach_file directly.'
        );
    }

    const stats = await fs.stat(filePath);
    if (stats.size === 0) {
        throw new Error(`read_file cannot attach an empty file: ${relativePath}`);
    }
    if (stats.size > ATTACH_FILE_MAX_BYTES) {
        throw new Error(`read_file supports attachments up to ${formatAttachmentBytes(ATTACH_FILE_MAX_BYTES)}.`);
    }

    const content = await fs.readFile(filePath);
    if (content.byteLength > ATTACH_FILE_MAX_BYTES) {
        throw new Error(`read_file supports attachments up to ${formatAttachmentBytes(ATTACH_FILE_MAX_BYTES)}.`);
    }

    const attachment = resolveSupportedAttachment('read_file', relativePath, content);
    return createAttachmentResult({
        base64: content.toString('base64'),
        bytes: content.byteLength,
        fileName: path.posix.basename(relativePath),
        mimeType: attachment.mimeType,
        relativePath
    });
}

export function selectReadFileContent(content: string, args: Record<string, unknown>): string {
    return selectReadFileResult(content, args).text;
}

type ReadFileResult = {
    text: string;
    metadata?: ReadFileMetadata;
};

type ReadFileMetadata = {
    truncated: true;
    reason: ReadFileTruncationReason;
    returnedLines: {
        start: number;
        end: number;
    };
    lineCountKnown: boolean;
    lineCount?: number;
    returnedBytes?: number;
    fileBytes?: number;
};

type ReadFileResultDetails = {
    fileBytes?: number;
    lineCountKnown: boolean;
    lineCount?: number;
    returnedLines: {
        start: number;
        end: number;
    };
};

type ReadFileTruncationDetails = {
    reason: ReadFileTruncationReason;
    returnedLines: {
        start: number;
        end: number;
    };
    lineCountKnown: boolean;
    lineCount?: number;
    returnedBytes?: number;
    fileBytes?: number;
};

type ReadFileResultOptions = {
    fileBytes?: number;
    prefixLimitApplied?: boolean;
    byteLimitApplied?: boolean;
    totalLineCountKnown?: boolean;
};

async function readBuiltinSkillVirtualContent(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
    signal?: AbortSignal
): Promise<ReadFileResult | null> {
    if (!isBuiltinSkillVirtualPathCandidate(args.path)) {
        return null;
    }

    const virtualFile = await context.skillManager.resolveBuiltinSkillVirtualFile(args.path);
    if (virtualFile.status === 'missing') {
        throw new Error(`Built-in skill virtual path not found: ${virtualFile.path}`);
    }
    if (virtualFile.status === 'not_builtin') {
        return null;
    }

    return readFileContent(virtualFile.absolutePath, virtualFile.bytes, args, signal);
}

function formatReadFileToolResult(result: ReadFileResult): ToolResult {
    return {
        content: [{ type: 'text', text: result.text }],
        ...(result.metadata === undefined ? {} : { structuredContent: result.metadata })
    };
}

export async function readFileContent(
    filePath: string,
    fileBytes: number,
    args: Record<string, unknown>,
    signal?: AbortSignal
): Promise<ReadFileResult> {
    const lineOptions = getLineSelectionOptions(args);

    if (hasLineSelection(lineOptions)) {
        return readSelectedFileContent(filePath, args, lineOptions, fileBytes, signal);
    }

    if (fileBytes <= READ_FILE_OUTPUT_MAX_BYTES) {
        return selectReadFileResult(normalizeLineEndings(await fs.readFile(filePath, 'utf8')), args, { fileBytes });
    }

    const content = normalizeLineEndings(await readFilePrefix(filePath, READ_FILE_OUTPUT_MAX_BYTES));
    return selectReadFileResult(content, args, {
        fileBytes,
        prefixLimitApplied: true,
        byteLimitApplied: true,
        totalLineCountKnown: false
    });
}

export function selectReadFileResult(
    content: string,
    args: Record<string, unknown>,
    options: ReadFileResultOptions = {}
): ReadFileResult {
    const lines = splitLines(content);
    const lineOptions = getLineSelectionOptions(args);
    const selection = resolveLineSelection(lines.length, lineOptions);
    const showLineNumbers = args.show_line_numbers === true;
    const prefixLimitApplied = options.prefixLimitApplied === true;
    const totalLineCountKnown = options.totalLineCountKnown !== false;

    if (selection) {
        const limited = formatLimitedReadFileOutput(
            lines.slice(selection.startIndex, selection.endIndex),
            selection.startIndex + 1,
            showLineNumbers,
            { preserveLastLines: lineOptions.tail !== undefined }
        );
        return buildReadFileResult(limited, {
            fileBytes: options.fileBytes,
            lineCountKnown: totalLineCountKnown,
            lineCount: totalLineCountKnown ? lines.length : undefined,
            returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
        });
    }

    const limited = formatLimitedReadFileOutput(lines, 1, showLineNumbers, {
        byteLimitAlreadyApplied: options.byteLimitApplied === true
    });

    if (!prefixLimitApplied && limited.truncationReason === undefined) {
        return { text: limited.text };
    }

    return buildReadFileResult(limited, {
        fileBytes: options.fileBytes,
        lineCountKnown: totalLineCountKnown,
        lineCount: totalLineCountKnown ? lines.length : undefined,
        returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
    });
}

function buildReadFileResult(limited: LimitedReadFileOutput, details: ReadFileResultDetails): ReadFileResult {
    if (limited.truncationReason === undefined) {
        return { text: limited.text };
    }

    const text = formatReadFileResultText(limited, details.fileBytes, details.lineCount);
    return {
        text,
        metadata: createReadFileMetadata({
            reason: limited.truncationReason,
            lineCountKnown: details.lineCountKnown,
            lineCount: details.lineCount,
            returnedLines: details.returnedLines,
            returnedBytes: Buffer.byteLength(text, 'utf8'),
            fileBytes: details.fileBytes
        })
    };
}

function createReadFileMetadata(details: ReadFileTruncationDetails): ReadFileMetadata {
    return {
        truncated: true,
        reason: details.reason,
        returnedLines: details.returnedLines,
        lineCountKnown: details.lineCountKnown,
        lineCount: details.lineCount,
        returnedBytes: details.returnedBytes,
        fileBytes: details.fileBytes
    };
}

type LineSelection = {
    startIndex: number;
    endIndex: number;
};

function resolveLineSelection(lineCount: number, options: LineSelectionOptions): LineSelection | null {
    const { head, tail, startLine, endLine } = options;
    if (head !== undefined) {
        return { startIndex: 0, endIndex: Math.min(head, lineCount) };
    }

    if (tail !== undefined) {
        const startIndex = Math.max(lineCount - tail, 0);
        return { startIndex, endIndex: lineCount };
    }

    if (startLine !== undefined && endLine !== undefined) {
        const startIndex = Math.min(Math.max(startLine - 1, 0), lineCount);
        return {
            startIndex,
            endIndex: Math.min(endLine, lineCount)
        };
    }

    return null;
}

function getReturnedLineRange(firstLineNumber: number, returnedLineCount: number): { start: number; end: number } {
    if (returnedLineCount <= 0) {
        return { start: 0, end: 0 };
    }

    return {
        start: firstLineNumber,
        end: firstLineNumber + returnedLineCount - 1
    };
}

function formatReadFileResultText(limited: LimitedReadFileOutput, fileBytes?: number, lineCount?: number): string {
    if (limited.truncationReason === undefined) {
        return limited.text;
    }

    return appendTruncationNotice(limited.text, {
        fileBytes,
        returnedLines: limited.returnedLineCount,
        lineCount,
        truncationReason: limited.truncationReason
    });
}

async function readSelectedFileContent(
    filePath: string,
    args: Record<string, unknown>,
    options: LineSelectionOptions,
    fileBytes: number,
    signal?: AbortSignal
): Promise<ReadFileResult> {
    const selected = await readSelectedFileLines(filePath, capLineSelectionOptions(options), signal);
    const showLineNumbers = args.show_line_numbers === true;
    const limited = formatLimitedReadFileOutput(selected.lines, selected.startLine, showLineNumbers, {
        lineLimitAlreadyApplied: didLineSelectionHitOutputLimit(options, selected),
        preserveLastLines: options.tail !== undefined
    });
    return buildReadFileResult(limited, {
        fileBytes,
        lineCountKnown: selected.lineCount !== undefined,
        lineCount: selected.lineCount,
        returnedLines: getReturnedLineRange(limited.firstLineNumber, limited.returnedLineCount)
    });
}

// Line selection parsing and the output-limit decision live in
// readFileLineSelection so this module stays inside the 400-line budget.

function splitLines(content: string): string[] {
    if (content === '') {
        return [];
    }
    return content.split('\n');
}

function appendTruncationNotice(
    content: string,
    details: {
        fileBytes?: number;
        returnedLines: number;
        lineCount?: number;
        truncationReason: ReadFileTruncationReason;
    }
): string {
    const totalLinesText = details.lineCount === undefined ? '' : ` of ${details.lineCount}`;
    const sizeText = details.fileBytes === undefined ? '' : ` File size: ${formatBytes(details.fileBytes)}.`;
    const notice = [
        '',
        `[read_file] Output truncated; returned ${details.returnedLines} line(s)${totalLinesText}. Reason: ${details.truncationReason}.${sizeText}`,
        `[read_file] Use a narrower line range with start_line/end_line, head, or tail to read more.`
    ].join('\n');

    return content ? `${content}\n${notice}` : notice.trimStart();
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
