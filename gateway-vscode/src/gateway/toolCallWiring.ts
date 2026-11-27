import type { LocalTool, ToolDefinition, ToolExecutionContext } from '../tools';
import type { CompressionPolicy } from '../tools/resultCompression';
import type { ApprovalAuditSink } from './approvalAudit';
import type { CommandApprovalManager } from './commandApproval';
import type { ToolCallHandlerOptions } from './toolCallRoute';
import type { ToolCallResultInfo } from './toolCallExecution';
import type { ToolConcurrencyGate } from './toolConcurrency';
import type { GatewayErrorLogger, GatewayLogger, RemoteToolRoute } from './types';
import type { GatewayRuntimeTraceSink } from './runtimeTrace';
import type { WriteLock } from './writeLock';

/**
 * 工具路由的事件接线参数。
 *
 * 拆出来只为让 GatewayManager 守住仓库行数预算（每文件 400 行、每函数 90 行）；
 * 契约仍是 `ToolCallHandlerOptions`，这里不新增行为。
 */
export type ToolCallWiringDeps = {
    audit?: ApprovalAuditSink;
    commandApprovalManager: CommandApprovalManager;
    concurrencyGate?: ToolConcurrencyGate;
    createToolExecutionContext: () => ToolExecutionContext;
    error: GatewayErrorLogger;
    getCompressionPolicy?: () => CompressionPolicy;
    getToolCallTimeoutMs?: () => number;
    getToolDefinition: (name: string) => ToolDefinition | null;
    getWorkspaceRoot: () => string | null;
    localTools: Map<string, LocalTool>;
    log: GatewayLogger;
    onToolCallEnd?: (callId: string) => void;
    onToolCallResult?: (info: ToolCallResultInfo) => void;
    onToolCallStart?: ToolCallHandlerOptions['onToolCallStart'];
    toolRouter: Map<string, RemoteToolRoute>;
    trace?: GatewayRuntimeTraceSink;
    writeLock?: WriteLock;
};

export function createToolCallOptions(deps: ToolCallWiringDeps): ToolCallHandlerOptions {
    return {
        audit: deps.audit,
        concurrencyGate: deps.concurrencyGate,
        commandApprovalManager: deps.commandApprovalManager,
        createToolExecutionContext: deps.createToolExecutionContext,
        error: deps.error,
        getToolCallTimeoutMs: deps.getToolCallTimeoutMs,
        getCompressionPolicy: deps.getCompressionPolicy,
        getToolDefinition: deps.getToolDefinition,
        getWorkspaceRoot: deps.getWorkspaceRoot,
        localTools: deps.localTools,
        log: deps.log,
        onToolCallEnd: deps.onToolCallEnd,
        onToolCallResult: deps.onToolCallResult,
        onToolCallStart: deps.onToolCallStart,
        trace: deps.trace,
        toolRouter: deps.toolRouter,
        writeLock: deps.writeLock
    };
}
