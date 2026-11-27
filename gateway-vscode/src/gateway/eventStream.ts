import * as fs from 'node:fs';
import * as path from 'node:path';
import http from 'node:http';

import { sessionTokenRef } from './writeLock';

/**
 * S4 网关事件流：规范键分配、spool 落盘、批量投递。
 *
 * 设计（见 dsh-ext `docs/S4-EVENT-STORE.md`）：
 * - canonical key = (gatewayInstanceId, workspaceId, sessionRef, seq)，seq 在本模块
 *   单点分配（每命名空间从 1 连续），插件侧只做幂等写入，不重新编号。
 * - spool 是 append-only 的回放真源（删除派生库后可逐行重建）；投递是尽力而为：
 *   失败批次只在 spool 里"欠账"，不阻塞工具调用，也不 throw 到调用方。
 * - 网络与时钟可注入，本模块可纯 Node 单测（打桩 sendBatch）。
 */

export const EVENT_SCHEMA_VERSION = 1;

/** 网关作用域命名空间：会话建立前/不存在会话的事件（配对、实例生命周期）。 */
export const GATEWAY_EVENT_SCOPE = '-';

/** 默认投递批大小与周期（满批或到点即 flush，兼顾延迟与请求数）。 */
export const DEFAULT_BATCH_SIZE = 64;
export const DEFAULT_FLUSH_INTERVAL_MS = 250;
/** 失败重试的退避（毫秒）；重试次数 = 数组长度。用尽后丢弃该批（spool 兜底）。 */
export const DEFAULT_RETRY_DELAYS_MS = [200, 500];

/** 接收端契约上限（与插件侧 eventBridge 校验一致）。 */
export const SINK_MAX_BATCH_EVENTS = 512;
export const SINK_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface GatewayEventEnvelope {
    v: number;
    gatewayInstanceId: string;
    workspaceId: string;
    sessionRef: string;
    seq: number;
    type: string;
    timeMs: number;
    data?: unknown;
}

export interface GatewayEventInput {
    /** 会话 token；缺省归网关作用域。token 只用于算摘要，绝不落盘/传输。 */
    sessionToken?: string;
    data?: unknown;
    timeMs?: number;
}

export interface GatewayEventSnapshotStream {
    sessionRef: string;
    lastSeq: number;
    eventCount: number;
}

export interface GatewayEventSnapshot {
    gatewayInstanceId: string;
    workspaceId: string;
    streams: GatewayEventSnapshotStream[];
}

export type EventBatchSender = (body: string) => Promise<{ status: number }>;

export interface GatewayEventStreamOptions {
    gatewayInstanceId: string;
    workspaceId: string;
    /** spool 目录；缺省或空串 = 不落 spool（库可入库，但删库不可重建）。 */
    spoolDir?: string;
    /** 桥端点（S3 的 loopback 服务，/v1/events）；缺省 = 只落 spool 不投递。 */
    sinkUrl?: string;
    sinkToken?: string;
    log: (line: string) => void;
    now?: () => number;
    batchSize?: number;
    flushIntervalMs?: number;
    retryDelaysMs?: number[];
    /** 测试注入口；生产从 sinkUrl 构造。 */
    sendBatch?: EventBatchSender;
}

export interface GatewayEventStream {
    emit(type: string, input?: GatewayEventInput): GatewayEventEnvelope;
    flush(): Promise<void>;
    dispose(): Promise<void>;
    snapshot(): GatewayEventSnapshot;
}

/** 会话命名空间：token 摘要；无 token = 网关作用域。 */
export function namespaceOf(sessionToken: string | undefined): string {
    return sessionToken ? sessionTokenRef(sessionToken) : GATEWAY_EVENT_SCOPE;
}

/** 事件流的可变状态（拆出工厂函数以压住单函数行数/复杂度）。 */
type StreamState = {
    seqByScope: Map<string, number>;
    countByScope: Map<string, number>;
    queue: GatewayEventEnvelope[];
    flushing: Promise<void> | null;
    disposed: boolean;
    droppedBatches: number;
};

