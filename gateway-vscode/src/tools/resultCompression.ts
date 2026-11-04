// Tool-result compression: pure functions plus a constants area, no vscode
// imports. Every string this module emits reaches the AI platform as part of
// tool-result text, so all markers and summary wording stay identity-free
// (no product name, ASCII-first so the marker survives any encoding).

// ---- 常量区 ----

export const COMPRESSION_MODES = ['off', 'trim', 'smart'] as const;
export type CompressionMode = (typeof COMPRESSION_MODES)[number];

export type CompressionPolicy = {
    mode: CompressionMode;
    maxResultChars: number;
};

/** Settings default: smart earns its keep; trim alone saves too little. */
export const DEFAULT_COMPRESSION_MODE: CompressionMode = 'smart';
/** Settings default for webcodeGateway.compression.maxResultChars. */
export const DEFAULT_MAX_RESULT_CHARS = 12_000;
/** Below this a summary head+tail would barely beat the omitted count. */
export const MIN_MAX_RESULT_CHARS = 1_000;
export const MAX_MAX_RESULT_CHARS = 512 * 1024;

/** A run shorter than this stays as-is; two repeats are often meaningful. */
export const DUPLICATE_RUN_MIN_LINE_COUNT = 3;

/** Lines kept at the edges of a folded run (first and last identical line). */
export const FOLD_KEPT_EDGE_LINE_COUNT = 2;
export const SUMMARY_HEAD_LINE_COUNT = 50;
export const SUMMARY_TAIL_LINE_COUNT = 20;

export const RULE_WHITESPACE_TRIM = 'whitespace-trim';
export const RULE_DUPLICATE_RUN_FOLD = 'duplicate-run-fold';
export const RULE_BUILD_NOISE_STRIP = 'build-noise-strip';
export const RULE_HEAD_TAIL_SUMMARY = 'head-tail-summary';

const buildFoldMarker = (foldedLineCount: number): string =>
    `[folded ${foldedLineCount} identical lines]`;

const buildSummaryMarker = (omittedLineCount: number, totalLineCount: number): string =>
    `[${omittedLineCount} lines omitted; showing first ${SUMMARY_HEAD_LINE_COUNT} and last ` +
    `${SUMMARY_TAIL_LINE_COUNT} of ${totalLineCount} lines. Re-request with narrower arguments ` +
    'or read specific line ranges to retrieve omitted content.]';

// Build-noise detection. Overwrite-mode progress bars arrive as lines whose
// first character is a carriage return; percentage lines are either pure
// progress furniture (digits, percent, spinner/bar glyphs) or a leading
// percentage followed by a lowercase progress caption (webpack-style
// "92% sealing").
const PROGRESS_PERCENT_TOKEN_PATTERN = /\d+(?:\.\d+)?%/g;
const PROGRESS_FURNITURE_PATTERN = /^[\s|/\\\-=_.()[\]:#*+~0-9\u2580-\u259f\u2800-\u28ff]+$/;
const PROGRESS_CAPTION_PATTERN = /^[\s|/\\\-=]*\d+(?:\.\d+)?%\s+[a-z][a-z0-9 ._-]*$/;

// Fold whitelist: lines carrying paths, digests, error codes, or source
// positions are semantically load-bearing and are never folded. Stack frames
// often repeat dozens of times, but each frame is a distinct location — the
// whitelist treats them as protected too.
const PATH_TOKEN_PATTERN = /[\/\\]/;
const HASH_TOKEN_PATTERN = /\b[0-9a-f]{8,64}\b/i;
const ERROR_LIKE_TOKEN_PATTERN =
    /\b(?:ERR_[A-Z0-9_]+|E\d{2,5}|exit\s+code\s*\d+|errno\s*[=-]?\s*\d+|0x[0-9a-f]{4,}|error|exception|traceback)\b/i;
const STACK_FRAME_PATTERN = /^\s*(?:at\s+[\w$.<>]+|Caused by:)/;
const SOURCE_POSITION_PATTERN = /[([][^\s()[\]]+:\d+(?::\d+)?[\])]/;

export type CompressionOutcome = {
    text: string;
    appliedRules: string[];
    inputChars: number;
    outputChars: number;
};

export function resolveCompressionMode(value: unknown): CompressionMode {
    return (COMPRESSION_MODES as readonly string[]).includes(value as string)
        ? value as CompressionMode
        : DEFAULT_COMPRESSION_MODE;
}

/**
 * Non-numeric, NaN, or Infinity falls back to the default; in-range numbers
 * are floored, out-of-range numbers are clamped into [MIN, MAX].
 */
export function resolveMaxResultChars(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_MAX_RESULT_CHARS;
    }
    return Math.min(MAX_MAX_RESULT_CHARS, Math.max(MIN_MAX_RESULT_CHARS, Math.floor(value)));
}

