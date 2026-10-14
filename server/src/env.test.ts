import { describe, expect, it } from 'vitest';
import { limitsFromEnv } from './env';

const base = { DB: {} as never, PRELOGIN_SECRET: 's', ALLOWED_ORIGINS: 'https://a' };

describe('limitsFromEnv', () => {
  it('reads megabytes, months and counts; normalizes admin emails', () => {
    expect(
      limitsFromEnv({
        ...base,
        ADMIN_EMAILS: ' Ana@Example.pt , ,rui@example.pt',
        FILE_QUOTA_MB: '30',
        ADMIN_FILE_QUOTA_MB: '100',
        KEEP_MONTHS: '12',
        RECORD_QUOTA_MB: '5',
        MAX_ACCOUNTS: '200',
        ADMISSION_PERCENT: '80',
        INACTIVE_MONTHS: '12',
      }),
    ).toEqual({
      adminEmails: ['ana@example.pt', 'rui@example.pt'],
      fileQuotaBytes: 30_000_000,
      adminFileQuotaBytes: 100_000_000,
      keepMonths: 12,
      recordQuotaBytes: 5_000_000,
      maxAccounts: 200,
      admissionPercent: 80,
      inactiveMonths: 12,
    });
  });

  it('leaves missing or invalid values to the code defaults', () => {
    expect(limitsFromEnv({ ...base, FILE_QUOTA_MB: 'abc', KEEP_MONTHS: '-1' })).toEqual({
      adminEmails: [],
    });
  });
});
