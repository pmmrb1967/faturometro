import { describe, expect, it } from 'vitest';
import {
  eredesQuarterStart,
  HOUR,
  lisbonDate,
  lisbonLocalTime,
  lisbonOffset,
  lisbonParts,
  startOfLisbonDay,
} from './lisbon-time';

const at = (iso: string) => Date.parse(iso) / 1000;

describe('lisbonParts', () => {
  it('uses WET (UTC+0) in winter and WEST (UTC+1) in summer', () => {
    expect(lisbonParts(at('2026-01-15T12:00:00Z'))).toMatchObject({ hour: 12, weekday: 4 });
    expect(lisbonParts(at('2026-07-15T12:00:00Z'))).toMatchObject({ hour: 13, weekday: 3 });
  });

  it('jumps from 01:00 to 02:00 on 2026-03-29 and repeats 01:00–02:00 on 2026-10-25', () => {
    expect(lisbonParts(at('2026-03-29T00:59:00Z'))).toMatchObject({ hour: 0, minute: 59 });
    expect(lisbonParts(at('2026-03-29T01:00:00Z'))).toMatchObject({ hour: 2, minute: 0 });
    expect(lisbonParts(at('2026-10-25T00:30:00Z'))).toMatchObject({ hour: 1, minute: 30 });
    expect(lisbonParts(at('2026-10-25T01:30:00Z'))).toMatchObject({ hour: 1, minute: 30 });
  });
});

describe('lisbonDate and lisbonOffset', () => {
  it('changes day at local midnight, not UTC midnight', () => {
    expect(lisbonDate(at('2026-07-15T22:59:59Z'))).toBe('2026-07-15');
    expect(lisbonDate(at('2026-07-15T23:00:00Z'))).toBe('2026-07-16');
    expect(lisbonDate(at('2026-01-15T23:59:59Z'))).toBe('2026-01-15');
  });

  it('is 0 in winter and one hour in summer', () => {
    expect(lisbonOffset(at('2026-01-15T12:00:30Z'))).toBe(0);
    expect(lisbonOffset(at('2026-07-15T12:00:30Z'))).toBe(HOUR);
  });
});

describe('startOfLisbonDay', () => {
  it.each([
    ['2026-01-15', '2026-01-15T00:00:00Z'],
    ['2026-07-15', '2026-07-14T23:00:00Z'],
    ['2026-03-29', '2026-03-29T00:00:00Z'],
    ['2026-03-30', '2026-03-29T23:00:00Z'],
    ['2026-10-25', '2026-10-24T23:00:00Z'],
    ['2026-10-26', '2026-10-26T00:00:00Z'],
  ])('%s starts at %s', (date, start) => {
    expect(startOfLisbonDay(date)).toBe(at(start));
  });

  it('rejects malformed dates', () => {
    expect(() => startOfLisbonDay('2026-1-5')).toThrow(RangeError);
  });
});

describe('lisbonLocalTime and eredesQuarterStart (docs/eredes-xlsx.md)', () => {
  it('an ordinary winter and summer time', () => {
    expect(lisbonLocalTime('2026-01-15', 13, 30)).toBe(at('2026-01-15T13:30:00Z'));
    expect(lisbonLocalTime('2026-07-15', 13, 30)).toBe(at('2026-07-15T12:30:00Z'));
  });

  it('the day of 23 h: 01:xx does not exist; 02:00 is the instant of the change', () => {
    expect(lisbonLocalTime('2026-03-29', 1, 15)).toBeNull();
    expect(lisbonLocalTime('2026-03-29', 2, 0)).toBe(at('2026-03-29T01:00:00Z'));
  });

  it('the day of 25 h: the repeated hour gives its first (summer) occurrence', () => {
    expect(lisbonLocalTime('2025-10-26', 1, 15)).toBe(at('2025-10-26T00:15:00Z'));
    expect(lisbonLocalTime('2025-10-26', 2, 0)).toBe(at('2025-10-26T02:00:00Z'));
  });

  it('E-Redes labels mark the end of the quarter hour', () => {
    // '00:00' of a day closes the last quarter of the day before.
    expect(eredesQuarterStart('2025-10-26', 0, 0)).toBe(at('2025-10-25T22:45:00Z'));
    expect(eredesQuarterStart('2025-10-23', 0, 15)).toBe(at('2025-10-22T23:00:00Z'));
    // Day of 23 h: '00:45' then '02:00' are consecutive quarters.
    expect(eredesQuarterStart('2026-03-29', 2, 0)).toBe(at('2026-03-29T00:45:00Z'));
    expect(eredesQuarterStart('2026-03-29', 0, 45)).toBe(at('2026-03-29T00:30:00Z'));
    expect(eredesQuarterStart('2026-03-29', 1, 0)).toBeNull();
    expect(eredesQuarterStart('2026-01-15', 10, 7)).toBeNull();
  });
});
