import {
    READ_FILE_OUTPUT_MAX_LINES,
} from './readFileOutputLimit';
import type { LineSelectionOptions, SelectedFileLines } from './readFileLineStream';

/**
 * Line-selection parsing and output-limit decisions for `read_file`.
 *
 * Extracted from readFileTool so the tool file stays inside the repository's
 * 400-line budget. Nothing here touches the filesystem: callers pass the parsed
 * options in and get back the bounded selection plus whether the output limit
 * cut the result short.
 */

export function getLineSelectionOptions(args: Record<string, unknown>): LineSelectionOptions {
    const options = {
        head: getPositiveIntegerArg(args.head),
        tail: getPositiveIntegerArg(args.tail),
        startLine: getPositiveIntegerArg(args.start_line),
        endLine: getPositiveIntegerArg(args.end_line)
    };
    assertCompatibleLineOptions(options);
    return options;
}

export function hasLineSelection(options: LineSelectionOptions): boolean {
    return options.head !== undefined ||
        options.tail !== undefined ||
        options.startLine !== undefined ||
        options.endLine !== undefined;
}

export function capLineSelectionOptions(options: LineSelectionOptions): LineSelectionOptions {
    if (options.head !== undefined) {
        return { ...options, head: Math.min(options.head, READ_FILE_OUTPUT_MAX_LINES) };
    }
    if (options.tail !== undefined) {
        return { ...options, tail: Math.min(options.tail, READ_FILE_OUTPUT_MAX_LINES) };
    }
    if (options.startLine !== undefined || options.endLine !== undefined) {
        const startLine = options.startLine ?? 1;
        const maxEndLine = startLine + READ_FILE_OUTPUT_MAX_LINES - 1;
        return { ...options, endLine: Math.min(options.endLine ?? maxEndLine, maxEndLine) };
    }
    return options;
}

export function didLineSelectionHitOutputLimit(
    options: LineSelectionOptions,
    selected: SelectedFileLines
): boolean {
    const requestedLineCount = getRequestedLineCount(options);
    if (requestedLineCount <= READ_FILE_OUTPUT_MAX_LINES || selected.lines.length < READ_FILE_OUTPUT_MAX_LINES) {
        return false;
    }
    if (options.tail !== undefined) {
        return selected.lineCount === undefined || selected.lineCount > READ_FILE_OUTPUT_MAX_LINES;
    }
    if (options.head !== undefined) {
        return selected.lineCount === undefined || selected.lineCount > READ_FILE_OUTPUT_MAX_LINES;
    }
    return didRangeSelectionHitOutputLimit(options, selected);
}

function didRangeSelectionHitOutputLimit(options: LineSelectionOptions, selected: SelectedFileLines): boolean {
    if (selected.lineCount === undefined) {
        return true;
    }
    const startLine = options.startLine ?? 1;
    const requestedEndLine = options.endLine ?? selected.lineCount;
    const availableEndLine = Math.min(requestedEndLine, selected.lineCount);
    return Math.max(availableEndLine - startLine + 1, 0) > READ_FILE_OUTPUT_MAX_LINES;
}

function getRequestedLineCount(options: LineSelectionOptions): number {
    if (options.head !== undefined) {
        return options.head;
    }
    if (options.tail !== undefined) {
        return options.tail;
    }
    const startLine = options.startLine ?? 1;
    return options.endLine === undefined ? Number.POSITIVE_INFINITY : options.endLine - startLine + 1;
}

function assertCompatibleLineOptions(options: {
    head?: number;
    tail?: number;
    startLine?: number;
    endLine?: number;
}): void {
    const { head, tail, startLine, endLine } = options;
    const hasRange = startLine !== undefined || endLine !== undefined;
    if (hasBothHeadAndTail(head, tail)) {
        throw new Error('Cannot specify both head and tail.');
    }

    if (hasHeadOrTailWithRange(head, tail, hasRange)) {
        throw new Error('Cannot specify head or tail with start_line or end_line.');
    }

    if (hasRange && (startLine === undefined || endLine === undefined)) {
        throw new Error('start_line and end_line must be specified together.');
    }

    if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        throw new Error('start_line must be less than or equal to end_line.');
    }
}

function hasBothHeadAndTail(head: number | undefined, tail: number | undefined): boolean {
    return head !== undefined && tail !== undefined;
}

function hasHeadOrTailWithRange(head: number | undefined, tail: number | undefined, hasRange: boolean): boolean {
    return (head !== undefined || tail !== undefined) && hasRange;
}

function getPositiveIntegerArg(value: unknown): number | undefined {
    if (typeof value !== 'number') {
        return undefined;
    }

    if (!Number.isInteger(value) || value < 1) {
        throw new Error('Line options must be positive integers.');
    }

    return value;
}
