import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import type { ResolvedAiSiteConfig } from '../platforms';
import type { ToolDefinition } from '../tools';

export interface ServerConfig {
    type?: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    disabled?: boolean;
    /**
     * Per-request deadline in milliseconds for tools/call on this server. The
     * MCP SDK applies its own DEFAULT_REQUEST_TIMEOUT_MSEC (60000 ms) when a
     * request carries no timeout, so 60000 keeps the existing behavior while
     * allowing long-running servers to opt out of that implicit cap.
     */
    toolTimeoutMs?: number;
}

export interface GatewayConfig {
    port: number;
    idleTimeoutMs: number;
    preferredPort?: number;
    mcpServers: Record<string, ServerConfig>;
    allowedOrigins: string[];
    aiSites?: ResolvedAiSiteConfig[];
    skillDirectories?: string[];
    commandShellPath?: string;
    commandAllowedRoots?: string[];
    /** Deadline for one gateway-handled tool call in milliseconds; 0 disables it. */
    toolCallMs?: number;
    /** Default deadline for `execute_command` in milliseconds. */
    commandExecutionMs?: number;
    /** Lifetime of a single-use bridge code in milliseconds. */
    bridgeCodeTtlMs?: number;
    /** Lifetime of a command approval challenge and grant in milliseconds. */
    approvalTtlMs?: number;
    /** Browser-side request deadline in milliseconds; 0 disables it. */
    bridgeRequestMs?: number;
    /** How long a launch waits for the isolated browser bridge process. */
    browserLaunchWaitMs?: number;
}

export interface StartResult {
    port: number;
}

export type ConnectedClient = {
    id: string;
    client: Client;
};

export type RemoteToolRoute = {
    client: Client;
    definition: ToolDefinition;
    serverId: string;
    toolName: string;
    /** Deadline passed to tools/call; undefined keeps the MCP SDK default. */
    toolTimeoutMs?: number;
};

export type GatewayLogger = (message: string) => void;
export type GatewayErrorLogger = (message: string, err?: unknown) => void;
