import type { PairingRequestEvent, PairingResolvedEvent } from './pairingRoutes';
import type { GatewayEventStream } from './eventStream';
import type { ToolCallResultInfo } from './toolCallExecution';

/**
 * S4 事件接线：把 GatewayManager 关心的生命周期点翻译成事件信封。
 *
 * 拆成独立模块的原因：GatewayManager 受仓库行数预算约束（每文件 400 行），
 * 事件字段的组装/callId→会话映射放在这里，gateway.ts 只留一行调用。
 * stream 缺省（VS Code 宿主）时全部是 no-op。
 */

/** tool/call 需要的字段（controller 不进入事件，只在 manager 内部用）。 */
export type ToolCallStartEvent = {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
    sessionToken?: string;
};

export interface GatewayEventWiring {
    gatewayStarted(data: Record<string, unknown>): void;
    gatewayStopped(data: Record<string, unknown>): void;
    pairingRequested(event: PairingRequestEvent): void;
    pairingResolved(event: PairingResolvedEvent): void;
    sessionActivated(session: { token: string; siteId: string }): void;
    sessionRevoked(tokens: readonly string[], reason: string): void;
    toolCallStart(event: ToolCallStartEvent): void;
    toolCallEnd(callId: string): void;
    toolResult(info: ToolCallResultInfo): void;
}

export type GatewayEventErrorSink = (message: string, error: unknown) => void;

export function createGatewayEventWiring(
    stream: GatewayEventStream | undefined,
    onError: GatewayEventErrorSink
): GatewayEventWiring {
    /** callId → 会话 token：tool/result 靠它落回与 tool/call 相同的命名空间。 */
    const callSessions = new Map<string, string>();

    const emit = (type: string, data: unknown, sessionToken?: string): void => {
        if (!stream) {
            return;
        }
        try {
            stream.emit(type, sessionToken ? { sessionToken, data } : { data });
        } catch (error: unknown) {
            // 事件流故障不得打断请求路径（例如载荷里有不可序列化的值）。
            onError('事件流发射失败（不影响请求）', error);
        }
    };

    return {
        gatewayStarted: data => emit('gateway/started', data),
        gatewayStopped: data => emit('gateway/stopped', data),
        pairingRequested: event => emit('pairing/requested', event),
        pairingResolved: event => emit('pairing/resolved', event),
        sessionActivated: session => emit('session/activated', { siteId: session.siteId }, session.token),
        sessionRevoked: (tokens, reason) => {
            for (const token of tokens) {
                emit('session/revoked', { reason }, token);
            }
        },
        toolCallStart: event => {
            if (event.sessionToken) {
                callSessions.set(event.callId, event.sessionToken);
            }
            emit('tool/call', {
                callId: event.callId,
                toolName: event.toolName,
                arguments: event.args
            }, event.sessionToken);
        },
        toolCallEnd: callId => {
            callSessions.delete(callId);
        },
        toolResult: info => emit('tool/result', info, callSessions.get(info.callId))
    };
}