/**
 * Returns a per-text compressor for the policy, or null when the policy is
 * `off` so callers can skip compression entirely (identity, never invoked).
 */
export function createResultCompressor(policy: CompressionPolicy): ((text: string) => CompressionOutcome) | null {
    if (policy.mode === 'off') {
        return null;
    }
    return text => compressToolResultText(text, policy);
}

export function compressToolResultText(text: string, policy: CompressionPolicy): CompressionOutcome {
    const inputChars = text.length;
    const appliedRules: string[] = [];
    if (policy.mode === 'off') {
        return { text, appliedRules, inputChars, outputChars: inputChars };
    }

    let current = normalizeTrailingWhitespace(text);
    if (current !== text) {
        appliedRules.push(RULE_WHITESPACE_TRIM);
    }

    if (policy.mode === 'smart') {
        const stripped = stripBuildNoiseLines(current);
        if (stripped !== current) {
            appliedRules.push(RULE_BUILD_NOISE_STRIP);
        }
        current = stripped;

        const folded = foldDuplicateRuns(current);
        if (folded !== current) {
            appliedRules.push(RULE_DUPLICATE_RUN_FOLD);
        }
        current = folded;

        if (current.length > policy.maxResultChars) {
            current = summarizeHeadTail(current, policy.maxResultChars);
            appliedRules.push(RULE_HEAD_TAIL_SUMMARY);
        }
    }

    return { text: current, appliedRules, inputChars, outputChars: current.length };
}

function normalizeTrailingWhitespace(text: string): string {
    return text
        .split('\n')
        .map(line => line.replace(/[ \t]+$/, ''))
        .join('\n');
}

function stripBuildNoiseLines(text: string): string {
    const lines = text.split('\n');
    const kept = lines.filter(line => !isBuildNoiseLine(line));
    return kept.length === lines.length ? text : kept.join('\n');
}

function isBuildNoiseLine(line: string): boolean {
    if (line.startsWith('\r')) {
        return true;
    }
    if (!line.includes('%')) {
        return false;
    }
    const withoutPercents = line.replace(PROGRESS_PERCENT_TOKEN_PATTERN, '').trim();
    return withoutPercents === ''
        || PROGRESS_FURNITURE_PATTERN.test(withoutPercents)
        || PROGRESS_CAPTION_PATTERN.test(line);
}

function foldDuplicateRuns(text: string): string {
    const lines = text.split('\n');
    const output: string[] = [];
    let index = 0;
    let changed = false;

    while (index < lines.length) {
        let runEnd = index + 1;
        while (runEnd < lines.length && lines[runEnd] === lines[index]) {
            runEnd += 1;
        }
        const runLength = runEnd - index;
        const line = lines[index];
        if (runLength >= DUPLICATE_RUN_MIN_LINE_COUNT && line.trim() !== '' && !isProtectedLine(line)) {
            output.push(line, buildFoldMarker(runLength - FOLD_KEPT_EDGE_LINE_COUNT), line);
            changed = true;
        } else {
            for (let i = index; i < runEnd; i += 1) {
                output.push(lines[i]);
            }
        }
        index = runEnd;
    }

    return changed ? output.join('\n') : text;
}

function isProtectedLine(line: string): boolean {
    return PATH_TOKEN_PATTERN.test(line)
        || HASH_TOKEN_PATTERN.test(line)
        || ERROR_LIKE_TOKEN_PATTERN.test(line)
        || STACK_FRAME_PATTERN.test(line)
        || SOURCE_POSITION_PATTERN.test(line);
}

function summarizeHeadTail(text: string, maxResultChars: number): string {
    const lines = text.split('\n');
    if (lines.length <= SUMMARY_HEAD_LINE_COUNT + SUMMARY_TAIL_LINE_COUNT) {
        return text;
    }

    const head = lines.slice(0, SUMMARY_HEAD_LINE_COUNT);
    const tail = lines.slice(lines.length - SUMMARY_TAIL_LINE_COUNT);
    const omittedLineCount = lines.length - head.length - tail.length;
    const summary = [
        ...head,
        buildSummaryMarker(omittedLineCount, lines.length),
        ...tail
    ].join('\n');
    return summary.length <= maxResultChars ? summary : summary.slice(0, maxResultChars);
}
