/**
 * Renders an abort reason as user-facing text.
 *
 * `AbortController.abort()` accepts any value, so the reason can be an Error,
 * a string, or anything else. Every tool that reports an abort uses this helper
 * so the wording stays consistent across execute_command, search_code, and
 * search_files.
 */
export function getAbortReasonText(signal: AbortSignal | undefined): string {
    if (!signal) {
        return 'aborted';
    }
    const reason: unknown = signal.reason;
    if (reason instanceof Error) {
        return reason.message;
    }
    return typeof reason === 'string' && reason ? reason : 'aborted';
}
