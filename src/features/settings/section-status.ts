/**
 * The line next to each block of the settings page, so that the page reads well
 * with every block closed, and whether the block must open by itself.
 */
import type { CloudErrorCode } from '../../cloud/drive';
import type { AutoBackupErrorCode, CloudProvider } from '../../db/profiles';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import type { SyncErrorCode } from '../../sync/account';

export interface BlockStatus {
  text: string;
  /** Something the person must see: the block opens by itself. */
  attention: boolean;
}

const copy = t.settings.status;

export function syncStatus(input: {
  guest: boolean;
  cloud?: CloudProvider;
  server?: boolean;
  error?: SyncErrorCode | CloudErrorCode;
}): BlockStatus {
  if (input.guest) return { text: copy.syncNeedsAccount, attention: false };
  // Offline is not a problem to show: the sync catches up when the connection comes back.
  const problem = input.error && input.error !== 'offline' ? input.error : undefined;
  if (input.cloud) {
    const name = t.sync.cloud.services[input.cloud].name;
    if (problem === 'needs_reconnect') return { text: copy.syncEnded(name), attention: true };
    if (problem) return { text: copy.attention, attention: true };
    return { text: copy.syncCloud(name), attention: false };
  }
  if (input.server) {
    if (problem) return { text: copy.attention, attention: true };
    return { text: copy.syncServer, attention: false };
  }
  return { text: copy.syncOff, attention: Boolean(problem) };
}

export function backupStatus(input: {
  /** Last export (`YYYY-MM-DD`). */
  lastExport?: string;
  /** The automatic copy, when on. */
  auto?: { lastRunAt?: string; lastError?: AutoBackupErrorCode };
}): BlockStatus {
  if (input.auto?.lastError) return { text: copy.autoBackupFailed, attention: true };
  if (input.auto) {
    return {
      text: input.auto.lastRunAt
        ? copy.autoBackupLast(formatIsoDate(input.auto.lastRunAt))
        : copy.autoBackupOn,
      attention: false,
    };
  }
  if (input.lastExport) {
    return { text: copy.lastExport(formatIsoDate(input.lastExport)), attention: false };
  }
  return { text: copy.noBackups, attention: false };
}
