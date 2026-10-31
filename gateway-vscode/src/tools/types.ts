import type * as vscode from 'vscode';
import type { SkillManager } from '../skillManager';
import type { TerminalSessionManager } from '../terminalSessionManager';
import type { CommandRiskAssessment } from '../servers/commandRisk';

export type ToolContent = {
    type: string;
    text?: string;
    [key: string]: unknown;
};

export type ToolResult = {
    content: ToolContent[];
    isError?: boolean;
    structuredContent?: unknown;
};

export type ToolDefinition = Record<string, unknown> & {
    name: string;
    description: string;
    inputSchema?: unknown;
};

export type ToolExecutionContext = {
    workspaceRoot: string | null;
    /** All VS Code workspace folders; path resolution accepts any of them. */
    workspaceRoots?: readonly string[];
    outputChannel: vscode.OutputChannel;
    skillManager: SkillManager;
    terminalSessionManager: TerminalSessionManager;
    skillDirectories: string[];
    commandShellPath?: string;
    commandAllowedRoots?: string[];
    commandExecutionMs?: number;
    commandExecutionMaxMs?: number;
    commandDenyRules?: string[];
    /** When false, commands that would require confirmation run without approval. */
    commandRequireApproval?: boolean;
    /** Rules that exempt matching commands from the approval prompt. */
    commandAllowRules?: string[];
    approvedCommandFingerprint?: string;
    listTools: () => unknown;
    getToolDefinition: (name: string) => ToolDefinition | null;
};

export type ToolDefinitionContext = {
    commandShellPath?: string;
    commandExecutionMs?: number;
    commandExecutionMaxMs?: number;
};

export type LocalTool = {
    definition: ToolDefinition;
    getDefinition?: (context: ToolDefinitionContext) => ToolDefinition;
    serverId?: string;
    assessRisk?: (
        args: Record<string, unknown>,
        context: ToolExecutionContext
    ) => Promise<ToolRiskPreflight>;
    /**
     * `signal` MUST be honoured once the gateway wires real cancellation:
     * abort ⇒ stop spawning processes, close file handles, and reject with the
     * abort reason. It is optional today so existing tool implementations keep
     * compiling while the gateway still passes a never-aborting signal.
     */
    execute: (
        args: Record<string, unknown>,
        context: ToolExecutionContext,
        signal?: AbortSignal
    ) => Promise<ToolResult>;
};

export type ToolRiskPreflight = {
    assessment: CommandRiskAssessment;
    fingerprint: string;
};
