import * as fs from 'fs/promises';
import * as path from 'path';
import { toPosixPath, type WorkspacePathOptions } from './filesystemUtils';

export type WorkspacePathResolution = {
    absolutePath: string;
    relativePath: string;
};

type WorkspaceRelativePathOptions = WorkspacePathOptions & {
    allowEmptyAsRoot?: boolean;
};

export const WORKSPACE_FILE_PATH_DESCRIPTION = [
    'Workspace-relative file path using "/" separators, for example "src/index.ts".',
    'In a multi-root workspace, prefix with the folder name to address a sibling folder directly,',
    'for example "micro-server/src/index.ts". Absolute paths, home paths, and backslashes are rejected.'
].join(' ');

export const WORKSPACE_SEARCH_PATH_DESCRIPTION =
    'Optional workspace-relative directory to search, using "/" separators. Defaults to "." (the whole multi-root workspace). Absolute paths, home paths, and backslashes are rejected.';

export const WORKSPACE_COMMAND_PATH_DESCRIPTION =
    'Optional workspace-relative command directory, interpreted by webcode before shell selection and using the same format for every terminal profile. Use "/" separators, for example "packages/app". Defaults to ".". In a multi-root workspace a sibling folder can be addressed by prefixing its folder name. Absolute paths, home paths, and backslashes are rejected.';

export type WorkspaceRootsInput = string | readonly string[] | null;

/** Workspace folders a tool call may address: every VS Code workspace folder. */
export function getContextWorkspaceRoots(context: {
    workspaceRoot: string | null;
    workspaceRoots?: readonly string[];
}): WorkspaceRootsInput {
    return context.workspaceRoots ?? context.workspaceRoot;
}

export function toWorkspaceRootList(workspaceRoots: WorkspaceRootsInput): string[] {
    if (!workspaceRoots) { return []; }
    return typeof workspaceRoots === 'string' ? [workspaceRoots] : [...workspaceRoots];
}

/** True when the caller left path at the default ("." / empty), i.e. wants the whole workspace. */
export function isDefaultSearchPath(requestedPath: unknown): boolean {
    return typeof requestedPath !== 'string' || requestedPath.trim() === '' || requestedPath.trim() === '.';
}

export async function resolveWorkspaceRelativePath(
    workspaceRoots: WorkspaceRootsInput,
    requestedPath: unknown,
    options: WorkspaceRelativePathOptions = {}
): Promise<WorkspacePathResolution> {
    const roots = normalizeWorkspaceRoots(workspaceRoots);
    const relativeInput = normalizeWorkspaceRelativePathInput(requestedPath, options);
    const { root: normalizedRoot, relativePath } = pickBaseRoot(roots, relativeInput);
    const allowedDirectories = await getAllowedWorkspaceDirectories(roots);
    const absolutePath = path.resolve(normalizedRoot, relativePath);

    if (!isAllowedPath(absolutePath, allowedDirectories)) {
        throw new Error('path must stay inside the VS Code workspace.');
    }

    return resolveExistingOrWritablePath(absolutePath, relativePath, normalizedRoot, allowedDirectories, options);
}

export async function resolveWorkspaceRelativeDirectory(
    workspaceRoots: WorkspaceRootsInput,
    requestedPath: unknown
): Promise<WorkspacePathResolution> {
    const resolved = await resolveWorkspaceRelativePath(workspaceRoots, requestedPath, { allowEmptyAsRoot: true });
    const stats = await fs.stat(resolved.absolutePath).catch(() => null);
    if (!stats) {
        throw new Error('path could not be resolved as a workspace directory.');
    }
    if (!stats.isDirectory()) {
        throw new Error(`path must point to a directory: ${resolved.relativePath}`);
    }
    return resolved;
}

function normalizeWorkspaceRoots(workspaceRoots: WorkspaceRootsInput): string[] {
    if (!workspaceRoots) {
        throw new Error('A VS Code workspace folder is required for file operations.');
    }
    const roots = (typeof workspaceRoots === 'string' ? [workspaceRoots] : [...workspaceRoots])
        .map(item => path.resolve(path.normalize(item)));
    if (roots.length === 0) {
        throw new Error('A VS Code workspace folder is required for file operations.');
    }
    return roots;
}

/**
 * Multi-root addressing: when the first path segment names another workspace
 * folder ("micro-server/src/..."), resolve inside that folder instead of the
 * primary one, so writes never create a same-named fake subdirectory and
 * reads reach the sibling project. ".." paths naturally resolve against the
 * primary folder and stay allowed as long as they land in any workspace
 * folder. When several folders share a basename the earliest wins.
 */
