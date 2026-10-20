import * as crypto from 'crypto';
import type { CommandRiskAssessment } from './commandRiskTypes';
import type { ToolRiskPreflight } from '../tools/types';

// ponytail: 启发式清单——按文件名/扩展名/目录片段匹配常见凭证载体。
// 不覆盖自定义命名的机密文件（如 secrets.txt）；扩展路径：接入 VS Code
// secretStorage 或 workspace 级配置 allowlist。
const SENSITIVE_FILE_NAMES = new Set([
    '.env',
    '.envrc',
    '.npmrc',
    '.pypirc',
    '.netrc',
    '.htpasswd',
    'credentials',
    'ntuser.dat',
    'id_rsa',
    'id_dsa',
    'id_ecdsa',
    'id_ed25519'
]);

const SENSITIVE_FILE_PREFIXES = [
    '.env.',
    'id_rsa.',
    'id_dsa.',
    'id_ecdsa.',
    'id_ed25519.',
    'credentials.'
];

const SENSITIVE_FILE_EXTENSIONS = new Set([
    '.env',
    '.pem',
    '.key',
    '.ppk',
    '.p12',
    '.pfx',
    '.pkcs12',
    '.kdbx'
]);

const SENSITIVE_DIRECTORY_SEGMENTS = new Set([
    '.ssh',
    '.aws',
    '.gnupg',
    '.kube',
    '.azure'
]);

// 常见的无机密示例模板，命中前缀/扩展名时予以豁免。
const INSENSITIVE_SUFFIXES = ['.example', '.sample', '.template', '.tpl', '.dist', '.pub'];

export function isSensitiveFilePath(requestedPath: string): boolean {
    const segments = requestedPath.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.');
    if (segments.length === 0) {
        return false;
    }

    const fileName = segments[segments.length - 1].toLowerCase();
    if (INSENSITIVE_SUFFIXES.some(suffix => fileName.endsWith(suffix))) {
        return false;
    }
    if (SENSITIVE_DIRECTORY_SEGMENTS.has(fileName)) {
        return true;
    }
    if (SENSITIVE_FILE_NAMES.has(fileName) || SENSITIVE_FILE_PREFIXES.some(prefix => fileName.startsWith(prefix))) {
        return true;
    }

    const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    if (SENSITIVE_FILE_EXTENSIONS.has(extension)) {
        return true;
    }

    return segments.slice(0, -1).some(segment => SENSITIVE_DIRECTORY_SEGMENTS.has(segment.toLowerCase()));
}

export function assessSensitiveFileRisk(
    toolName: string,
    args: Record<string, unknown>
): ToolRiskPreflight {
    const requestedPath = typeof args.path === 'string' ? args.path.trim() : '';
    const sensitive = requestedPath !== '' && isSensitiveFilePath(requestedPath);
    const assessment: CommandRiskAssessment = sensitive
        ? {
            level: 'requires_confirmation',
            reasons: [`Access to sensitive file "${requestedPath}" requires explicit approval.`]
        }
        : { level: 'allowed', reasons: [] };

    const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
        tool: toolName,
        path: requestedPath
    })).digest('hex');

    return { assessment, fingerprint };
}

export function getSensitiveFileApprovalError(
    risk: ToolRiskPreflight,
    approvedFingerprint: string | undefined
): string | null {
    if (risk.assessment.level === 'requires_confirmation' && approvedFingerprint !== risk.fingerprint) {
        return `Approval Required: ${risk.assessment.reasons.join(' ')}`;
    }

    return null;
}
