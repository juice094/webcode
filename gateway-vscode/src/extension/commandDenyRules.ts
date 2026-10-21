import type * as vscode from 'vscode';

import { normalizeDenyText } from '../servers/commandDenyRules';

export const MAX_DENY_RULE_COUNT = 64;
export const MAX_DENY_RULE_LENGTH = 200;
export const SHORT_DENY_RULE_LENGTH = 4;

/**
 * Normalizes `webcodeGateway.command.denyRules`. Invalid entries are dropped with
 * a visible warning instead of failing the gateway start: a typo in one rule must
 * not take the whole command surface offline.
 */
export function resolveCommandDenyRules(
    raw: unknown,
    outputChannel: vscode.OutputChannel
): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const rules: string[] = [];
    const seen = new Set<string>();

    for (const entry of raw) {
        if (typeof entry !== 'string') {
            outputChannel.appendLine('⚠️ Ignoring non-string command deny rule.');
            continue;
        }

        const rule = entry.trim();
        if (!rule) {
            continue;
        }
        if (rule.length > MAX_DENY_RULE_LENGTH) {
            outputChannel.appendLine(
                `⚠️ Ignoring command deny rule longer than ${MAX_DENY_RULE_LENGTH} characters: ${rule.slice(0, 40)}…`
            );
            continue;
        }

        const key = normalizeDenyText(rule);
        if (seen.has(key)) {
            continue;
        }
        if (key.length < SHORT_DENY_RULE_LENGTH) {
            outputChannel.appendLine(
                `⚠️ Command deny rule "${rule}" is shorter than ${SHORT_DENY_RULE_LENGTH} characters and will also block unrelated commands.`
            );
        }

        seen.add(key);
        rules.push(rule);
    }

    if (rules.length > MAX_DENY_RULE_COUNT) {
        outputChannel.appendLine(
            `⚠️ Only the first ${MAX_DENY_RULE_COUNT} command deny rules are used; ${rules.length - MAX_DENY_RULE_COUNT} ignored.`
        );
        return rules.slice(0, MAX_DENY_RULE_COUNT);
    }

    return rules;
}
