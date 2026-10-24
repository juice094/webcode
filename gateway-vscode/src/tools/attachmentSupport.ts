import * as path from 'path';
import { isUtf8 } from 'buffer';
import type { ToolResult } from './types';

export const ATTACH_FILE_MAX_BYTES = 20 * 1024 * 1024;

export type SupportedAttachment = {
    extensions: readonly string[];
    mimeType: string;
    matches: (content: Buffer) => boolean;
};

const SUPPORTED_ATTACHMENTS: readonly SupportedAttachment[] = [
    {
        extensions: ['.txt'],
        mimeType: 'text/plain',
        matches: content => isUtf8(content)
    },
    {
        extensions: ['.png'],
        mimeType: 'image/png',
        matches: content => startsWithBytes(content, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    },
    {
        extensions: ['.jpg', '.jpeg'],
        mimeType: 'image/jpeg',
        matches: content => startsWithBytes(content, [0xFF, 0xD8, 0xFF])
    },
    {
        extensions: ['.webp'],
        mimeType: 'image/webp',
        matches: content => content.length >= 12 &&
            content.subarray(0, 4).toString('ascii') === 'RIFF' &&
            content.subarray(8, 12).toString('ascii') === 'WEBP'
    },
    {
        extensions: ['.gif'],
        mimeType: 'image/gif',
        matches: content => {
            const signature = content.subarray(0, 6).toString('ascii');
            return signature === 'GIF87a' || signature === 'GIF89a';
        }
    },
    {
        extensions: ['.pdf'],
        mimeType: 'application/pdf',
        matches: content => content.subarray(0, Math.min(content.length, 1024)).includes(Buffer.from('%PDF-', 'ascii'))
    }
];

/**
 * 只有这些扩展名才会被路由为附件。
 * read_file 用它判断是否需要离开文本读取路径。
 */
export const ATTACHMENT_EXTENSIONS: readonly string[] = Array.from(
    new Set(SUPPORTED_ATTACHMENTS.flatMap(candidate => candidate.extensions))
);

// .txt 虽然可以被 attach_file 投递，但 read_file 的文本读取路径已经能处理它，
// 因此不参与附件路由，否则会抢走普通文本读取。
const TEXT_READ_EXTENSIONS = new Set(['.txt']);

export function hasAttachmentExtension(relativePath: string): boolean {
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (TEXT_READ_EXTENSIONS.has(extension)) {
        return false;
    }
    return ATTACHMENT_EXTENSIONS.includes(extension);
}

export function resolveSupportedAttachment(
    toolName: string,
    relativePath: string,
    content: Buffer
): SupportedAttachment {
    const extension = path.posix.extname(relativePath).toLowerCase();
    const attachment = SUPPORTED_ATTACHMENTS.find(candidate => candidate.extensions.includes(extension));
    if (!attachment) {
        throw new Error(`${toolName} supports only TXT, PNG, JPEG, WebP, GIF, and PDF files.`);
    }
    if (!attachment.matches(content)) {
        throw new Error(`File content does not match the ${extension || 'requested'} attachment type.`);
    }
    return attachment;
}

export function createAttachmentResult(details: {
    base64: string;
    bytes: number;
    fileName: string;
    mimeType: string;
    relativePath: string;
}): ToolResult {
    return {
        content: [
            {
                type: 'text',
                text: `Prepared workspace file "${details.relativePath}" (${details.mimeType}, ${formatBytes(details.bytes)}) ` +
                    'for browser attachment delivery. Inspect the delivered attachment before continuing.'
            },
            {
                type: 'resource',
                resource: {
                    uri: createWorkspaceResourceUri(details.relativePath),
                    mimeType: details.mimeType,
                    blob: details.base64,
                    _meta: {
                        fileName: details.fileName,
                        bytes: details.bytes
                    }
                }
            }
        ]
    };
}

function createWorkspaceResourceUri(relativePath: string): string {
    const encodedPath = relativePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
    return `workspace:///${encodedPath}`;
}

function startsWithBytes(content: Buffer, signature: readonly number[]): boolean {
    return content.length >= signature.length && signature.every((value, index) => content[index] === value);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
