/**
 * Automatic backups to a folder the user chose: when the next one is due and
 * which files are ours. Pure: no React, no database, no file system.
 * Dates are the user's local calendar, like the times they see.
 */

export type AutoBackupEvery = 'day' | 'week' | 'month';
/** How many automatic backups to keep in the folder. */
export const AUTO_BACKUP_KEEP = [3, 5, 10] as const;
export type AutoBackupKeep = (typeof AUTO_BACKUP_KEEP)[number];

const PREFIX = 'faturometro-auto-';
const NAME = /^faturometro-auto-(\d{4}-\d{2}-\d{2}-\d{4})(-cifrado)?\.zip$/;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The same day of the next month; a shorter month uses its last day. */
function nextMonthDay(date: Date): Date {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + 1, Math.min(date.getDate(), lastDay));
}

export function isDue(lastRunAt: string | undefined, every: AutoBackupEvery, now: Date): boolean {
  if (!lastRunAt) return true;
  const last = startOfDay(new Date(lastRunAt));
  if (Number.isNaN(last.getTime())) return true;
  const due =
    every === 'day'
      ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
      : every === 'week'
        ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7)
        : nextMonthDay(last);
  return now.getTime() >= due.getTime();
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

export function autoBackupFileName(now: Date, encrypted: boolean): string {
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${PREFIX}${stamp}${encrypted ? '-cifrado' : ''}.zip`;
}

export function isAutoBackupFileName(name: string): boolean {
  return NAME.test(name);
}

/** The oldest automatic backups beyond `keep`, oldest first; other files are never listed. */
export function filesToPrune(names: readonly string[], keep: number): string[] {
  const ours = names
    .map((name) => ({ name, stamp: NAME.exec(name)?.[1] }))
    .filter((entry): entry is { name: string; stamp: string } => entry.stamp !== undefined)
    .sort((a, b) => a.stamp.localeCompare(b.stamp) || a.name.localeCompare(b.name));
  return ours.slice(0, Math.max(0, ours.length - keep)).map((entry) => entry.name);
}
