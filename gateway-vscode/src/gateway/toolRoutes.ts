import type express from 'express';

import type { ApprovalAuditSink } from './approvalAudit';
import type { CommandApprovalManager } from './commandApproval';
import {
    createToolApprovalHandler,
    createToolCallHandler,
    createToolPreflightHandler,
    type ToolCallHandlerOptions
} from './toolCallRoute';

/**
 * Route wiring for the authenticated tool surface.
 *
 * Kept out of GatewayManager so the manager file stays inside the repository's
 * 400-line budget; the handler options remain a single object built by the
 * manager, so this module owns only the three POST registrations.
 */
export type ToolRouteDeps = {
    app: express.Express;
    approvalAuditSink?: ApprovalAuditSink;
    commandApprovalManager: CommandApprovalManager;
    toolCallOptions: ToolCallHandlerOptions;
};

export function registerToolRoutes(deps: ToolRouteDeps): void {
    const { app, approvalAuditSink, commandApprovalManager, toolCallOptions } = deps;
    app.post('/v1/tools/preflight', createToolPreflightHandler(toolCallOptions));
    app.post('/v1/tools/approve', createToolApprovalHandler(commandApprovalManager, approvalAuditSink));
    app.post('/v1/tools/call', createToolCallHandler(toolCallOptions));
}
