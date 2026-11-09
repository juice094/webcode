import * as vscode from 'vscode';

/** 工作区文件夹的宿主无关视图（SkillManager 内部 id 需要 display name）。 */
export interface WorkspaceFolderInfo {
    name: string;
    fsPath: string;
}

export function getWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
}

export function getPrimaryWorkspaceRoot(): string | null {
    return getWorkspaceRoots()[0] ?? null;
}

export function getWorkspaceFolderInfos(): WorkspaceFolderInfo[] {
    return (vscode.workspace.workspaceFolders ?? []).map(folder => ({ name: folder.name, fsPath: folder.uri.fsPath }));
}
