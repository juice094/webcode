/**
 * Decides whether activation should start the gateway on its own.
 *
 * Auto-start is opt-in: `webcodeGateway.autoStart` defaults to false, which keeps
 * the pre-setting behavior where activating the extension never binds a port.
 * A window without a workspace folder cannot host the gateway (the same rule
 * `GatewayServiceController.start` enforces), so it never auto-starts and no
 * error message is raised during activation.
 */
export function shouldAutoStart(enabled: unknown, hasWorkspaceFolder: boolean): boolean {
    return enabled === true && hasWorkspaceFolder;
}
