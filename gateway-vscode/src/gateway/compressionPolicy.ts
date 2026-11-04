import * as vscode from 'vscode';

import {
    resolveCompressionMode,
    resolveMaxResultChars,
    type CompressionPolicy
} from '../tools/resultCompression';

/**
 * Reads the webcodeGateway.compression.* settings for one tool call. Called
 * per call (not cached on the gateway) so settings edits apply immediately
 * without a gateway restart; invalid values fall back to documented defaults.
 */
export function readToolResultCompressionPolicy(): CompressionPolicy {
    const config = vscode.workspace.getConfiguration('webcodeGateway');
    return {
        mode: resolveCompressionMode(config.get('compression.toolResult')),
        maxResultChars: resolveMaxResultChars(config.get('compression.maxResultChars'))
    };
}
