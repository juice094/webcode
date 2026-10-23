import * as path from 'path';

import type { RemoteToolRoute } from './types';
import { derivePathArgumentNames } from './remoteTools';

/**
 * Rewrites the path arguments a remote tool declares into absolute paths
 * inside the workspace.
 *
 * The argument names come from the tool's schema (`format:
 * "workspace-relative-path"`) or, for a tool on the legacy allowlist, from the
 * historic property-name list. Unknown tools get no rewriting, exactly as
 * before.
 */
export function resolveLocalPathArguments(
    route: RemoteToolRoute,
    args: Record<string, unknown>,
    workspaceRoot: string | null
): void {
    if (!args || !workspaceRoot) {
        return;
    }

    const pathArguments = route.pathArguments
        ?? derivePathArgumentNames(route.toolName, route.definition.inputSchema);
    if (pathArguments.length === 0) {
        return;
    }

    for (const name of pathArguments) {
        const value = args[name];
        if (typeof value === 'string') {
            args[name] = resolveInsideWorkspace(workspaceRoot, value);
            continue;
        }
        if (Array.isArray(value)) {
            const items: unknown[] = value as unknown[];
            args[name] = items.map((item): unknown => (
                typeof item === 'string' ? resolveInsideWorkspace(workspaceRoot, item) : item
            ));
        }
    }
}

export function resolveInsideWorkspace(workspaceRoot: string, inputPath: string): string {
    if (inputPath.includes('\0')) {
        throw new Error(`Path contains null bytes: ${inputPath}`);
    }

    const root = path.resolve(workspaceRoot);
    const resolved = path.resolve(root, inputPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Path escapes workspace: ${inputPath}`);
    }

    return resolved;
}
