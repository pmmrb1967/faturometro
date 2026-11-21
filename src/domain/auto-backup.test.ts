import { describe, expect, it } from 'vitest';
import {
  autoBackupFileName,
  filesToPrune,
  isAutoBackupFileName,
  isDue,
  tempFilesOf,
} from './auto-backup';

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

const TAG = '1a2b3c4d';
const OTHER = '9f8e7d6c';
const auto = (stamp: string, tag = TAG, suffix = '') =>
  `faturometro-auto-${tag}-${stamp}${suffix}.zip`;

describe('file names', () => {
  it('names the file by profile and local date and time, marking encrypted ones', () => {
    expect(autoBackupFileName(d('2026-11-21T12:30'), true, TAG)).toBe(
      'faturometro-auto-1a2b3c4d-2026-11-21-1230-cifrado.zip',
    );
    expect(autoBackupFileName(d('2026-03-05T07:04'), false, TAG)).toBe(
      'faturometro-auto-1a2b3c4d-2026-03-05-0704.zip',
    );
  });

  it('recognises only the automatic backups of this profile', () => {
    expect(isAutoBackupFileName(auto('2026-11-21-1230'), TAG)).toBe(true);
    expect(isAutoBackupFileName(auto('2026-11-21-1230', TAG, '-cifrado'), TAG)).toBe(true);
    expect(isAutoBackupFileName(auto('2026-11-21-1230', OTHER), TAG)).toBe(false);
    expect(isAutoBackupFileName('faturometro-2026-11-21.zip', TAG)).toBe(false);
    expect(isAutoBackupFileName(`${auto('2026-11-21-1230')}.tmp`, TAG)).toBe(false);
    expect(isAutoBackupFileName('notas.txt', TAG)).toBe(false);
  });
});

describe('filesToPrune', () => {
  it('drops the oldest automatic backups beyond the kept number, and nothing else', () => {
    const names = [
      auto('2026-11-21-1230', TAG, '-cifrado'),
      auto('2026-10-01-0900'),
      'notas.txt',
      auto('2026-11-14-1000', TAG, '-cifrado'),
      'faturometro-2026-11-21.zip',
      auto('2026-11-07-1000'),
      auto('2026-10-31-2359', TAG, '-cifrado'),
      auto('2026-10-24-1000', TAG, '-cifrado'),
    ];
    expect(filesToPrune(names, 5, TAG)).toEqual([auto('2026-10-01-0900')]);
    expect(filesToPrune(names, 3, TAG)).toEqual([
      auto('2026-10-01-0900'),
      auto('2026-10-24-1000', TAG, '-cifrado'),
      auto('2026-10-31-2359', TAG, '-cifrado'),
    ]);
  });

  it('never counts nor removes the backups of another profile in the same folder', () => {
    const names = [
      ...['01', '02', '03', '04', '05', '06'].map((day) => auto(`2026-11-${day}-1000`, OTHER)),
      auto('2026-11-07-1000'),
    ];
    expect(filesToPrune(names, 5, TAG)).toEqual([]);
    expect(filesToPrune(names, 5, OTHER)).toEqual([auto('2026-11-01-1000', OTHER)]);
  });

  it('keeps everything while under the limit', () => {
    expect(filesToPrune([auto('2026-11-21-1230')], 5, TAG)).toEqual([]);
  });
});

describe('tempFilesOf', () => {
  it('lists the unfinished writes of this profile only', () => {
    const names = [
      `${auto('2026-11-21-1230')}.tmp`,
      `${auto('2026-11-21-1230', OTHER)}.tmp`,
      auto('2026-11-14-1000'),
      'outro.tmp',
    ];
    expect(tempFilesOf(names, TAG)).toEqual([`${auto('2026-11-21-1230')}.tmp`]);
  });
});
