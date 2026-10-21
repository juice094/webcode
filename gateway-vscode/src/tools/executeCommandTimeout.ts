import { MAX_COMMAND_EXECUTION_MS, resolveCommandExecutionMaxMs } from '../gateway/timeouts';

type TimeoutSchemaProperties = Record<string, unknown>;

/**
 * Builds the `timeout` entry of the execute_command input schema. Kept in its own
 * module so unit tests can assert the advertised ceiling without loading the tool
 * (which pulls the vscode runtime through the shell profile listing).
 */
export function buildExecuteCommandTimeoutSchema(
    base: TimeoutSchemaProperties,
    commandExecutionMs: number,
    commandExecutionMaxMs?: number
): TimeoutSchemaProperties {
    const maximum = resolveCommandExecutionMaxMs(commandExecutionMaxMs) || MAX_COMMAND_EXECUTION_MS;
    return {
        ...base,
        default: commandExecutionMs,
        maximum,
        description: `Timeout in milliseconds. Default: ${commandExecutionMs}. Maximum: ${maximum}.`
    };
}
