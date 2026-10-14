/**
 * Daily job (Cron Trigger, server/wrangler.toml): removes accounts inactive
 * for too long, forgets old removal marks and stores usage totals for the
 * admission brake and the weekly alert. Only ids, dates and sizes are touched.
 */
import type { Sql } from './db';

export const INACTIVE_MONTHS = 12;
export const TOMBSTONE_MONTHS = 24;
/** Layout contributions are deleted after this many days, read or not. */
export const CONTRIB_KEEP_DAYS = 90;

export interface MaintenanceConfig {
  sql: Sql;
  files?: Sql;
  adminEmails?: string[];
  inactiveMonths?: number;
  now?: () => Date;
}

export interface UsageStats {
  accounts: number;
  records_bytes: number;
  files_bytes: number;
  computed_at: string;
}

export interface MaintenanceResult {
  removed: number;
  stats: UsageStats;
}

/** `YYYY-MM-DD`, `months` calendar months before `date` (UTC; overflowing days roll over). */
export function monthsBefore(date: Date, months: number): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export async function runMaintenance(config: MaintenanceConfig): Promise<MaintenanceResult> {
  const { sql, files } = config;
  const now = (config.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);

  const inactive = await sql.all<{ id: string }>(
    'SELECT id FROM users WHERE last_seen_at < ? AND email NOT IN (SELECT value FROM json_each(?))',
    monthsBefore(now, config.inactiveMonths ?? INACTIVE_MONTHS),
    JSON.stringify(config.adminEmails ?? []),
  );
  if (inactive.length > 0) {
    // Set-based statements: a handful of queries whatever the number of accounts.
    const ids = JSON.stringify(inactive.map((row) => row.id));
    await files?.run('DELETE FROM chunks WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM records WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM sessions WHERE user_id IN (SELECT value FROM json_each(?))', ids);
    await sql.run('DELETE FROM users WHERE id IN (SELECT value FROM json_each(?))', ids);
    await sql.run(
      'INSERT OR REPLACE INTO removed_accounts (id, removed_at) SELECT value, ? FROM json_each(?)',
      today,
      ids,
    );
  }
  await sql.run(
    'DELETE FROM removed_accounts WHERE removed_at < ?',
    monthsBefore(now, TOMBSTONE_MONTHS),
  );

  await sql.run(
    'DELETE FROM contributions WHERE created_at < ?',
    new Date(now.getTime() - CONTRIB_KEEP_DAYS * 86_400_000).toISOString(),
  );

  const filesBytes =
    (await files?.first<{ total: number | null }>('SELECT SUM(size) AS total FROM chunks'))
      ?.total ?? 0;
  await sql.run(
    `INSERT OR REPLACE INTO stats (id, accounts, records_bytes, files_bytes, computed_at)
     VALUES (1, (SELECT COUNT(*) FROM users),
       (SELECT COALESCE(SUM(LENGTH(enc)), 0) FROM records), ?, ?)`,
    filesBytes,
    now.toISOString(),
  );
  const stats = await sql.first<UsageStats>(
    'SELECT accounts, records_bytes, files_bytes, computed_at FROM stats WHERE id = 1',
  );
  if (!stats) throw new Error('Stats were not stored');
  return { removed: inactive.length, stats };
}
