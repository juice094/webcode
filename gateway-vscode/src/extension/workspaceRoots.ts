import * as vscode from 'vscode';

export function getWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

export function getPrimaryWorkspaceRoot(): string | null {
    return getWorkspaceRoots()[0] ?? null;
}
