import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

/**
 * The Git slice of the project context block.
 *
 * Split out of the tool module for size, but also because "is this a repo, on
 * which branch, and what landed recently" is a reusable read. Everything here
 * degrades to "not a repository" instead of throwing: a workspace without git
 * (or one where the binary is missing) is an ordinary state, not a failure.
 */

export type GitCommit = {
    date: string;
    hash: string;
    subject: string;
};

export type GitSummary = {
    branchName?: string;
    isGitRepository: boolean;
    recentCommits: GitCommit[];
};

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2000;
const GIT_LOG_COMMIT_LIMIT = 5;

export async function readGitSummary(workspaceRoot: string): Promise<GitSummary> {
    if (!await resolveGitRepositoryStatus(workspaceRoot)) {
        return { isGitRepository: false, recentCommits: [] };
    }

    return {
        branchName: await readCurrentGitBranch(workspaceRoot),
        isGitRepository: true,
        recentCommits: parseGitLog(await readRecentGitLog(workspaceRoot))
    };
}

async function resolveGitRepositoryStatus(workspaceRoot: string): Promise<boolean> {
    const gitCommandStatus = await readGitRepositoryStatus(workspaceRoot);
    return gitCommandStatus ?? await hasGitMetadata(workspaceRoot);
}

async function readGitRepositoryStatus(workspaceRoot: string): Promise<boolean | null> {
    try {
        const output = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree']);
        return output.trim() === 'true';
    } catch {
        return null;
    }
}

async function readRecentGitLog(workspaceRoot: string): Promise<string> {
    try {
        return await runGit(workspaceRoot, [
            'log',
            `-${GIT_LOG_COMMIT_LIMIT}`,
            '--pretty=format:%h%x09%ad%x09%s',
            '--date=short'
        ]);
    } catch {
        return '';
    }
}

async function readCurrentGitBranch(workspaceRoot: string): Promise<string | undefined> {
    const branchFromGit = await readCurrentGitBranchFromCommand(workspaceRoot);
    return branchFromGit ?? await readCurrentGitBranchFromMetadata(workspaceRoot);
}

async function readCurrentGitBranchFromCommand(workspaceRoot: string): Promise<string | undefined> {
    try {
        return normalizeGitBranchName(await runGit(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD']));
    } catch {
        return undefined;
    }
}

async function runGit(workspaceRoot: string, args: string[]): Promise<string> {
    const result = await execFileAsync('git', ['-C', workspaceRoot, ...args], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true
    });
    return String(result.stdout);
}

async function readCurrentGitBranchFromMetadata(workspaceRoot: string): Promise<string | undefined> {
    const gitPath = path.join(workspaceRoot, '.git');
    const gitDirectoryPath = await resolveGitDirectoryPath(gitPath);
    if (!gitDirectoryPath) {return undefined;}

    try {
        return parseGitBranchFromHead(await fs.readFile(path.join(gitDirectoryPath, 'HEAD'), 'utf8'));
    } catch {
        return undefined;
    }
}

async function hasGitMetadata(workspaceRoot: string): Promise<boolean> {
    try {
        const gitPath = path.join(workspaceRoot, '.git');
        const stats = await fs.stat(gitPath);
        if (stats.isFile()) {
            return await isGitFilePointer(gitPath);
        }
        return stats.isDirectory() ? await isGitDirectory(gitPath) : false;
    } catch {
        return false;
    }
}

/**
 * Worktrees and submodules keep `.git` as a file pointing elsewhere; the whole
 * branch fallback depends on following that pointer rather than giving up.
 */
async function resolveGitDirectoryPath(gitPath: string): Promise<string | null> {
    try {
        const stats = await fs.stat(gitPath);
        if (stats.isDirectory()) {return gitPath;}
        if (!stats.isFile()) {return null;}

        const gitDirectoryPath = parseGitDirectoryPointer(await fs.readFile(gitPath, 'utf8'));
        return gitDirectoryPath ? path.resolve(path.dirname(gitPath), gitDirectoryPath) : null;
    } catch {
        return null;
    }
}

async function isGitDirectory(gitPath: string): Promise<boolean> {
    try {
        const head = await fs.readFile(path.join(gitPath, 'HEAD'), 'utf8');
        return head.trim().length > 0;
    } catch {
        return false;
    }
}

async function isGitFilePointer(gitPath: string): Promise<boolean> {
    try {
        const content = await fs.readFile(gitPath, 'utf8');
        return parseGitDirectoryPointer(content) !== null;
    } catch {
        return false;
    }
}

function parseGitLog(output: string): GitCommit[] {
    return output
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(parseGitLogLine)
        .filter(commit => commit.hash.length > 0);
}

function parseGitLogLine(line: string): GitCommit {
    const [hash = '', date = '', ...subjectParts] = line.split('\t');
    return {
        hash,
        date,
        subject: subjectParts.join('\t') || '(no subject)'
    };
}

function normalizeGitBranchName(output: string): string | undefined {
    const branchName = output.trim();
    return branchName && branchName !== 'HEAD' ? branchName : undefined;
}

function parseGitBranchFromHead(content: string): string | undefined {
    const match = content.trim().match(/^ref:\s+refs\/heads\/(.+)$/);
    return match?.[1];
}

function parseGitDirectoryPointer(content: string): string | null {
    const match = content.trim().match(/^gitdir:\s*(\S.*)$/i);
    return match?.[1].trim() ?? null;
}
