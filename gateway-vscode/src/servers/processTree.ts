import { spawn } from 'child_process';

/**
 * Cross-platform termination of a spawned process and its descendants.
 *
 * On POSIX a detached child leads its own process group, so a negative pid
 * reaches every descendant at once. Windows has no process-group signal, so we
 * fall back to `taskkill /T /F`, which walks the parent/child tree itself.
 *
 * The helper never throws: terminating an already-dead pid, or one whose group
 * the OS has already reaped, is a no-op. Callers must still guard against
 * `child.pid === undefined` (spawn failed before a pid was assigned).
 */
export type KillProcessTreeOptions = {
    /** Test seam: invoked instead of the real OS calls. */
    platform?: NodeJS.Platform;
};

export function killProcessTree(pid: number, options: KillProcessTreeOptions = {}): void {
    if (!Number.isInteger(pid) || pid <= 0) {
        return;
    }

    const platform = options.platform ?? process.platform;
    if (platform === 'win32') {
        killWindowsProcessTree(pid);
        return;
    }

    killPosixProcessGroup(pid);
}

function killPosixProcessGroup(pid: number): void {
    try {
        // Negative pid targets the whole process group led by `pid`.
        process.kill(-pid, 'SIGKILL');
    } catch (error) {
        // ESRCH: the group already exited; EPERM: not our child. Either way the
        // process is not ours to manage anymore, so a fallback single kill is
        // best-effort and a second failure is ignored on purpose.
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            void error;
        }
    }
}

function killWindowsProcessTree(pid: number): void {
    try {
        const taskkill = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore'
        });
        // Detach from our event loop; taskkill owns its own short lifetime.
        taskkill.unref();
        taskkill.on('error', () => undefined);
    } catch {
        // taskkill missing or spawn rejected synchronously: nothing else to try.
    }
}
