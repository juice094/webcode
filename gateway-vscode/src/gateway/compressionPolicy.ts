import {
    resolveCompressionMode,
    resolveMaxResultChars,
    type CompressionPolicy
} from '../tools/resultCompression';
import type { ConfigStore } from '../host/types';

/**
 * Reads the webcodeGateway.compression.* settings for one tool call. Called
 * per call (not cached on the gateway) so settings edits apply immediately
 * without a gateway restart; invalid values fall back to documented defaults.
 * The ConfigStore is injected by the gateway (host layer); schema defaults
 * live in package.json contributes.configuration.
 */
export function readToolResultCompressionPolicy(store: ConfigStore): CompressionPolicy {
    return {
        mode: resolveCompressionMode(store.get('compression.toolResult')),
        maxResultChars: resolveMaxResultChars(store.get('compression.maxResultChars'))
    };
}