function pickBaseRoot(roots: string[], relativeInput: string): { root: string; relativePath: string } {
    const firstSegment = relativeInput.split('/')[0];
    if (firstSegment && firstSegment !== '.' && firstSegment !== '..') {
        const match = roots.find(root => basenameEquals(root, firstSegment));
        if (match) {
            const remainder = relativeInput.slice(firstSegment.length).replace(/^\//, '');
            return { root: match, relativePath: remainder || '.' };
        }
    }
    return { root: roots[0], relativePath: relativeInput };
}

function basenameEquals(root: string, segment: string): boolean {
    const basename = path.basename(root);
    return process.platform === 'win32'
        ? basename.toLowerCase() === segment.toLowerCase()
        : basename === segment;
}

async function resolveExistingOrWritablePath(
    absolutePath: string,
    relativeInput: string,
    normalizedRoot: string,
    allowedDirectories: string[],
    options: WorkspaceRelativePathOptions
): Promise<WorkspacePathResolution> {
    try {
        const realPath = await fs.realpath(absolutePath);
        return resolveRealWorkspacePath(realPath, normalizedRoot, allowedDirectories);
    } catch (error: unknown) {
        if (!hasErrorCode(error, 'ENOENT')) {
            throw new Error('path could not be resolved inside the VS Code workspace.');
        }
        if (!options.forWrite) {
            throw new Error('path must point to an existing workspace path.');
        }
    }

    await assertWritableParentAllowed(absolutePath, allowedDirectories, options);
    return {
        absolutePath,
        relativePath: toPosixPath(path.relative(normalizedRoot, absolutePath)) || relativeInput
    };
}

function resolveRealWorkspacePath(
    realPath: string,
    normalizedRoot: string,
    allowedDirectories: string[]
): WorkspacePathResolution {
    if (!isAllowedPath(realPath, allowedDirectories)) {
        throw new Error('path must stay inside the VS Code workspace.');
    }

    const relativeBase = allowedDirectories.find(directory => isAllowedPath(realPath, [directory])) ?? normalizedRoot;
    return {
        absolutePath: realPath,
        relativePath: toPosixPath(path.relative(relativeBase, realPath)) || '.'
    };
}

async function assertWritableParentAllowed(
    absolutePath: string,
    allowedDirectories: string[],
    options: WorkspaceRelativePathOptions
): Promise<void> {
    const parentDirectory = path.dirname(absolutePath);
    if (options.createParentDirectories) {
        await assertExistingAncestorAllowed(parentDirectory, allowedDirectories);
        await fs.mkdir(parentDirectory, { recursive: true });
    }

    const realParent = await fs.realpath(parentDirectory).catch(() => null);
    if (!realParent) {
        throw new Error('parent directory must exist inside the VS Code workspace.');
    }
    if (!isAllowedPath(realParent, allowedDirectories)) {
        throw new Error('path must stay inside the VS Code workspace.');
    }
}

async function assertExistingAncestorAllowed(directoryPath: string, allowedDirectories: string[]): Promise<void> {
    let currentPath = path.resolve(path.normalize(directoryPath));

    while (true) {
        const realPath = await fs.realpath(currentPath).catch((error: unknown) => {
            if (hasErrorCode(error, 'ENOENT')) {
                return null;
            }
            throw new Error('path could not be resolved inside the VS Code workspace.');
        });
        if (realPath) {
            if (!isAllowedPath(realPath, allowedDirectories)) {
                throw new Error('path must stay inside the VS Code workspace.');
            }
            return;
        }

        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            throw new Error('Cannot create parent directories: no existing workspace ancestor found.');
        }
        currentPath = parentPath;
    }
}

function normalizeWorkspaceRelativePathInput(
    requestedPath: unknown,
    options: WorkspaceRelativePathOptions
): string {
    if (typeof requestedPath !== 'string') {
        throw new Error('path must be a workspace-relative string.');
    }

    const trimmed = requestedPath.trim();
    const value = trimmed === '' && options.allowEmptyAsRoot ? '.' : trimmed;
    if (value === '') {
        throw new Error('path must be a non-empty workspace-relative string.');
    }
    if (value.includes('\0')) {
        throw new Error('path must not contain null bytes.');
    }
    if (value.includes('\\')) {
        throw new Error('path must use "/" separators; backslashes are not allowed.');
    }
    if (isAbsoluteOrHomePath(value)) {
        throw new Error('path must be workspace-relative; absolute paths are not allowed.');
    }

    return value;
}

function isAbsoluteOrHomePath(value: string): boolean {
    return value.startsWith('~') ||
        /^[A-Za-z]:/.test(value) ||
        path.win32.isAbsolute(value) ||
        path.posix.isAbsolute(value);
}

async function getAllowedWorkspaceDirectories(roots: readonly string[]): Promise<string[]> {
    const directories = await Promise.all(roots.map(async root => {
        const realRoot = await fs.realpath(root).catch(() => root);
        return [root, realRoot];
    }));
    return Array.from(new Set(directories.flat().map(item => path.resolve(path.normalize(item)))));
}

function isAllowedPath(absolutePath: string, allowedDirectories: string[]): boolean {
    const normalizedPath = path.resolve(path.normalize(absolutePath));
    return allowedDirectories.some(directory => (
        normalizedPath === directory ||
        normalizedPath.startsWith(directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`)
    ));
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === code;
}
