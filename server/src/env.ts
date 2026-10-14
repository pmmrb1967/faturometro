/** Worker environment (server/wrangler.toml) turned into the app's limits. */
import type { D1Like } from './db';

export interface Env {
  DB: D1Like;
  /** Original files (encrypted chunks), in a database of their own. */
  FILES?: D1Like;
  /** Secret (wrangler secret put PRELOGIN_SECRET). */
  PRELOGIN_SECRET: string;
  /** Comma-separated app origins. */
  ALLOWED_ORIGINS: string;
  /** Secret (wrangler secret put ADMIN_EMAILS): comma-separated administrator emails. */
  ADMIN_EMAILS?: string;
  FILE_QUOTA_MB?: string;
  ADMIN_FILE_QUOTA_MB?: string;
  KEEP_MONTHS?: string;
  RECORD_QUOTA_MB?: string;
  MAX_ACCOUNTS?: string;
  ADMISSION_PERCENT?: string;
  INACTIVE_MONTHS?: string;
}

export interface Limits {
  adminEmails: string[];
  fileQuotaBytes?: number;
  adminFileQuotaBytes?: number;
  keepMonths?: number;
  recordQuotaBytes?: number;
  maxAccounts?: number;
  admissionPercent?: number;
  inactiveMonths?: number;
}

function positive(value: string | undefined): number | undefined {
  const number = Number(value);
  return value !== undefined && Number.isInteger(number) && number > 0 ? number : undefined;
}

function megabytes(value: string | undefined): number | undefined {
  const mb = positive(value);
  return mb === undefined ? undefined : mb * 1_000_000;
}

export function limitsFromEnv(env: Env): Limits {
  const limits: Limits = {
    adminEmails: (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address !== ''),
  };
  const entries: [keyof Omit<Limits, 'adminEmails'>, number | undefined][] = [
    ['fileQuotaBytes', megabytes(env.FILE_QUOTA_MB)],
    ['adminFileQuotaBytes', megabytes(env.ADMIN_FILE_QUOTA_MB)],
    ['keepMonths', positive(env.KEEP_MONTHS)],
    ['recordQuotaBytes', megabytes(env.RECORD_QUOTA_MB)],
    ['maxAccounts', positive(env.MAX_ACCOUNTS)],
    ['admissionPercent', positive(env.ADMISSION_PERCENT)],
    ['inactiveMonths', positive(env.INACTIVE_MONTHS)],
  ];
  for (const [name, value] of entries) if (value !== undefined) limits[name] = value;
  return limits;
}
