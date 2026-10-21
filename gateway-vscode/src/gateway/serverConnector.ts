import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { ToolDefinition } from '../tools';
import { getRemoteToolPublicName } from './remoteTools';
import type {
    ConnectedClient,
    GatewayErrorLogger,
    GatewayLogger,
    RemoteToolRoute,
    ServerConfig
} from './types';

/**
 * Default per-request deadline for tools/call. The MCP SDK falls back to its
 * own DEFAULT_REQUEST_TIMEOUT_MSEC (60000 ms) whenever a request carries no
 * timeout, so 60000 preserves the behavior that existed before servers could
 * configure this. Connect and listTools keep the SDK default on purpose: this
 * setting is about tool execution, not server startup.
 */
export const DEFAULT_MCP_TOOL_TIMEOUT_MS = 60_000;

/**
 * Resolves the per-server tool deadline. Invalid values fall back to the SDK
 * default instead of failing the server connection.
 */
export function resolveServerToolTimeoutMs(config: Pick<ServerConfig, 'toolTimeoutMs'>): number {
    const configured = config.toolTimeoutMs;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
        return DEFAULT_MCP_TOOL_TIMEOUT_MS;
    }

    const truncated = Math.trunc(configured);
    return truncated > 0 ? truncated : DEFAULT_MCP_TOOL_TIMEOUT_MS;
}

type ConnectToConfiguredServersOptions = {
    connectedClients: ConnectedClient[];
    extensionPath: string;
    /** Version reported to MCP servers in the client handshake. */
    clientVersion: string;
    log: GatewayLogger;
    error: GatewayErrorLogger;
    servers: Record<string, ServerConfig>;
    toolRouter: Map<string, RemoteToolRoute>;
    workspaceRoot: string | null;
};

function closeConnectedClients(clients: ConnectedClient[]): void {
    clients.forEach(c => {
        try {
            void c.client.close();
        } catch { }
    });
}

function createGatewayClient(version: string): Client {
    return new Client({ name: "gateway-vscode", version }, { capabilities: {} });
}

function replaceExtensionPath(value: string, extensionPath: string): string {
    return value.replace(/\$\{extensionPath\}/g, extensionPath);
}

function normalizeCommandForPlatform(command: string): string {
    if (process.platform === 'win32') {
        if (command === 'npx' || command === 'npm') {return `${command}.cmd`;}
    }
    return command;
}

function resolveWorkspaceArgs(args: string[], workspaceRoot: string | null): string[] {
    if (!workspaceRoot) {
        return args;
    }

    return args.map(arg => {
        if (arg === '.' || arg === '${workspaceFolder}') {return workspaceRoot;}
        return arg;
    });
}

export async function connectToConfiguredServers(options: ConnectToConfiguredServersOptions): Promise<ConnectedClient[]> {
    const {
        connectedClients,
        extensionPath,
        clientVersion,
        log,
        error,
        servers,
        toolRouter,
        workspaceRoot
    } = options;

    closeConnectedClients(connectedClients);
    toolRouter.clear();

    const nextConnectedClients: ConnectedClient[] = [];

    log('🔌 Connecting to MCP servers...');

    for (const [serverId, config] of Object.entries(servers)) {
        if (config.disabled === true) {
            log(`   -> Skipping [${serverId}] (Disabled)`);
            continue;
        }

        try {
            let client: Client;

            if (config.type === 'http') {
                if (!config.url) {throw new Error("Missing 'url' for HTTP config");}
                log(`   -> Connecting [${serverId}] via HTTP (Standard): ${config.url}`);

                const transport = new StreamableHTTPClientTransport(new URL(config.url), {
                    requestInit: { headers: config.headers },
                });
                client = createGatewayClient(clientVersion);
                await client.connect(transport);

            } else if (config.type === 'sse') {
                if (!config.url) {throw new Error("Missing 'url' for SSE config");}
                log(`   -> Connecting [${serverId}] via SSE (Legacy): ${config.url}`);

                const transportOptions = {
                    requestInit: { headers: config.headers },
                    eventSourceInit: { headers: config.headers },
                } as unknown as ConstructorParameters<typeof SSEClientTransport>[1];
                const transport = new SSEClientTransport(new URL(config.url), transportOptions);
                client = createGatewayClient(clientVersion);
                await client.connect(transport);

            } else {
                let command = replaceExtensionPath(config.command ?? "", extensionPath);
                let args = (config.args ?? []).map(arg => replaceExtensionPath(arg, extensionPath));
                const env = { ...process.env, ...config.env } as Record<string, string>;

                command = normalizeCommandForPlatform(command);
                args = resolveWorkspaceArgs(args, workspaceRoot);

                log(`   -> Starting [${serverId}]: ${command} ${args.join(' ')}`);
                const transport = new StdioClientTransport({ command, args, env });
                client = createGatewayClient(clientVersion);
                await client.connect(transport);
            }

            nextConnectedClients.push({ id: serverId, client });

            const list = await client.listTools();
            log(`   ✅ [${serverId}] Connected. Loaded ${list.tools.length} tools.`);

            const toolTimeoutMs = resolveServerToolTimeoutMs(config);
            list.tools.forEach((tool) => {
                const toolName = tool.name;
                const publicName = getRemoteToolPublicName(serverId, toolName);
                if (toolRouter.has(publicName)) {
                    log(`   ⚠️ Warning: Tool '${publicName}' overridden by ${serverId}.`);
                }
                toolRouter.set(publicName, {
                    client,
                    definition: { ...tool, name: publicName } as ToolDefinition,
                    serverId,
                    toolName,
                    toolTimeoutMs
                });
            });

        } catch (err) {
            error(`Failed to connect to [${serverId}]`, err);
        }
    }

    return nextConnectedClients;
}
