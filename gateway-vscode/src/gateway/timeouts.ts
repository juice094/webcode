/**
 * Resolves the user-facing timeout settings exposed under
 * `webcodeGateway.timeouts`. Every resolver mirrors the idle timeout policy in
 * `./idleTimeout`: non-numeric or non-finite input falls back to the documented
 * default, and valid numbers are truncated then clamped into the supported
 * range. A minimum of 0 means the deadline can be disabled.
 */

export const DEFAULT_COMMAND_EXECUTION_MS = 60_000;
export const MIN_COMMAND_EXECUTION_MS = 1_000;
export const MAX_COMMAND_EXECUTION_MS = 1_800_000;

export const DEFAULT_COMMAND_EXECUTION_MAX_MS = 0;
export const MIN_COMMAND_EXECUTION_MAX_MS = 0;
export const MAX_COMMAND_EXECUTION_MAX_MS = 1_800_000;

export const DEFAULT_TOOL_CALL_MS = 0;
export const MIN_TOOL_CALL_MS = 0;
export const MAX_TOOL_CALL_MS = 1_800_000;

export const DEFAULT_BRIDGE_CODE_TTL_SECONDS = 120;
export const MIN_BRIDGE_CODE_TTL_SECONDS = 30;
export const MAX_BRIDGE_CODE_TTL_SECONDS = 600;

export const DEFAULT_APPROVAL_TTL_SECONDS = 120;
export const MIN_APPROVAL_TTL_SECONDS = 30;
export const MAX_APPROVAL_TTL_SECONDS = 900;

export const DEFAULT_BROWSER_LAUNCH_WAIT_MS = 10_000;
export const MIN_BROWSER_LAUNCH_WAIT_MS = 3_000;
export const MAX_BROWSER_LAUNCH_WAIT_MS = 60_000;

export const DEFAULT_BRIDGE_REQUEST_MS = 0;
export const MIN_BRIDGE_REQUEST_MS = 0;
export const MAX_BRIDGE_REQUEST_MS = 1_800_000;

function resolveClampedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

/**
 * Deadline for `execute_command`. Inherits the existing 60000 ms default of the
 * tool and becomes the user-facing ceiling that replaces the previous 120000 ms
 * hard-coded schema maximum.
 */
export function resolveCommandExecutionMs(value: unknown): number {
    return resolveClampedInteger(value, DEFAULT_COMMAND_EXECUTION_MS, MIN_COMMAND_EXECUTION_MS, MAX_COMMAND_EXECUTION_MS);
}

/**
 * Deadline for one gateway-handled tool call, including third-party MCP tools.
 * Derived: 0 disables the deadline on purpose. The idle watchdog already bounds
 * in-flight lifetime through MAX_WATCHDOG_POSTPONEMENTS, so a second hard timer
 * would duplicate that guard instead of adding safety.
 */
/**
 * Ceiling for `execute_command`. Unlike `commandExecutionMs`, which only supplies
 * the default a model may override, this value clamps whatever the model asks
 * for. 0 disables the ceiling and preserves the pre-setting behavior.
 */
export function resolveCommandExecutionMaxMs(value: unknown): number {
    return resolveClampedInteger(
        value,
        DEFAULT_COMMAND_EXECUTION_MAX_MS,
        MIN_COMMAND_EXECUTION_MAX_MS,
        MAX_COMMAND_EXECUTION_MAX_MS
    );
}

/**
 * Single place where the effective `execute_command` deadline is computed, so the
 * schema the model sees and the timeout actually applied cannot drift apart.
 */
export function resolveCommandExecutionTimeoutMs(
    requested: unknown,
    defaultMs: number,
    maxMs: unknown
): number {
    const value = typeof requested === 'number' && Number.isFinite(requested) ? requested : defaultMs;
    const cap = resolveCommandExecutionMaxMs(maxMs);
    return cap > 0 ? Math.min(value, cap) : value;
}

export function resolveToolCallMs(value: unknown): number {
    return resolveClampedInteger(value, DEFAULT_TOOL_CALL_MS, MIN_TOOL_CALL_MS, MAX_TOOL_CALL_MS);
}

/**
 * Lifetime of a single-use bridge code. QA-calibrated at 120 s: returning from
 * the browser store page plus a cold isolated-browser start overran the
 * previous 60 s code lifetime, so the default doubles it.
 */
export function resolveBridgeCodeTtlSeconds(value: unknown): number {
    return resolveClampedInteger(
        value,
        DEFAULT_BRIDGE_CODE_TTL_SECONDS,
        MIN_BRIDGE_CODE_TTL_SECONDS,
        MAX_BRIDGE_CODE_TTL_SECONDS
    );
}

/**
 * Lifetime of a command approval challenge and of the approval token issued
 * from it. Inherits the existing 2 minute TTL of CommandApprovalManager.
 */
export function resolveApprovalTtlSeconds(value: unknown): number {
    return resolveClampedInteger(
        value,
        DEFAULT_APPROVAL_TTL_SECONDS,
        MIN_APPROVAL_TTL_SECONDS,
        MAX_APPROVAL_TTL_SECONDS
    );
}

/**
 * How long to wait for an isolated browser to expose its bridge process after
 * launch. Inherits the existing 10000 ms wait in processDetection.
 */
export function resolveBrowserLaunchWaitMs(value: unknown): number {
    return resolveClampedInteger(
        value,
        DEFAULT_BROWSER_LAUNCH_WAIT_MS,
        MIN_BROWSER_LAUNCH_WAIT_MS,
        MAX_BROWSER_LAUNCH_WAIT_MS
    );
}

/**
 * Deadline for browser-to-gateway tool requests issued by the bridge extension.
 * Derived: 0 disables the deadline, matching the tool call deadline so a long
 * local command is not cut off by the browser side first.
 */
export function resolveBridgeRequestMs(value: unknown): number {
    return resolveClampedInteger(value, DEFAULT_BRIDGE_REQUEST_MS, MIN_BRIDGE_REQUEST_MS, MAX_BRIDGE_REQUEST_MS);
}
