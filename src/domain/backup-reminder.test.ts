import { describe, expect, it } from 'vitest';
import { backupStatus } from './backup-reminder';

const today = '2026-11-01';

describe('backupStatus', () => {
  it('says nothing while there is nothing to save', () => {
    expect(backupStatus({ hasData: false, today })).toEqual({ kind: 'none' });
    expect(backupStatus({ hasData: false, lastBackupAt: '2020-01-01', today })).toEqual({
      kind: 'none',
    });
  });

  it('reminds who has data and never made a backup', () => {
    expect(backupStatus({ hasData: true, today })).toEqual({ kind: 'never' });
  });

  it('shows the date of a recent backup, up to 30 days', () => {
    expect(backupStatus({ hasData: true, lastBackupAt: today, today })).toEqual({
      kind: 'recent',
      lastBackupAt: today,
    });
    expect(backupStatus({ hasData: true, lastBackupAt: '2026-10-02', today })).toEqual({
      kind: 'recent',
      lastBackupAt: '2026-10-02',
    });
  });

  it('reminds from the 31st day on', () => {
    expect(backupStatus({ hasData: true, lastBackupAt: '2026-10-01', today })).toEqual({
      kind: 'overdue',
      lastBackupAt: '2026-10-01',
    });
  });
});