function senderFromUrl(sinkUrl: string, sinkToken: string, log: (line: string) => void): EventBatchSender | null {
    let parsed: URL;
    try {
        parsed = new URL(sinkUrl);
    } catch {
        log(`⚠️ WEBCODE_EVENT_SINK 不是合法 URL（${sinkUrl}），事件只落 spool。`);
        return null;
    }
    return body => new Promise((resolve, reject) => {
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
                'x-webcode-event-token': sinkToken
            },
            timeout: 5000
        }, (res) => {
            res.resume();
            resolve({ status: res.statusCode ?? 0 });
        });
        req.on('timeout', () => req.destroy(new Error('event sink timeout')));
        req.on('error', reject);
        req.end(body);
    });
}

/** spool 追加器：append-only JSONL，一次写失败只告警一次（不阻断后续事件）。 */
function createSpoolAppender(dir: string, instanceId: string, log: (line: string) => void): (line: string) => void {
    const file = dir ? path.join(dir, `${instanceId}.jsonl`) : '';
    let warned = false;
    const warn = (message: string, error: unknown): void => {
        if (warned) {
            return;
        }
        warned = true;
        log(`⚠️ ${message}：${String(error)}`);
    };
    if (!file) {
        return () => undefined;
    }
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error: unknown) {
        warn(`事件 spool 目录不可用（${dir}），事件只投递不落盘`, error);
        return () => undefined;
    }
    return (line: string): void => {
        try {
            fs.appendFileSync(file, `${line}\n`, 'utf8');
        } catch (error: unknown) {
            warn(`事件 spool 写入失败（${file}），后续事件只投递`, error);
        }
    };
}

/** 单飞排空循环：一次只允许一个批次在途，保证插件侧看到的是 seq 顺序。 */
function createFlushLoop(
    sender: EventBatchSender,
    state: StreamState,
    batchSize: number,
    retryDelaysMs: number[],
    log: (line: string) => void
): () => Promise<void> {
    const sendBatch = async (batch: GatewayEventEnvelope[]): Promise<void> => {
        let lastError = 'unknown';
        for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
            if (attempt > 0) {
                await new Promise(resolve => setTimeout(resolve, retryDelaysMs[attempt - 1]));
            }
            try {
                const result = await sender(JSON.stringify({ v: EVENT_SCHEMA_VERSION, events: batch }));
                if (result.status >= 200 && result.status < 300) {
                    return;
                }
                lastError = `HTTP ${result.status}`;
            } catch (error: unknown) {
                lastError = error instanceof Error ? error.message : String(error);
            }
        }
        // 降级：该批留在 spool 里"欠账"，插件侧对账会暴露缺口，不阻塞调用方。
        state.droppedBatches += 1;
        log(`⚠️ 事件批投递失败（已留在 spool，可回放补入库）：${lastError}`);
    };
    return async (): Promise<void> => {
        while (state.queue.length > 0 && !state.disposed) {
            const batch = state.queue.splice(0, batchSize);
            await sendBatch(batch);
        }
    };
}

/** 纯函数式的信封组装 + seq 推进（从工厂函数拆出以压住复杂度）。 */
type EmitContext = {
    gatewayInstanceId: string;
    workspaceId: string;
    now: () => number;
    appendSpool: (line: string) => void;
    enqueue: (envelope: GatewayEventEnvelope) => void;
    state: StreamState;
};

function emitEvent(context: EmitContext, type: string, input: GatewayEventInput): GatewayEventEnvelope {
    const sessionRef = namespaceOf(input.sessionToken);
    const seq = (context.state.seqByScope.get(sessionRef) ?? 0) + 1;
    context.state.seqByScope.set(sessionRef, seq);
    context.state.countByScope.set(sessionRef, (context.state.countByScope.get(sessionRef) ?? 0) + 1);
    const envelope: GatewayEventEnvelope = {
        v: EVENT_SCHEMA_VERSION,
        gatewayInstanceId: context.gatewayInstanceId,
        workspaceId: context.workspaceId,
        sessionRef,
        seq,
        type,
        timeMs: input.timeMs ?? context.now(),
        ...(input.data === undefined ? {} : { data: input.data })
    };
    context.appendSpool(JSON.stringify(envelope));
    context.enqueue(envelope);
    return envelope;
}

function snapshotStreams(state: StreamState): GatewayEventSnapshotStream[] {
    return [...state.seqByScope.entries()]
        .map(([sessionRef, lastSeq]) => ({ sessionRef, lastSeq, eventCount: state.countByScope.get(sessionRef) ?? 0 }))
        .sort((left, right) => left.sessionRef.localeCompare(right.sessionRef));
}

