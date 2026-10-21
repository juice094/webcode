import type express from 'express';
import type { Server as HttpServer } from 'http';
import * as vscode from 'vscode';
import { BRIDGE_PORT_RANGE_END, BRIDGE_PORT_RANGE_START } from '@webcode/shared';

import type { GatewayRuntimeTraceSink } from './runtimeTrace';
import type { GatewayConfig, StartResult } from './types';

/**
 * The browser bridge content scripts only match the loopback port window
 * 34567-34576, so the gateway scans at most this many consecutive ports
 * starting from the configured one. Landing outside the window leaves the
 * bridge page without an injected extension.
 */
const MAX_PORT_RETRY_ATTEMPTS = BRIDGE_PORT_RANGE_END - BRIDGE_PORT_RANGE_START + 1;

export type PortListenerDeps = {
    app: express.Express;
    config: GatewayConfig;
    log: (message: string) => void;
    trace: GatewayRuntimeTraceSink;
    onBound: (port: number, server: HttpServer) => void;
};

/**
 * Binds the gateway to the first free port, preferring the port this workspace
 * used last and walking upward inside the bridge-supported window. Extracted
 * from GatewayManager so the manager file keeps room for lifecycle logic; the
 * binding policy itself is unchanged.
 */
export function listenOnAvailablePort(deps: PortListenerDeps): Promise<StartResult> {
    const { app, config, log, trace, onBound } = deps;

    return new Promise<StartResult>((resolve, reject) => {
        const tryListen = (currentPort: number, attempt: number) => {
            if (attempt >= MAX_PORT_RETRY_ATTEMPTS) {
                reject(new Error('No ports available'));
                return;
            }

            const server = app.listen(currentPort, '127.0.0.1', () => {
                onBound(currentPort, server);
                log(`🌐 Gateway running on http://127.0.0.1:${currentPort}`);
                if (currentPort < BRIDGE_PORT_RANGE_START || currentPort > BRIDGE_PORT_RANGE_END) {
                    log(`⚠️ Port ${currentPort} is outside the browser bridge supported range ${BRIDGE_PORT_RANGE_START}-${BRIDGE_PORT_RANGE_END}. The browser extension will not inject on this port; check the webcodeGateway.port setting.`);
                }
                trace({
                    event: 'gateway_started',
                    status: 'success',
                    details: { port: currentPort }
                });
                vscode.window.setStatusBarMessage(`MCP Gateway: On (${currentPort})`, 5000);
                resolve({ port: currentPort });
            });

            server.on('error', (e: NodeJS.ErrnoException) => {
                if (e.code === 'EADDRINUSE') {
                    // Fix: Prevent infinite loop if preferredPort equals config.port
                    if (config.preferredPort && currentPort === config.preferredPort && currentPort !== config.port) {
                        log(`⚠️ Preferred port ${currentPort} busy. Falling back to default range.`);
                        tryListen(config.port, 0);
                    } else {
                        tryListen(currentPort + 1, attempt + 1);
                    }
                } else {
                    reject(e);
                }
            });
        };

        if (config.preferredPort && config.preferredPort !== config.port) {
            tryListen(config.preferredPort, 0);
        } else {
            tryListen(config.port, 0);
        }
    });
}
