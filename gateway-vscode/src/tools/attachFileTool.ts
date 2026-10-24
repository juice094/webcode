import * as fs from 'fs/promises';
import * as path from 'path';
import type { LocalTool } from './types';
import { errorResult } from './result';
import { WORKSPACE_FILE_PATH_DESCRIPTION, resolveWorkspaceRelativePath } from './workspacePath';
import { assessSensitiveFileRisk, getSensitiveFileApprovalError } from '../servers/sensitivePathPolicy';
import {
    ATTACH_FILE_MAX_BYTES,
    createAttachmentResult,
    formatBytes,
    resolveSupportedAttachment
} from './attachmentSupport';

export { ATTACH_FILE_MAX_BYTES } from './attachmentSupport';

export const attachFileTool: LocalTool = {
    serverId: 'internal',
    definition: {
        name: 'attach_file',
        description: 'Attach a UTF-8 TXT, image, or PDF file from the current VS Code workspace to the AI conversation. ' +
            'Supports TXT, PNG, JPEG, WebP, GIF, and PDF files up to 20 MB. ' +
            'Use read_file instead when only the text contents need inspection.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: WORKSPACE_FILE_PATH_DESCRIPTION }
            },
            required: ['path']
        },
        annotations: { readOnlyHint: true }
    },
    assessRisk: (args) => Promise.resolve(assessSensitiveFileRisk('attach_file', args)),
    async execute(args, context) {
        const risk = assessSensitiveFileRisk('attach_file', args);
        if (getSensitiveFileApprovalError(risk, context.approvedCommandFingerprint)) { return errorResult(`Approval Required: ${risk.assessment.reasons.join(' ')}`); }

        const resolved = await resolveWorkspaceRelativePath(context.workspaceRoot, args.path);
        const stats = await fs.stat(resolved.absolutePath);
        if (!stats.isFile()) {
            throw new Error(`path must point to a file: ${resolved.relativePath}`);
        }
        if (stats.size === 0) {
            throw new Error('attach_file cannot attach an empty file.');
        }
        if (stats.size > ATTACH_FILE_MAX_BYTES) {
            throw new Error(`attach_file supports files up to ${formatBytes(ATTACH_FILE_MAX_BYTES)}.`);
        }

        const content = await fs.readFile(resolved.absolutePath);
        if (content.byteLength > ATTACH_FILE_MAX_BYTES) {
            throw new Error(`attach_file supports files up to ${formatBytes(ATTACH_FILE_MAX_BYTES)}.`);
        }

        const attachment = resolveSupportedAttachment('attach_file', resolved.relativePath, content);
        const fileName = path.posix.basename(resolved.relativePath);
        return createAttachmentResult({
            base64: content.toString('base64'),
            bytes: content.byteLength,
            fileName,
            mimeType: attachment.mimeType,
            relativePath: resolved.relativePath
        });
    }
};

