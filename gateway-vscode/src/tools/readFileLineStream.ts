import * as fs from 'fs/promises';
import { StringDecoder } from 'string_decoder';

import { getAbortReasonText } from './abortUtils';

const STREAM_READ_CHUNK_BYTES = 64 * 1024;

export type LineSelectionOptions = {
    head?: number;
    tail?: number;
    startLine?: number;
    endLine?: number;
};

export type SelectedFileLines = {
    lines: string[];
    startLine: number;
    lineCount?: number;
};

type StreamLinesResult = {
    completed: boolean;
    lineCount: number;
};

export async function readSelectedFileLines(
    filePath: string,
    options: LineSelectionOptions,
    signal?: AbortSignal
): Promise<SelectedFileLines> {
    return options.tail !== undefined
        ? readTailFileLines(filePath, options.tail, signal)
        : readForwardSelectedFileLines(filePath, options, signal);
}

async function readForwardSelectedFileLines(
    filePath: string,
    options: LineSelectionOptions,
    signal?: AbortSignal
): Promise<SelectedFileLines> {
    const startLine = options.head !== undefined ? 1 : options.startLine ?? 1;
    const stopAfterLine = options.head ?? options.endLine;
    const streamResult = await streamForwardSelectedLines(filePath, startLine, stopAfterLine, signal);

    return {
        lines: streamResult.lines,
        startLine,
        lineCount: streamResult.completed ? streamResult.lineCount : undefined
    };
}

async function streamForwardSelectedLines(
    filePath: string,
    startLine: number,
    stopAfterLine: number | undefined,
    signal?: AbortSignal
): Promise<StreamLinesResult & { lines: string[] }> {
    const handle = await fs.open(filePath, 'r');
    try {
        const decoder = new StringDecoder('utf8');
        const buffer = Buffer.alloc(STREAM_READ_CHUNK_BYTES);
        const selectedLines: string[] = [];
        let currentLine = '';
        let currentLineNumber = 1;
        let completed = true;
        let sawBytes = false;

        const shouldCaptureCurrentLine = (): boolean => currentLineNumber >= startLine &&
            (stopAfterLine === undefined || currentLineNumber <= stopAfterLine);
        const appendSegment = (segment: string): void => {
            if (shouldCaptureCurrentLine()) {
                currentLine += segment;
            }
        };
        const finishLine = (endedByNewline: boolean): boolean => {
            const finishedLineNumber = currentLineNumber;
            if (shouldCaptureCurrentLine()) {
                selectedLines.push(endedByNewline && currentLine.endsWith('\r') ? currentLine.slice(0, -1) : currentLine);
            }
            currentLine = '';
            currentLineNumber += 1;
            return stopAfterLine !== undefined && finishedLineNumber >= stopAfterLine;
        };
        const processText = (text: string): boolean => {
            let segmentStart = 0;
            let newlineIndex = text.indexOf('\n', segmentStart);

            while (newlineIndex !== -1) {
                appendSegment(text.slice(segmentStart, newlineIndex));
                if (finishLine(true)) {
                    return true;
                }
                segmentStart = newlineIndex + 1;
                newlineIndex = text.indexOf('\n', segmentStart);
            }

            appendSegment(text.slice(segmentStart));
            return false;
        };

        while (true) {
            throwIfAborted(signal);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            sawBytes = true;
            if (processText(decoder.write(buffer.subarray(0, bytesRead)))) {
                completed = false;
                break;
            }
        }

        if (completed) {
            const remainingText = decoder.end();
            if (remainingText && processText(remainingText)) {
                completed = false;
            }
        }

        if (completed && sawBytes) {
            finishLine(false);
        }

        return {
            completed,
            lineCount: sawBytes ? currentLineNumber - 1 : 0,
            lines: selectedLines
        };
    } finally {
        await handle.close();
    }
}

/**
 * Reads the last `tail` lines.
 *
 * Uses a fixed-size ring buffer instead of `Array.shift()`. The previous
 * implementation moved the whole array on every line once the window was full,
 * which is O(lines × tail) — a `tail=2000` read of a 500k-line file moved
 * roughly a billion elements on the extension host's single thread.
 */
async function readTailFileLines(
    filePath: string,
    tail: number,
    signal?: AbortSignal
): Promise<SelectedFileLines> {
    const limit = Math.max(1, Math.floor(tail));
    const ring: string[] = new Array<string>(limit);
    let count = 0;
    let writeIndex = 0;

    const streamResult = await streamFileLines(filePath, line => {
        ring[writeIndex] = line;
        writeIndex = (writeIndex + 1) % limit;
        if (count < limit) {
            count += 1;
        }
        return false;
    }, signal);

    // The oldest entry is the next write slot once the ring wrapped; before
    // that the buffer is still filled from index 0.
    const start = count < limit ? 0 : writeIndex;
    const lines: string[] = new Array<string>(count);
    for (let index = 0; index < count; index++) {
        lines[index] = ring[(start + index) % limit];
    }

    return {
        lines,
        startLine: streamResult.lineCount - count + 1,
        lineCount: streamResult.lineCount
    };
}

async function streamFileLines(
    filePath: string,
    onLine: (line: string, lineNumber: number) => boolean,
    signal?: AbortSignal
): Promise<StreamLinesResult> {
    const handle = await fs.open(filePath, 'r');
    try {
        const decoder = new StringDecoder('utf8');
        const buffer = Buffer.alloc(STREAM_READ_CHUNK_BYTES);
        let carry = '';
        let completed = true;
        let sawBytes = false;
        let lineCount = 0;

        const processLine = (line: string, endedByNewline: boolean): boolean => {
            lineCount += 1;
            const normalizedLine = endedByNewline && line.endsWith('\r') ? line.slice(0, -1) : line;
            return onLine(normalizedLine, lineCount);
        };

        const processText = (text: string): boolean => {
            carry += text;
            let newlineIndex = carry.indexOf('\n');

            while (newlineIndex !== -1) {
                const line = carry.slice(0, newlineIndex);
                carry = carry.slice(newlineIndex + 1);
                if (processLine(line, true)) {
                    return true;
                }
                newlineIndex = carry.indexOf('\n');
            }

            return false;
        };

        while (true) {
            throwIfAborted(signal);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
                break;
            }
            sawBytes = true;
            if (processText(decoder.write(buffer.subarray(0, bytesRead)))) {
                completed = false;
                break;
            }
        }

        if (completed) {
            const remainingText = decoder.end();
            if (remainingText && processText(remainingText)) {
                completed = false;
            }
        }

        if (completed && sawBytes && processLine(carry, false)) {
            completed = false;
        }

        return { completed, lineCount };
    } finally {
        await handle.close();
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error(`read_file aborted: ${getAbortReasonText(signal)}`);
    }
}