/** 单飞 flush 控制器：同一时刻只允许一轮排空，结束后若又攒了事件则自动续跑。 */
function createFlushController(flushLoop: (() => Promise<void>) | null, state: StreamState): () => Promise<void> {
    if (!flushLoop) {
        return () => Promise.resolve();
    }
    const flush = (): Promise<void> => {
        state.flushing ??= flushLoop().finally(() => {
            state.flushing = null;
            if (state.queue.length > 0 && !state.disposed) {
                void flush();
            }
        });
        return state.flushing;
    };
    return flush;
}

/** 关停：停定时器 → 排空 → 汇总丢弃批次。 */
async function disposeStream(
    timer: NodeJS.Timeout | null,
    flush: () => Promise<void>,
    state: StreamState,
    log: (line: string) => void
): Promise<void> {
    if (timer) {
        clearInterval(timer);
    }
    // 先排空再标记：flush 循环本身会检查 disposed，先置位会让在途批次丢掉。
    await flush();
    state.disposed = true;
    if (state.droppedBatches > 0) {
        log(`ℹ️ 本实例共 ${state.droppedBatches} 个事件批投递失败（spool 保留，可回放）。`);
    }
}

/** 周期 ticker：把定时器箭头函数拆出来，避免工厂函数被算成高复杂度。 */
function startTicker(active: boolean, state: StreamState, flush: () => Promise<void>, intervalMs: number): NodeJS.Timeout | null {
    if (!active) {
        return null;
    }
    const timer = setInterval(() => {
        if (state.queue.length > 0) {
            void flush();
        }
    }, intervalMs);
    timer.unref?.();
    return timer;
}

/** 入队器：满批即触发 flush；无投递端时只写 spool。 */
function createEnqueuer(
    active: boolean,
    state: StreamState,
    batchSize: number,
    flush: () => Promise<void>
): (envelope: GatewayEventEnvelope) => void {
    return envelope => {
        if (!active) {
            return;
        }
        state.queue.push(envelope);
        if (state.queue.length >= batchSize) {
            void flush();
        }
    };
}

/** 解析投递端：显式注入 > sinkUrl 构造 > 不投递（只落 spool）。 */
function resolveSender(options: GatewayEventStreamOptions): EventBatchSender | null {
    if (options.sendBatch) {
        return options.sendBatch;
    }
    const sinkUrl = options.sinkUrl?.trim() ?? '';
    return sinkUrl ? senderFromUrl(sinkUrl, options.sinkToken ?? '', options.log) : null;
}

/**
 * 创建事件流。emit 是同步的（先 spool 再入队），调用方（工具调用/配对路由）
 * 永远不被投递网络阻塞。
 */
export function createGatewayEventStream(options: GatewayEventStreamOptions): GatewayEventStream {
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    const flushIntervalMs = Math.max(1, options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const spoolDir = options.spoolDir?.trim() ?? '';
    const appendSpool = createSpoolAppender(spoolDir, options.gatewayInstanceId, options.log);
    const sender = resolveSender(options);
    const state: StreamState = {
        seqByScope: new Map(), countByScope: new Map(), queue: [], flushing: null, disposed: false, droppedBatches: 0
    };
    const flushLoop = sender ? createFlushLoop(sender, state, batchSize, retryDelaysMs, options.log) : null;
    const flush = createFlushController(flushLoop, state);
    const timer = startTicker(flushLoop !== null, state, flush, flushIntervalMs);

    const emitContext: EmitContext = {
        gatewayInstanceId: options.gatewayInstanceId,
        workspaceId: options.workspaceId,
        now: options.now ?? Date.now,
        appendSpool,
        enqueue: createEnqueuer(flushLoop !== null, state, batchSize, flush),
        state
    };

    return {
        emit: (type, input = {}) => emitEvent(emitContext, type, input),
        flush,
        dispose: () => disposeStream(timer, flush, state, options.log),
        snapshot: () => ({
            gatewayInstanceId: options.gatewayInstanceId,
            workspaceId: options.workspaceId,
            streams: snapshotStreams(state)
        })
    };
}
