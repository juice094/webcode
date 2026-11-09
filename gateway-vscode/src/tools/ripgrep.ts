import * as fs from 'fs';
import { getRipgrepBinaryName, getVSCodeRipgrepCandidates } from './searchCodeRipgrepPaths';
import type { ConfigStore } from '../host/types';

export type RipgrepCommand = {
    command: string;
    source: string;
    checkedLocations: string[];
};

/**
 * Host facts ripgrep resolution needs, all injected by the gateway
 * (ToolExecutionContext). Everything is optional: with no host the resolver
 * behaves exactly like the pre-A0 unit-test environment (no configured path,
 * no host app root) and falls through to the PATH lookup.
 */
export interface RipgrepResolutionHost {
    configStore?: ConfigStore;
    editorAppRoot?: string;
}

export class RipgrepUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RipgrepUnavailableError';
    }
}

export function resolveRipgrepCommand(host: RipgrepResolutionHost = {}): RipgrepCommand {
    const checkedLocations: string[] = [];

    const configuredPath = getConfiguredRipgrepPath(host.configStore);
    if (configuredPath) {
        checkedLocations.push(`webcodeGateway.ripgrep.path: ${configuredPath}`);
        if (fs.existsSync(configuredPath)) {
            return {
                command: configuredPath,
                source: 'webcodeGateway.ripgrep.path',
                checkedLocations
            };
        }
    } else {
        checkedLocations.push('webcodeGateway.ripgrep.path: not set');
    }

    const vscodeRipgrepCandidates = getVSCodeRipgrepCandidates(
        host.editorAppRoot,
        process.env.PATH,
        process.platform,
        process.arch
    );

    for (const candidate of vscodeRipgrepCandidates) {
        checkedLocations.push(`VS Code bundled ripgrep: ${candidate}`);
        if (fs.existsSync(candidate)) {
            return {
                command: candidate,
                source: 'VS Code bundled ripgrep',
                checkedLocations
            };
        }
    }

    if (vscodeRipgrepCandidates.length === 0) {
        checkedLocations.push('VS Code bundled ripgrep: vscode.env.appRoot is not available');
    }

    const pathCommand = getRipgrepBinaryName(process.platform);
    checkedLocations.push(`PATH command: ${pathCommand}`);
    return {
        command: pathCommand,
        source: 'PATH',
        checkedLocations
    };
}

export function createRipgrepStartError(error: Error, rgCommand: RipgrepCommand): Error {
    const code = (error as NodeJS.ErrnoException).code;
    const detail = code ? `${error.message} (${code})` : error.message;
    return new RipgrepUnavailableError(
        [
            `Could not start ripgrep from ${rgCommand.source}: ${detail}`,
            `Platform: ${process.platform}-${process.arch}`,
            'Checked:',
            ...rgCommand.checkedLocations.map(location => `- ${location}`),
            'Install ripgrep so rg is on PATH, or set webcodeGateway.ripgrep.path to the absolute path of rg/rg.exe.'
        ].join('\n')
    );
}

function getConfiguredRipgrepPath(store: ConfigStore | undefined): string | undefined {
    // 无宿主（单测）时与 A0 之前 vscodeStub 的行为一致：视作未配置。
    const configuredPath = (store?.get<string>('ripgrep.path', '') ?? '').trim();
    return configuredPath || undefined;
}
