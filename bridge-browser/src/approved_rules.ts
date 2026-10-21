import { buildStoredApprovalEntries, parseStoredApprovalEntries } from "./content/approval_policy";

/**
 * Approved-rule storage shared by the content script (writes) and the popup
 * (reads, prunes). Rules themselves stay a plain `string[]` under
 * `allowed_tools_<workspaceId>` so older builds keep parsing them; creation times
 * live in a sidecar map keyed by the exact stored rule string.
 */

export interface ApprovedRuleEntry {
  rule: string;
  createdAt: number | null;
}

export const RULES_STORAGE_PREFIX = "allowed_tools_";
export const RULES_META_PREFIX = "allowed_tools_meta_";

export function rulesStorageKey(workspaceId: string): string {
  return `${RULES_STORAGE_PREFIX}${workspaceId}`;
}

export function rulesMetaStorageKey(workspaceId: string): string {
  return `${RULES_META_PREFIX}${workspaceId}`;
}

export function listApprovedRules(rawEntries: unknown, rawMeta: unknown): ApprovedRuleEntry[] {
  const timestamps = readTimestamps(rawMeta);
  return buildStoredApprovalEntries(parseStoredApprovalEntries(rawEntries))
    .map((rule) => ({ rule, createdAt: readTimestamp(timestamps[rule]) }))
    .sort(compareEntries);
}

export function removeApprovedRule(rawEntries: unknown, rule: string): string[] {
  const state = parseStoredApprovalEntries(rawEntries);
  if (rule.startsWith("tool:")) {
    state.allowedTools.delete(rule.slice("tool:".length));
  } else {
    state.allowedCommandRules.delete(rule);
  }
  return buildStoredApprovalEntries(state);
}

export function clearApprovedRules(): string[] {
  return [];
}

/**
 * Keeps known timestamps and stamps newly persisted rules with `now`.
 */
export function withRuleTimestamps(
  rawMeta: unknown,
  rules: readonly string[],
  now: number
): Record<string, number> {
  const timestamps = readTimestamps(rawMeta);
  const next: Record<string, number> = {};
  for (const rule of rules) {
    next[rule] = readTimestamp(timestamps[rule]) ?? now;
  }
  return next;
}

/**
 * Drops timestamps for rules that no longer exist without inventing new ones.
 */
export function pruneRuleTimestamps(
  rawMeta: unknown,
  rules: readonly string[]
): Record<string, number> {
  const timestamps = readTimestamps(rawMeta);
  const next: Record<string, number> = {};
  for (const rule of rules) {
    const createdAt = readTimestamp(timestamps[rule]);
    if (createdAt !== null) {next[rule] = createdAt;}
  }
  return next;
}

function compareEntries(left: ApprovedRuleEntry, right: ApprovedRuleEntry): number {
  const leftTime = left.createdAt ?? Number.NEGATIVE_INFINITY;
  const rightTime = right.createdAt ?? Number.NEGATIVE_INFINITY;
  if (leftTime !== rightTime) {return rightTime > leftTime ? 1 : -1;}
  return left.rule.localeCompare(right.rule);
}

function readTimestamps(rawMeta: unknown): Record<string, unknown> {
  return typeof rawMeta === "object" && rawMeta !== null && !Array.isArray(rawMeta)
    ? rawMeta as Record<string, unknown>
    : {};
}

function readTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
