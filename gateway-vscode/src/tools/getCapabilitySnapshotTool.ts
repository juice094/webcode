import type { SkillSummary } from '../skillManager';
import type { LocalTool, ToolDefinition } from './types';
import { textResult } from './result';

type ToolGroup = {
    server: string;
    tools: ToolDefinition[];
};

const DISCOVERY_TOOLS_NOTE =
    '`list_tools` and `list_skills` are meta tools: always available, intentionally not listed above. ' +
    'Call `list_tools` for a tool\'s full inputSchema — required before calling a tool whose signature shows `oneOf` alternatives — ' +
    'or to refresh this list after MCP servers change; call `list_skills` to refresh the skill list. ' +
    'Both are on-demand queries, not a required pre-task step. Refreshed results override this inline snapshot.';

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
    const annotations = tool.annotations as Record<string, unknown> | undefined;
    const hints: string[] = [];
    if (annotations?.readOnlyHint === true) {hints.push('read-only');}
    if (annotations?.destructiveHint === true) {hints.push('destructive');}

    const suffix = hints.length > 0 ? ` [${hints.join(', ')}]` : '';
    return `${tool.name}(${formatSchemaParams(tool.inputSchema)})${suffix}`;
}

type ObjectSchemaInfo = {
    propertyNames: string[];
    required: string[];
    enums: Map<string, string[]>;
};

function formatSchemaParams(schema: unknown): string {
    const branches = readSchemaBranches(schema);
    if (branches.length === 0) {
        return '';
    }

    const requiredSets = branches.map(branch => new Set(branch.required));
    const alwaysRequired = branches[0].required.filter(name =>
        requiredSets.every(set => set.has(name))
    );

    const parts: string[] = alwaysRequired.map(name => renderParam(name, branches));

    const alternatives: string[] = [];
    for (const branch of branches) {
        const extra = branch.required.filter(name => !alwaysRequired.includes(name));
        if (extra.length > 0) {
            const rendered = extra.join(', ');
            if (!alternatives.includes(rendered)) {
                alternatives.push(rendered);
            }
        }
    }
    if (alternatives.length > 0) {
        parts.push(alternatives.join(' | '));
    }

    const claimed = new Set([...alwaysRequired, ...alternatives.flatMap(alt => alt.split(', '))]);
    const optionalNames: string[] = [];
    for (const branch of branches) {
        for (const name of branch.propertyNames) {
            if (!claimed.has(name) && !optionalNames.includes(name)) {
                optionalNames.push(name);
            }
        }
    }
    parts.push(...optionalNames.map(name => `${renderParam(name, branches)}?`));

    return parts.join(', ');
}

function readSchemaBranches(schema: unknown): ObjectSchemaInfo[] {
    if (typeof schema !== 'object' || schema === null) {
        return [];
    }
    const record = schema as Record<string, unknown>;
    const rawBranches = Array.isArray(record.oneOf) ? record.oneOf : [record];
    return rawBranches
        .filter((branch): branch is Record<string, unknown> => typeof branch === 'object' && branch !== null)
        .map(readObjectSchema);
}

function readObjectSchema(schema: Record<string, unknown>): ObjectSchemaInfo {
    const properties = (typeof schema.properties === 'object' && schema.properties !== null
        ? schema.properties
        : {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required)
        ? schema.required.filter((name): name is string => typeof name === 'string')
        : [];
    const enums = new Map<string, string[]>();
    for (const [name, propSchema] of Object.entries(properties)) {
        if (typeof propSchema === 'object' && propSchema !== null) {
            const values = (propSchema as Record<string, unknown>).enum;
            if (Array.isArray(values)) {
                const strings = values.filter((v): v is string => typeof v === 'string');
                if (strings.length > 0) {
                    enums.set(name, strings);
                }
            }
        }
    }
    return { propertyNames: Object.keys(properties), required, enums };
}

function renderParam(name: string, branches: ObjectSchemaInfo[]): string {
    const values: string[] = [];
    for (const branch of branches) {
        for (const value of branch.enums.get(name) ?? []) {
            if (!values.includes(value)) {
                values.push(value);
            }
        }
    }
    return values.length > 0 ? `${name}: ${values.join('|')}` : name;
}
