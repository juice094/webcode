import type { CommandRiskIssue } from './commandRiskTypes';

/**
 * User-configured hard denials. Matching is deliberately dumb: the command line
 * and every rule are lowercased with whitespace collapsed, then the rule is
 * matched as a substring. That keeps nested and quoted forms (`bash -c "git push
 * --force"`) blocked without a second parser, and it is the reason a short rule
 * like `test` also blocks `git commit -m "test"`.
 *
 * A hit is `blocked`, which `combineRiskIssues` cannot downgrade: the gateway
 * refuses to issue an approval challenge, so no browser-side allow rule and no
 * approval token can override it.
 */
export function normalizeDenyText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function assessCommandDenyRules(
    commandLine: string,
    denyRules: readonly string[] | undefined
): CommandRiskIssue[] {
    if (!denyRules || denyRules.length === 0) {
        return [];
    }

    const normalizedCommand = normalizeDenyText(commandLine);
    if (!normalizedCommand) {
        return [];
    }

    const matched = denyRules.find(rule => {
        const normalizedRule = normalizeDenyText(rule);
        return normalizedRule !== '' && normalizedCommand.includes(normalizedRule);
    });

    return matched
        ? [{ level: 'blocked', reason: `Command matches the configured deny rule "${matched.trim()}".` }]
        : [];
}
