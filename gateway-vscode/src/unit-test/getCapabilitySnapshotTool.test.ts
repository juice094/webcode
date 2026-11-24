import * as assert from 'assert';

import { getCapabilitySnapshotTool } from '../tools/getCapabilitySnapshotTool';
import type { ToolExecutionContext } from '../tools';

suite('Capability snapshot tool', () => {
    test('renders grouped tool signatures and skills', async () => {
        const context = createContext({
            groups: [
                {
                    server: 'internal',
                    tools: [
                        {
                            name: 'read_file',
                            description: 'Read a text file.',
                            inputSchema: {
                                type: 'object',
                                properties: { path: {}, start_line: {}, end_line: {} },
                                required: ['path']
                            },
                            annotations: { readOnlyHint: true }
                        },
                        {
                            name: 'edit_file',
                            description: 'Edit an existing file.',
                            inputSchema: {
                                oneOf: [
                                    {
                                        type: 'object',
                                        properties: { path: {}, edits: {}, dryRun: {} },
                                        required: ['path', 'edits']
                                    },
                                    {
                                        type: 'object',
                                        properties: { path: {}, patch: {}, dryRun: {} },
                                        required: ['path', 'patch']
                                    }
                                ]
                            },
                            annotations: { destructiveHint: true }
                        },
                        {
                            name: 'terminal_session',
                            description: 'Manage terminal sessions.',
                            inputSchema: {
                                oneOf: [
                                    {
                                        type: 'object',
                                        properties: { action: { enum: ['list'] } },
                                        required: ['action']
                                    },
                                    {
                                        type: 'object',
                                        properties: {
                                            action: { enum: ['read'] },
                                            session_id: {},
                                            tail_lines: {},
                                            delay_seconds: {}
                                        },
                                        required: ['action', 'session_id']
                                    },
                                    {
                                        type: 'object',
                                        properties: {
                                            action: { enum: ['stop', 'close'] },
                                            session_id: {}
                                        },
                                        required: ['action', 'session_id']
                                    }
                                ]
                            }
                        }
                    ]
                },
                {
                    server: 'files-mcp',
                    tools: [
                        {
                            name: 'fetch_url',
                            description: 'Fetch a URL.',
                            inputSchema: { type: 'object', properties: { url: {} }, required: ['url'] }
                        }
                    ]
                }
            ],
            skills: [
                {
                    name: 'demo-skill',
                    description: 'Demo workflow.',
                    relativePath: 'demo-skill',
                    sourceDir: '.agents/skills',
                    skillFilePath: '.agents/skills/demo-skill/SKILL.md',
                    source: 'workspace'
                }
            ]
        });

        const result = await getCapabilitySnapshotTool.execute({}, context);
        const text = result.content.map(item => item.text ?? '').join('\n');

        assert.ok(text.includes('# Available Tools'));
        assert.ok(text.includes('## internal'));
        assert.ok(text.includes('- read_file(path, start_line?, end_line?) [read-only] — Read a text file.'));
        assert.ok(text.includes('- edit_file(path, edits | patch, dryRun?) [destructive] — Edit an existing file.'));
        assert.ok(text.includes(
            '- terminal_session(action: list|read|stop|close, session_id, tail_lines?, delay_seconds?) — Manage terminal sessions.'
        ));
        assert.ok(text.includes('## files-mcp'));
        assert.ok(text.includes('- fetch_url(url) — Fetch a URL.'));
        assert.ok(text.includes('`list_tools`'), 'snapshot must point at list_tools for full schemas');
        assert.ok(text.includes('# Available Skills'));
        assert.ok(text.includes('- demo-skill [workspace] — Demo workflow.'));
        assert.ok(text.includes('skillFilePath: .agents/skills/demo-skill/SKILL.md'));
    });

    test('marks the skills section when no skills exist', async () => {
        const context = createContext({ groups: [], skills: [] });
        const result = await getCapabilitySnapshotTool.execute({}, context);
        const text = result.content.map(item => item.text ?? '').join('\n');

        assert.ok(text.includes('(none)'));
    });
});

function createContext(options: {
    groups: unknown;
    skills: unknown;
}): ToolExecutionContext {
    return {
        workspaceRoot: null,
        logger: {} as ToolExecutionContext['logger'],
        skillManager: {
            listSkills: () => Promise.resolve(options.skills)
        } as unknown as ToolExecutionContext['skillManager'],
        terminalSessionManager: {} as ToolExecutionContext['terminalSessionManager'],
        skillDirectories: [],
        listTools: () => options.groups,
        getToolDefinition: () => null
    };
}
