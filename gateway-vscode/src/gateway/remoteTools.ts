export function getRemoteToolPublicName(serverId: string, toolName: string): string {
    return `${serverId}:${toolName}`;
}

/**
 * Legacy allowlist of tool names whose path arguments are rewritten into the
 * workspace. Kept as a fallback so a server that exposes no schema hints still
 * gets the same protection it had before `pathArguments` existed.
 */
const LOCAL_PATH_TOOL_NAMES = new Set([
    'attach_file',
    'read_file',
    'read_text_file',
    'read_multiple_files',
    'write_file',
    'edit_file',
    'append_file',
    'list_directory',
    'list_directory_with_sizes',
    'directory_tree',
    'move_file',
    'search_files',
    'get_file_info',
    'create_directory'
]);

/**
 * Property names that hold a workspace path on the legacy allowlist.
 * `paths` is the only array-valued one.
 */
const LEGACY_PATH_PROPERTY_NAMES = ['path', 'cwd', 'repo_path', 'source', 'destination'] as const;
const LEGACY_PATH_ARRAY_PROPERTY_NAME = 'paths';

/**
 * Schema marker a third-party tool can use to declare a workspace-relative
 * path argument. Declaring it is enough; the gateway no longer needs the tool
 * name to appear in a hard-coded list.
 */
export const WORKSPACE_PATH_SCHEMA_FORMAT = 'workspace-relative-path';

export function isLocalPathToolName(toolName: string): boolean {
    return LOCAL_PATH_TOOL_NAMES.has(toolName) || toolName.startsWith('git_');
}

/**
 * Resolves which argument names hold workspace-relative paths.
 *
 * Declared schema formats win. When the schema declares nothing, a tool on the
 * legacy allowlist keeps its historic property-name list, so adding a new
 * third-party tool no longer requires editing gateway code: it only has to
 * annotate its schema with `format: "workspace-relative-path"`.
 */
export function derivePathArgumentNames(
    toolName: string,
    inputSchema: unknown
): string[] {
    const declared = readDeclaredPathArguments(inputSchema);
    if (declared.length > 0) {
        return declared;
    }

    if (!isLocalPathToolName(toolName)) {
        return [];
    }

    return [...LEGACY_PATH_PROPERTY_NAMES, LEGACY_PATH_ARRAY_PROPERTY_NAME];
}

function readDeclaredPathArguments(inputSchema: unknown): string[] {
    if (typeof inputSchema !== 'object' || inputSchema === null) {
        return [];
    }

    const properties = (inputSchema as { properties?: unknown }).properties;
    if (typeof properties !== 'object' || properties === null) {
        return [];
    }

    const names: string[] = [];
    for (const [name, schema] of Object.entries(properties as Record<string, unknown>)) {
        if (hasWorkspacePathFormat(schema)) {
            names.push(name);
        }
    }
    return names;
}

function hasWorkspacePathFormat(schema: unknown): boolean {
    if (typeof schema !== 'object' || schema === null) {
        return false;
    }

    const record = schema as { format?: unknown; items?: unknown };
    if (record.format === WORKSPACE_PATH_SCHEMA_FORMAT) {
        return true;
    }

    // Array-valued path arguments declare the format on `items`.
    return typeof record.items === 'object'
        && record.items !== null
        && (record.items as { format?: unknown }).format === WORKSPACE_PATH_SCHEMA_FORMAT;
}
