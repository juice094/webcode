import type { SkillSummary } from '../skillManager';
import type { LocalTool, ToolDefinition } from './types';
import { textResult } from './result';

type ToolGroup = {
    server: string;
    tools: ToolDefinition[];
};

const DISCOVERY_TOOLS_NOTE =
    'Call `list_tools` for a tool\'s full inputSchema, or to refresh this list after MCP servers change. ' +
    'Call `list_skills` to refresh the skill list. Both are on-demand queries, not a required pre-task step.';

export const getCapabilitySnapshotTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'get_capability_snapshot',
        description: 'Render the compact capability snapshot (available tools with call signatures and available skills) that the bridge embeds into the initialization payload.',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        annotations: { readOnlyHint: true }
    },
    async execute(_args, context) {
        const groups = context.listTools() as ToolGroup[];
        const skills = await context.skillManager.listSkills(context.skillDirectories);
        return textResult(formatCapabilitySnapshot(groups, skills));
    }
};

function formatCapabilitySnapshot(groups: ToolGroup[], skills: SkillSummary[]): string {
    const lines: string[] = ['# Available Tools', ''];

    for (const group of groups) {
        lines.push(`## ${group.server}`);
        for (const tool of group.tools) {
            lines.push(`- ${formatToolSignature(tool)} — ${tool.description}`);
        }
        lines.push('');
    }

    lines.push(DISCOVERY_TOOLS_NOTE, '', '# Available Skills', '');

    if (skills.length === 0) {
        lines.push('(none)');
    } else {
        for (const skill of skills) {
            lines.push(`- ${skill.name} [${skill.source}] — ${skill.description}`);
            lines.push(`  skillFilePath: ${skill.skillFilePath}`);
        }
    }

    return lines.join('\n');
}

function formatToolSignature(tool: ToolDefinition): string {
    const schema = tool.inputSchema as
        | { properties?: Record<string, unknown>; required?: unknown }
        | undefined;
    const propertyNames = schema?.properties ? Object.keys(schema.properties) : [];
    const required = new Set(
        Array.isArray(schema?.required) ? schema.required.filter((n): n is string => typeof n === 'string') : []
    );
    const params = propertyNames.map(name => (required.has(name) ? name : `${name}?`));

    const annotations = tool.annotations as Record<string, unknown> | undefined;
    const hints: string[] = [];
    if (annotations?.readOnlyHint === true) {hints.push('read-only');}
    if (annotations?.destructiveHint === true) {hints.push('destructive');}

    const suffix = hints.length > 0 ? ` [${hints.join(', ')}]` : '';
    return `${tool.name}(${params.join(', ')})${suffix}`;
}
