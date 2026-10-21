import type { LocalTool, ToolDefinition, ToolDefinitionContext } from '../tools';
import { generateGroupedTools } from './toolGroups';
import type { RemoteToolRoute } from './types';

/**
 * Tool-definition lookup shared by the MCP tool list and the tool call routes.
 * Pure functions over the router/local maps so GatewayManager stays a thin
 * holder and the 400-line budget keeps room for lifecycle logic.
 */
export type ToolDefinitionSources = {
    context: ToolDefinitionContext;
    localTools: Map<string, LocalTool>;
    toolRouter: Map<string, RemoteToolRoute>;
};

function resolveLocalDefinition(sources: ToolDefinitionSources, tool: LocalTool): ToolDefinition {
    return tool.getDefinition?.(sources.context) ?? tool.definition;
}

export function findToolDefinition(sources: ToolDefinitionSources, name: string): ToolDefinition | null {
    const localTool = sources.localTools.get(name);
    if (localTool) {
        return resolveLocalDefinition(sources, localTool);
    }

    return sources.toolRouter.get(name)?.definition ?? null;
}

export function listToolDefinitions(sources: ToolDefinitionSources): ReturnType<typeof generateGroupedTools> {
    return generateGroupedTools(
        sources.toolRouter,
        sources.localTools,
        tool => resolveLocalDefinition(sources, tool)
    );
}
