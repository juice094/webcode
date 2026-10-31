import * as crypto from 'crypto';

import type { ToolRiskPreflight } from '../tools/types';
import { normalizeShellCommand } from './commandShell';
import { assessTerminalCommandRisk } from './terminalCommandRisk';
import { matchesCommandAllowRule } from './commandAllowRules';
import type { TerminalShellKind } from './terminalProfiles';
import type { CommandRiskContext } from './commandRisk';

export function assessCommandToolRisk(options: {
    command: unknown;
    commandPath: string;
    profileId: string;
    shellKind: TerminalShellKind;
    toolName: 'execute_command' | 'run_in_terminal';
    riskContext: CommandRiskContext;
}): ToolRiskPreflight {
    const commandLine = normalizeShellCommand(options.command);
    let assessment = assessTerminalCommandRisk(commandLine, options.shellKind, options.riskContext);
    if (assessment.level === 'requires_confirmation'
        && (options.riskContext.autoApproveConfirmation
            || matchesCommandAllowRule(commandLine, options.riskContext.allowRules))) {
        // Deliberately mirrors the pass shape so downstream checks treat the
        // command exactly like a policy-clean one. `blocked` never reaches here.
        assessment = { level: 'allowed', reasons: [] };
    }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        command: commandLine,
        path: options.commandPath,
        profile: options.profileId,
        tool: options.toolName
    })).digest('hex');

    return { assessment, fingerprint };
}
