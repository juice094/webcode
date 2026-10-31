import { normalizeDenyText } from './commandDenyRules';

/**
 * User-configured approval exemptions. Matching mirrors deny rules on purpose:
 * the command line and every rule are lowercased with whitespace collapsed,
 * then the rule is matched as a substring. A hit downgrades a
 * `requires_confirmation` assessment to `allowed`; it never overrides
 * `blocked` (deny rules and hard-coded policy blocks still win).
 */
export function matchesCommandAllowRule(
    commandLine: string,
    allowRules: readonly string[] | undefined
): string | null {
    if (!allowRules || allowRules.length === 0) {
        return null;
    }

    const normalizedCommand = normalizeDenyText(commandLine);
    if (!normalizedCommand) {
        return null;
    }

    const matched = allowRules.find(rule => {
        const normalizedRule = normalizeDenyText(rule);
        return normalizedRule !== '' && normalizedCommand.includes(normalizedRule);
    });

    return matched ? matched.trim() : null;
}
