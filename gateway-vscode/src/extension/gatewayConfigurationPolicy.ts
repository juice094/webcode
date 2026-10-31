/**
 * Classifies webcodeGateway configuration changes into hot and cold restart
 * kinds. Hot changes (tooling and deadline surface only) restart the gateway
 * but preserve the browser bridge session token so connected tabs keep
 * working. Cold changes (connection identity: port, idle timeout, AI sites,
 * browser) keep the legacy behavior of a full restart that revokes the bridge
 * session.
 */

const HOT_RELOAD_KEYS = [
    'webcodeGateway.servers',
    'webcodeGateway.skillDirectories',
    'webcodeGateway.commandShell.path',
    'webcodeGateway.command.allowedRoots',
    'webcodeGateway.command.denyRules',
    'webcodeGateway.command.allowRules',
    'webcodeGateway.command.requireApproval',
    'webcodeGateway.timeouts'
] as const;

const COLD_RESTART_KEYS = [
    'webcodeGateway.port',
    'webcodeGateway.idleTimeoutMinutes',
    'webcodeGateway.aiSites',
    'webcodeGateway.browser'
] as const;

export type GatewayConfigurationChangeKind = 'hot' | 'cold' | 'none';

export function classifyGatewayConfigurationChange(
    affectsConfiguration: (key: string) => boolean
): GatewayConfigurationChangeKind {
    // A cold key always wins when a single change event touches both kinds.
    if (COLD_RESTART_KEYS.some(key => affectsConfiguration(key))) {
        return 'cold';
    }

    if (HOT_RELOAD_KEYS.some(key => affectsConfiguration(key))) {
        return 'hot';
    }

    return 'none';
}
