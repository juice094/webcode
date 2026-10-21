import * as assert from 'assert';
import type express from 'express';

import type { ApprovalAuditEvent } from '../gateway/approvalAudit';
import { CommandApprovalManager } from '../gateway/commandApproval';
import {
  createToolApprovalHandler,
  createToolCallHandler,
  createToolPreflightHandler
} from '../gateway/toolCallRoute';
import type { LocalTool, ToolExecutionContext } from '../tools';

suite('Gateway command approval routes', () => {
  test('requires a challenge grant and consumes it once', async () => {
    let executionCount = 0;
    const tool = createRiskyTool(() => { executionCount += 1; });
    const manager = new CommandApprovalManager();
    const options = createHandlerOptions(tool, manager);

    const preflight = await invokeHandler(createToolPreflightHandler(options), {
      name: 'execute_command',
      arguments: { command: 'git reset --hard' }
    });
    assert.strictEqual(preflight.statusCode, 200);
    const challengeId = readNestedString(preflight.body, 'challenge', 'id');
    assert.ok(challengeId);

    const approval = await invokeHandler(createToolApprovalHandler(manager), {
      challenge_id: challengeId
    });
    const approvalToken = readString(approval.body, 'approval_token');
    assert.ok(approvalToken);

    const callBody = {
      name: 'execute_command',
      arguments: { command: 'git reset --hard' },
      approval_token: approvalToken
    };
    const executed = await invokeHandler(createToolCallHandler(options), callBody);
    assert.strictEqual(executed.statusCode, 200);
    assert.strictEqual(executionCount, 1);

    const replay = await invokeHandler(createToolCallHandler(options), callBody);
    assert.strictEqual(replay.statusCode, 409);
    assert.strictEqual(executionCount, 1);
  });

  test('does not issue challenges for blocked commands', async () => {
    let executionCount = 0;
    const tool = createRiskyTool(
      () => { executionCount += 1; },
      'blocked'
    );
    const manager = new CommandApprovalManager();
    const options = createHandlerOptions(tool, manager);
    const request = {
      name: 'execute_command',
      arguments: { command: 'rm -rf .' }
    };

    const preflight = await invokeHandler(createToolPreflightHandler(options), request);
    assert.strictEqual(readNestedString(preflight.body, 'risk', 'level'), 'blocked');
    assert.strictEqual(readRecord(preflight.body).challenge, undefined);

    const execution = await invokeHandler(createToolCallHandler(options), request);
    assert.strictEqual(execution.statusCode, 400);
    assert.strictEqual(executionCount, 0);
  });

  test('audits the approval lifecycle without leaking the grant', async () => {
    const audited: ApprovalAuditEvent[] = [];
    const tool = createRiskyTool(() => undefined);
    const manager = new CommandApprovalManager();
    const options = { ...createHandlerOptions(tool, manager), audit: (event: ApprovalAuditEvent) => audited.push(event) };

    const preflight = await invokeHandler(createToolPreflightHandler(options), {
      name: 'execute_command',
      arguments: { command: 'git reset --hard' }
    });
    const challengeId = readNestedString(preflight.body, 'challenge', 'id');
    assert.ok(challengeId);

    const approval = await invokeHandler(createToolApprovalHandler(manager, options.audit), {
      challenge_id: challengeId
    });
    const approvalToken = readString(approval.body, 'approval_token');
    assert.ok(approvalToken);

    await invokeHandler(createToolCallHandler(options), {
      name: 'execute_command',
      arguments: { command: 'git reset --hard' },
      approval_token: approvalToken
    });

    assert.deepStrictEqual(
      audited.map(event => event.event),
      ['preflight_assessed', 'challenge_issued', 'grant_issued', 'execution_finished']
    );
    assert.strictEqual(audited[0].level, 'requires_confirmation');
    assert.strictEqual(audited[0].command, 'git reset --hard');
    assert.strictEqual(audited[1].challengeId, challengeId);
    assert.strictEqual(audited[3].status, 'success');
    assert.ok(
      !JSON.stringify(audited).includes(approvalToken),
      'the approval token must never reach the audit trail'
    );
  });

  test('audits blocked commands and rejected challenges', async () => {
    const audited: ApprovalAuditEvent[] = [];
    const tool = createRiskyTool(() => undefined, 'blocked');
    const manager = new CommandApprovalManager();
    const options = { ...createHandlerOptions(tool, manager), audit: (event: ApprovalAuditEvent) => audited.push(event) };

    await invokeHandler(createToolPreflightHandler(options), {
      name: 'execute_command',
      arguments: { command: 'rm -rf .' }
    });
    const blocked = await invokeHandler(createToolCallHandler(options), {
      name: 'execute_command',
      arguments: { command: 'rm -rf .' }
    });
    await invokeHandler(createToolApprovalHandler(manager, options.audit), { challenge_id: 'missing' });

    assert.strictEqual(blocked.statusCode, 400);
    assert.deepStrictEqual(
      audited.map(event => event.event),
      ['preflight_assessed', 'blocked', 'grant_rejected']
    );
    assert.strictEqual(audited[1].level, 'blocked');
    assert.deepStrictEqual(audited[1].reasons, ['test risk']);
  });
});

function createRiskyTool(
  onExecute: () => void,
  level: 'requires_confirmation' | 'blocked' = 'requires_confirmation'
): LocalTool {
  return {
    definition: {
      name: 'execute_command',
      description: 'test command',
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    },
    assessRisk() {
      return Promise.resolve({
        assessment: { level, reasons: ['test risk'] },
        fingerprint: 'fingerprint'
      });
    },
    execute(_args, context) {
      assert.strictEqual(context.approvedCommandFingerprint, 'fingerprint');
      onExecute();
      return Promise.resolve({ content: [{ type: 'text', text: 'executed' }] });
    }
  };
}

function createHandlerOptions(tool: LocalTool, manager: CommandApprovalManager) {
  return {
    commandApprovalManager: manager,
    createToolExecutionContext: () => ({}) as ToolExecutionContext,
    error: () => undefined,
    getToolDefinition: (name: string) => name === 'execute_command' ? tool.definition : null,
    getWorkspaceRoot: () => 'C:\\workspace',
    localTools: new Map([['execute_command', tool]]),
    log: () => undefined,
    toolRouter: new Map()
  };
}

async function invokeHandler(
  handler: express.RequestHandler,
  body: Record<string, unknown>
): Promise<{ body: unknown; statusCode: number }> {
  let responseBody: unknown;
  let statusCode = 200;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      responseBody = value;
      return response;
    }
  };
  const request = { body };

  await Promise.resolve(handler(
    request as express.Request,
    response as unknown as express.Response,
    () => undefined
  ));
  return { body: responseBody, statusCode };
}

function readNestedString(value: unknown, parent: string, child: string): string | undefined {
  const nested = readRecord(value)[parent];
  return readString(nested, child);
}

function readString(value: unknown, key: string): string | undefined {
  const candidate = readRecord(value)[key];
  return typeof candidate === 'string' ? candidate : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
}
