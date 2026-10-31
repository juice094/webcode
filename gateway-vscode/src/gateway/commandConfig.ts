import type { GatewayConfig } from './types';

/**
 * Resolves the command-related slice of the gateway config into the flat field
 * shape the manager stores. Kept outside the manager so the class stays under
 * the file length budget; apply with `Object.assign(this, resolveCommandConfig(config))`.
 */
export function resolveCommandConfig(config: GatewayConfig): {
    commandShellPath: string | undefined;
    commandAllowedRoots: string[];
    commandDenyRules: string[];
    commandAllowRules: string[];
    commandRequireApproval: boolean;
} {
    const commandShellPath = config.commandShellPath?.trim();
    return {
        commandShellPath: commandShellPath === '' ? undefined : commandShellPath,
        commandAllowedRoots: config.commandAllowedRoots ?? [],
        commandDenyRules: config.commandDenyRules ?? [],
        commandAllowRules: config.commandAllowRules ?? [],
        commandRequireApproval: config.commandRequireApproval ?? true
    };
}
