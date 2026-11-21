import { describe, expect, it } from 'vitest';
import { autoBackupFileName, filesToPrune, isAutoBackupFileName, isDue } from './auto-backup';

/** Local time, like the user's clock. */
const d = (text: string) => new Date(text);

describe('isDue', () => {
  it('is due when no automatic backup ran yet', () => {
    expect(isDue(undefined, 'week', d('2026-11-21T10:00'))).toBe(true);
  });

  it('daily: once per calendar day', () => {
    const last = d('2026-11-21T08:00').toISOString();
    expect(isDue(last, 'day', d('2026-11-21T23:00'))).toBe(false);
    expect(isDue(last, 'day', d('2026-11-22T00:05'))).toBe(true);
  });

  it('weekly: seven calendar days later, whatever the hour', () => {
    const last = d('2026-11-14T20:00').toISOString();
    expect(isDue(last, 'week', d('2026-11-20T23:59'))).toBe(false);
    expect(isDue(last, 'week', d('2026-11-21T09:00'))).toBe(true);
  });

  it('monthly: same day next month, or its last day', () => {
    const last = d('2026-01-31T10:00').toISOString();
    expect(isDue(last, 'month', d('2026-02-27T10:00'))).toBe(false);
    expect(isDue(last, 'month', d('2026-02-28T00:01'))).toBe(true);
  });

  it('monthly: across the end of the year', () => {
    const last = d('2026-12-15T10:00').toISOString();
    expect(isDue(last, 'month', d('2027-01-14T23:00'))).toBe(false);
    expect(isDue(last, 'month', d('2027-01-15T00:00'))).toBe(true);
  });
});

describe('file names', () => {
  it('names the file by local date and time, marking encrypted ones', () => {
    expect(autoBackupFileName(d('2026-11-21T12:30'), true)).toBe(
      'faturometro-auto-2026-11-21-1230-cifrado.zip',
    );
    expect(autoBackupFileName(d('2026-03-05T07:04'), false)).toBe(
      'faturometro-auto-2026-03-05-0704.zip',
    );
  });

  it('recognises only automatic backups', () => {
    expect(isAutoBackupFileName('faturometro-auto-2026-11-21-1230.zip')).toBe(true);
    expect(isAutoBackupFileName('faturometro-auto-2026-11-21-1230-cifrado.zip')).toBe(true);
    expect(isAutoBackupFileName('faturometro-2026-11-21.zip')).toBe(false);
    expect(isAutoBackupFileName('faturometro-auto-2026-11-21-1230.zip.bak')).toBe(false);
    expect(isAutoBackupFileName('notas.txt')).toBe(false);
  });
});

describe('filesToPrune', () => {
  it('drops the oldest automatic backups beyond the kept number, and nothing else', () => {
    const names = [
      'faturometro-auto-2026-11-21-1230-cifrado.zip',
      'faturometro-auto-2026-10-01-0900.zip',
      'notas.txt',
      'faturometro-auto-2026-11-14-1000-cifrado.zip',
      'faturometro-2026-11-21.zip',
      'faturometro-auto-2026-11-07-1000.zip',
      'faturometro-auto-2026-10-31-2359-cifrado.zip',
      'faturometro-auto-2026-10-24-1000-cifrado.zip',
    ];
    expect(filesToPrune(names, 5)).toEqual(['faturometro-auto-2026-10-01-0900.zip']);
    expect(filesToPrune(names, 3)).toEqual([
      'faturometro-auto-2026-10-01-0900.zip',
      'faturometro-auto-2026-10-24-1000-cifrado.zip',
      'faturometro-auto-2026-10-31-2359-cifrado.zip',
    ]);
  });

  it('keeps everything while under the limit', () => {
    expect(filesToPrune(['faturometro-auto-2026-11-21-1230.zip'], 5)).toEqual([]);
  });
});
