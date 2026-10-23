import * as fsPromises from 'fs/promises';
import * as path from 'path';
import {
    matchesPattern,
    normalizeLineEndings,
    toPosixPath,
    walkWorkspaceFiles
} from './filesystemUtils';
import { listGitSearchFiles, sortSearchCandidatesByRelativePath, type SearchCandidateFile } from './searchCodeGitFiles';
import {
    formatSearchCodeMatch,
    isGitMetadataPath,
    type SearchMatchRange
} from './searchCodeUtils';
import type { SearchCodeOptions } from './searchCodeTypes';

const MAX_FALLBACK_FILE_SIZE_BYTES = 1024 * 1024 * 2;

/**
 * Bounded file-read concurrency. The fallback used to stat and read every file
 * serially; a 10k-file workspace meant 10k sequential round trips. Eight
 * in-flight reads keep the event loop busy without exhausting file handles.
 */
const FALLBACK_CONCURRENCY = 8;

type FallbackMatcher = (line: string) => SearchMatchRange | null;

export type SearchCodeInProcessResult = {
    matches: string[];
    limited: boolean;
};

export function createSearchCodeFallbackNotice(): string {
    return [
        'Notice: ripgrep is unavailable, so search_code is using the in-process fallback.',
        'Fallback scope: fixed-string search and JavaScript RegExp search are supported.',
        'File globs support *, ?, **, and simple comma brace alternation such as *.{js,ts}.',
        'The fallback scans files in stable path order.',
        'Files larger than ' + MAX_FALLBACK_FILE_SIZE_BYTES + ' bytes and binary-looking files are skipped.'
    ].join('\n');
}

export async function searchCodeInProcess(options: SearchCodeOptions): Promise<SearchCodeInProcessResult> {
    const matcher = createFallbackMatcher(options.query, {
        caseSensitive: options.caseSensitive,
        useRegex: options.useRegex
    });
    const candidates = await collectFallbackCandidates(options);
    const results = await scanCandidatesWithBoundedConcurrency(candidates, options, matcher);

    // Matches are collected per file, so order the file results by relative path
    // before flattening to keep the previous "stable path order" contract.
    const ordered = [...results.entries]
        .sort(([left], [right]) => left.localeCompare(right));

    const matches: string[] = [];
    for (const [, fileMatches] of ordered) {
        for (const match of fileMatches) {
            if (matches.length >= options.maxResults) {
                return { matches, limited: true };
            }
            matches.push(match);
        }
    }

    return { matches, limited: results.limited };
}

async function collectFallbackCandidates(options: SearchCodeOptions): Promise<SearchCandidateFile[]> {
    const gitFiles = await listGitSearchFiles(options.searchRoot);
    if (gitFiles) {
        return sortSearchCandidatesByRelativePath(
            gitFiles.filter(candidate => !shouldSkipFallbackCandidate(candidate, options))
        );
    }

    const candidates: SearchCandidateFile[] = [];
    await walkWorkspaceFiles(options.searchRoot, (filePath, relativeToSearchRoot) => {
        candidates.push({ filePath, relativeToSearchRoot });
        return Promise.resolve(false);
    }, {
        includePattern: options.includePattern
    });

    return sortSearchCandidatesByRelativePath(candidates);
}

/**
 * Reads candidates with a bounded worker pool.
 *
 * Once any file fills the remaining result budget the pool stops pulling new
 * work, so a huge workspace cannot keep reading after the answer is known. The
 * per-file matches are kept separately because concurrent workers cannot append
 * to one shared ordered array without interleaving file lines.
 */
async function scanCandidatesWithBoundedConcurrency(
    candidates: SearchCandidateFile[],
    options: SearchCodeOptions,
    matcher: FallbackMatcher
): Promise<{ entries: Map<string, string[]>; limited: boolean }> {
    const results = new Map<string, string[]>();
    let matchedCount = 0;
    let stopped = false;
    let cursor = 0;

    const worker = async (): Promise<void> => {
        while (!stopped) {
            const index = cursor;
            cursor += 1;
            if (index >= candidates.length) {
                return;
            }

            const remaining = options.maxResults - matchedCount;
            if (remaining <= 0) {
                stopped = true;
                return;
            }

            const fileMatches = await collectFileMatches(candidates[index], options, matcher, remaining);
            if (fileMatches.length === 0) {
                continue;
            }

            results.set(candidates[index].relativeToSearchRoot, fileMatches);
            matchedCount += fileMatches.length;
        }
    };

    const workerCount = Math.min(FALLBACK_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: workerCount }, worker));

    return {
        entries: results,
        limited: matchedCount >= options.maxResults
    };
}

async function collectFileMatches(
    candidate: SearchCandidateFile,
    options: SearchCodeOptions,
    matcher: FallbackMatcher,
    remaining: number
): Promise<string[]> {
    const { filePath, relativeToSearchRoot } = candidate;
    const relativePath = toPosixPath(path.relative(options.workspaceRoot, filePath));
    if (isGitMetadataPath(relativePath)) {
        return [];
    }
    if (!matchesFallbackInclude(filePath, relativeToSearchRoot, options.includePattern)) {
        return [];
    }

    const stats = await fsPromises.stat(filePath).catch(() => null);
    if (!stats?.isFile() || stats.size > MAX_FALLBACK_FILE_SIZE_BYTES) {
        return [];
    }

    const rawContent = await fsPromises.readFile(filePath, 'utf8').catch(() => null);
    if (rawContent == null || rawContent.includes('\0')) {
        return [];
    }

    const matches: string[] = [];
    const lines = normalizeLineEndings(rawContent).split('\n');
    for (let index = 0; index < lines.length; index++) {
        const matchRange = matcher(lines[index]);
        if (!matchRange) {
            continue;
        }

        matches.push(formatSearchCodeMatch(relativePath, index + 1, lines[index], options, matchRange));
        if (matches.length >= remaining) {
            break;
        }
    }

    return matches;
}

function matchesFallbackInclude(
    filePath: string,
    relativeToSearchRoot: string,
    includePattern: string | undefined
): boolean {
    return !includePattern ||
        matchesPattern(relativeToSearchRoot, includePattern) ||
        matchesPattern(path.basename(filePath), includePattern);
}

function shouldSkipFallbackCandidate(
    candidate: SearchCandidateFile,
    options: SearchCodeOptions
): boolean {
    if (isGitMetadataPath(candidate.relativeToSearchRoot)) {
        return true;
    }

    return Boolean(
        options.includePattern &&
        !matchesPattern(candidate.relativeToSearchRoot, options.includePattern) &&
        !matchesPattern(path.basename(candidate.filePath), options.includePattern)
    );
}

function createFallbackMatcher(query: string, options: { caseSensitive: boolean; useRegex: boolean }): FallbackMatcher {
    if (options.useRegex) {
        const flags = options.caseSensitive ? '' : 'i';
        const regex = new RegExp(query, flags);
        return line => {
            const match = regex.exec(line);
            return match ? { start: match.index, end: match.index + match[0].length } : null;
        };
    }

    const needle = options.caseSensitive ? query : query.toLowerCase();
    return line => {
        const haystack = options.caseSensitive ? line : line.toLowerCase();
        const start = haystack.indexOf(needle);
        return start >= 0 ? { start, end: start + needle.length } : null;
    };
}
