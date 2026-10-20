/**
 * Command ids shared by the command registrations, the status bar, and the
 * `vscode://` deep-link handler. Kept dependency-free so the deep link can be
 * imported (and unit tested) without pulling in the command UI modules.
 */
export const GATEWAY_CONNECT_COMMAND = 'webcode-gateway.connect';
export const GATEWAY_RESTART_COMMAND = 'gateway-vscode.restart';
