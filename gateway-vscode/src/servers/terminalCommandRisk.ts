import {
    assessParsedShellCommandRisk,
    CommandRiskError,
    type CommandRiskAssessment,
    type CommandRiskContext
} from './commandRisk';
import { assessCommandDenyRules } from './commandDenyRules';
import { combineRiskIssues } from './commandRiskTypes';
import { parseShellCommand } from './shellCommandParser';
import type { TerminalShellKind } from './terminalProfiles';

export function assessTerminalCommandRisk(
    command: string,
    shellKind: TerminalShellKind,
    context: CommandRiskContext = {}
): CommandRiskAssessment {
    // Deny rules match the raw command line, so they are evaluated before parsing
    // and short-circuit: nothing else can downgrade a blocked hit.
    const denied = assessCommandDenyRules(command, context.denyRules);
    if (denied.length > 0) {
        return combineRiskIssues(denied);
    }

    return assessParsedShellCommandRisk(parseShellCommand(command, shellKind), context);
}

export function assertTerminalCommandRiskAllowed(
    command: string,
    shellKind: TerminalShellKind,
    context: CommandRiskContext = {}
): void {
    const assessment = assessTerminalCommandRisk(command, shellKind, context);
    if (assessment.level === 'blocked') {
        throw new CommandRiskError(assessment);
    }
}
