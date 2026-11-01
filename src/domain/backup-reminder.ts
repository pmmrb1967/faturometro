/** Without sync, a backup is the only copy that survives losing the browser's data. */
export const BACKUP_REMINDER_DAYS = 30;

const DAY_MS = 86_400_000;

export type BackupStatus =
  { kind: 'none' } | { kind: 'never' } | { kind: 'recent' | 'overdue'; lastBackupAt: string };

export function backupStatus(input: {
  hasData: boolean;
  lastBackupAt?: string | undefined;
  today: string;
}): BackupStatus {
  const { hasData, lastBackupAt, today } = input;
  if (!hasData) return { kind: 'none' };
  if (!lastBackupAt) return { kind: 'never' };
  const days = (Date.parse(today) - Date.parse(lastBackupAt)) / DAY_MS;
  return { kind: days > BACKUP_REMINDER_DAYS ? 'overdue' : 'recent', lastBackupAt };
}
