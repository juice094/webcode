import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    formatApprovalAuditEvent,
    type ApprovalAuditEvent
} from '../gateway/approvalAudit';
import { formatLocalDateKey, pruneLogDirectory } from './persistentLog';

/**
 * Appends approval decisions to `logs/approvals-YYYYMMDD.jsonl`, next to the human
 * log and under the same retention window. Every operation is best effort: an
 * audit write must never take down the extension host, so IO failures are dropped
 * exactly like the persistent logger does.
 */
export interface ApprovalAuditLog {
    readonly directory: string;
    append(event: ApprovalAuditEvent): void;
}

export const APPROVAL_AUDIT_FILE_PREFIX = 'approvals-';

export function createApprovalAuditLog(storageRoot: string): ApprovalAuditLog {
    const directory = path.join(storageRoot, 'logs');
    let currentDateKey = '';

    return {
        directory,
        append(event: ApprovalAuditEvent): void {
            try {
                const dateKey = formatLocalDateKey(new Date());
                if (dateKey !== currentDateKey) {
                    fs.mkdirSync(directory, { recursive: true });
                    pruneLogDirectory(directory);
                    currentDateKey = dateKey;
                }
                const filePath = path.join(directory, `${APPROVAL_AUDIT_FILE_PREFIX}${dateKey}.jsonl`);
                fs.appendFileSync(filePath, `${formatApprovalAuditEvent(event)}\n`, 'utf8');
            } catch {
                // Auditing must never break tool execution.
            }
        }
    };
}
