export function getErrorMessage(error: unknown): string {
    if (!error) {
        return '';
    }

    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === 'object' && 'message' in error) {
        const message = error.message;
        if (typeof message === 'string') {
            return message;
        }
    }

    return JSON.stringify(error);
}

/** `[HH:MM:SS] message` — the single timestamp format of every gateway log line. */
export function formatLogLine(message: string): string {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    return `[${time}] ${message}`;
}
