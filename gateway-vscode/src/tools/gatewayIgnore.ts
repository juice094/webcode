import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Which entries belong in the project skeleton.
 *
 * The tree used to be "everything, then fewer" — the whole workspace expanded
 * breadth-first to depth 2. Volume-wise that let caches and archives dominate
 * the block, and attention-wise it buried the two facts the model actually
 * needs (what kind of project this is, where the source lives). The rule set
 * below inverts that: a small set of shapes is collapsed by default, and one
 * user-owned file can override any of it.
 */

/**
 * What the skeleton does with one directory entry.
 *
 * `generated` is the "obviously not source" bucket (VCS, dependencies, build
 * output, caches, hidden runtime state); `archived` is the "kept on disk on
 * purpose, still not project shape" bucket (archive/, tmp/, logs/, lock files).
 * Both collapse to a single summary line, but they read differently to the
 * model, so they stay apart.
 */
export type EntryDisposition = 'list' | 'generated' | 'archived';

export type GatewayIgnoreRule = {
    anchored: boolean;
    directoryOnly: boolean;
    negated: boolean;
    pattern: RegExp;
};

/**
 * Escape hatch read from the workspace root, same syntax as .gitignore.
 * Whatever it says outranks every rule below — the whole point of the file is
 * to let a project pull a folder back in without waiting for a code change.
 */
export const GATEWAY_IGNORE_FILE_NAME = '.gatewayignore';

/** Always collapsed: VCS, dependency, build-output and cache folders. */
const ALWAYS_EXCLUDED_DIRECTORY_NAMES = new Set([
    '__pycache__',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'out',
    'release',
    'target',
    'vendor',
    'venv'
]);

/** Hidden folders are runtime state by default; these ones carry real config. */
const HIDDEN_DIRECTORY_WHITELIST = new Set(['.github']);

const ALWAYS_EXCLUDED_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db']);

const ALWAYS_LISTED_FILE_NAMES = new Set([
    'AGENTS.md',
    'CLAUDE.md',
    'CONTRIBUTING.md',
    'Cargo.toml',
    'Makefile',
    'README.md',
    'go.mod',
    'package.json',
    'pyproject.toml',
    'requirements.txt',
    'tsconfig.json'
]);

const ALWAYS_LISTED_DIRECTORY_NAMES = new Set(['app', 'crates', 'lib', 'src']);

/** History, backups, logs and lock files: present on purpose, useless as shape. */
const ARCHIVED_ENTRY_MATCHERS = [
    'archive',
    '.archive',
    'tmp',
    '.tmp',
    'logs',
    '.logs',
    '*.bak',
    '*.before-*',
    '*.orig',
    '*.rej',
    '*.log',
    'Cargo.lock',
    'composer.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
    'poetry.lock',
    'yarn.lock'
].map(compileGlob);

/**
 * Three layers, in order: user file, always-listed whitelist, exclusions.
 *
 * The whitelist sits above the exclusion layers so that a project file the
 * rules would otherwise swallow (a `Makefile` next to a `*.log` sibling, a
 * `src/` inside a folder named `archive`) survives; the user file sits above
 * everything, because a deliberate `!pattern` has to win.
 */
export function classifyEntry(
    relativePath: string,
    isDirectory: boolean,
    gatewayIgnoreRules: readonly GatewayIgnoreRule[]
): EntryDisposition {
    const userVerdict = matchGatewayIgnore(gatewayIgnoreRules, relativePath, isDirectory);
    if (userVerdict === 'unignore') {
        return 'list';
    }
    if (userVerdict === 'ignore') {
        return 'archived';
    }

    const name = path.posix.basename(relativePath);
    if (isDirectory) {
        if (ALWAYS_LISTED_DIRECTORY_NAMES.has(name)) {
            return 'list';
        }
        if (name.startsWith('.') && !HIDDEN_DIRECTORY_WHITELIST.has(name)) {
            return 'generated';
        }
        if (ALWAYS_EXCLUDED_DIRECTORY_NAMES.has(name)) {
            return 'generated';
        }
    } else {
        if (ALWAYS_LISTED_FILE_NAMES.has(name)) {
            return 'list';
        }
        if (ALWAYS_EXCLUDED_FILE_NAMES.has(name)) {
            return 'generated';
        }
    }

    if (ARCHIVED_ENTRY_MATCHERS.some((pattern) => pattern.test(name))) {
        return 'archived';
    }
    return 'list';
}

export async function readGatewayIgnoreRules(workspaceRoot: string): Promise<GatewayIgnoreRule[]> {
    try {
        const content = await fs.readFile(path.join(workspaceRoot, GATEWAY_IGNORE_FILE_NAME), 'utf8');
        return parseGatewayIgnore(content);
    } catch {
        return [];
    }
}

/**
 * Parse .gitignore-shaped lines into matchers.
 *
 * Supported on purpose: blank lines, `#` comments, `!` negation, trailing `/`
 * for directories, a leading `/` for root anchoring, and `*` / `?` / `**`
 * wildcards. Not supported: character classes, escaped wildcards, `\#` — a
 * project that needs those is already outside what one line of skeleton text
 * can describe, and silently mis-reading them would be worse than ignoring.
 */
export function parseGatewayIgnore(content: string): GatewayIgnoreRule[] {
    const rules: GatewayIgnoreRule[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
        let line = rawLine.trim();
        if (line === '' || line.startsWith('#')) {
            continue;
        }
        const negated = line.startsWith('!');
        if (negated) {
            line = line.slice(1);
        }
        const directoryOnly = line.endsWith('/');
        line = line.replace(/\/+$/, '');
        let anchored = line.startsWith('/');
        line = line.replace(/^\/+/, '');
        if (line === '') {
            continue;
        }
        if (line.includes('/')) {
            anchored = true;
        }
        rules.push({ anchored, directoryOnly, negated, pattern: compileGlob(line) });
    }
    return rules;
}

/**
 * Last match wins, and a directory is matched against its own ancestors too —
 * `archive/` has to cover `archive/2020/notes.md`, exactly like .gitignore.
 */
function matchGatewayIgnore(
    rules: readonly GatewayIgnoreRule[],
    relativePath: string,
    isDirectory: boolean
): 'ignore' | 'unignore' | null {
    if (rules.length === 0) {
        return null;
    }
    const segments = relativePath.split('/');
    let verdict: 'ignore' | 'unignore' | null = null;
    for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidatePath = segments.slice(0, depth).join('/');
        const candidateIsDirectory = depth < segments.length ? true : isDirectory;
        const candidateName = segments[depth - 1];
        for (const rule of rules) {
            if (rule.directoryOnly && !candidateIsDirectory) {
                continue;
            }
            const subject = rule.anchored ? candidatePath : candidateName;
            if (rule.pattern.test(subject)) {
                verdict = rule.negated ? 'unignore' : 'ignore';
            }
        }
    }
    return verdict;
}

function compileGlob(pattern: string): RegExp {
    let source = '';
    let index = 0;
    while (index < pattern.length) {
        const character = pattern[index];
        if (character === '*') {
            if (pattern[index + 1] === '*') {
                if (pattern[index + 2] === '/') {
                    source += '(?:[^/]+/)*';
                    index += 3;
                    continue;
                }
                source += '.*';
                index += 2;
                continue;
            }
            source += '[^/]*';
            index += 1;
            continue;
        }
        if (character === '?') {
            source += '[^/]';
            index += 1;
            continue;
        }
        source += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        index += 1;
    }
    return new RegExp(`^${source}$`);
}
