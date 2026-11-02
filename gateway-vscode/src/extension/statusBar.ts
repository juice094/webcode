import { BRANDING } from '@webcode/shared';
import * as vscode from 'vscode';

import { t } from '../i18n';

export interface GatewayStatusBarState {
    online: boolean;
    port?: number;
    isLoading?: boolean;
    bridgeConnected?: boolean;
    /** Live browser session count; only rendered when more than one. */
    sessionCount?: number;
}

export function updateGatewayStatusBar(
    statusBarItem: vscode.StatusBarItem,
    state: GatewayStatusBarState
): void {
    if (state.isLoading) {
        statusBarItem.text = t('status_starting');
        statusBarItem.tooltip = t('status_starting_tooltip');
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (state.online && state.port) {
        const sessionCount = state.sessionCount ?? 0;
        const suffix = state.bridgeConnected
            ? ` · ${sessionCount > 1 ? t('status_connected_sessions', { count: sessionCount }) : t('status_connected')}`
            : '';
        statusBarItem.text = `$(rocket) ${BRANDING.productName}: ${state.port}${suffix}`;
        statusBarItem.tooltip = t(state.bridgeConnected ? 'status_connected_tooltip' : 'status_online_tooltip');
        statusBarItem.backgroundColor = undefined;
    } else {
        // Default OFF state
        statusBarItem.text = t('status_offline');
        statusBarItem.tooltip = t('status_offline_tooltip');
        statusBarItem.backgroundColor = undefined;
    }
    statusBarItem.show();
}
