import { describe, expect, it } from 'vitest';
import { QUARTER_HOUR, startOfLisbonDay } from '../lib/lisbon-time';
import { meterPeriod, type MeterCycle, type PeriodsMap } from './time-cycles';

/** An instant given in Lisbon local time on a day without a clock change at that hour. */
function at(date: string, time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  const start = startOfLisbonDay(date);
  // From local midnight; valid for hours after a spring-forward/fall-back only when noted.
  return start + hours * 3600 + minutes * 60;
}

describe('meterPeriod, current map (docs/time-cycles.md)', () => {
  const map: PeriodsMap = 'pre-2027';

  it('daily cycle in winter', () => {
    // Wednesday 14 January 2026.
    expect(meterPeriod(at('2026-01-14', '07:45'), 'daily', map)).toBe('empty');
    expect(meterPeriod(at('2026-01-14', '08:00'), 'daily', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '08:45'), 'daily', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '09:00'), 'daily', map)).toBe('peak');
    expect(meterPeriod(at('2026-01-14', '10:30'), 'daily', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '18:00'), 'daily', map)).toBe('peak');
    expect(meterPeriod(at('2026-01-14', '20:30'), 'daily', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '22:00'), 'daily', map)).toBe('empty');
    expect(meterPeriod(at('2026-01-14', '23:45'), 'daily', map)).toBe('empty');
  });

  it('daily cycle in summer, the same on weekends', () => {
    // Wednesday 15 July and Sunday 19 July 2026.
    for (const date of ['2026-07-15', '2026-07-19']) {
      expect(meterPeriod(at(date, '10:15'), 'daily', map)).toBe('full');
      expect(meterPeriod(at(date, '10:30'), 'daily', map)).toBe('peak');
      expect(meterPeriod(at(date, '13:00'), 'daily', map)).toBe('full');
      expect(meterPeriod(at(date, '19:30'), 'daily', map)).toBe('peak');
      expect(meterPeriod(at(date, '21:00'), 'daily', map)).toBe('full');
      expect(meterPeriod(at(date, '22:00'), 'daily', map)).toBe('empty');
    }
  });

  it('weekly cycle: weekdays, Saturdays and Sundays', () => {
    // Winter: Wednesday 14, Saturday 17, Sunday 18 January 2026.
    expect(meterPeriod(at('2026-01-14', '06:45'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2026-01-14', '07:00'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '09:30'), 'weekly', map)).toBe('peak');
    expect(meterPeriod(at('2026-01-14', '21:00'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-01-14', '23:45'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-01-17', '09:30'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-01-17', '13:00'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2026-01-17', '18:30'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-01-17', '22:00'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2026-01-18', '19:00'), 'weekly', map)).toBe('empty');
    // Summer: Wednesday 15 and Saturday 18 July 2026.
    expect(meterPeriod(at('2026-07-15', '09:00'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-07-15', '09:15'), 'weekly', map)).toBe('peak');
    expect(meterPeriod(at('2026-07-15', '12:15'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-07-18', '09:00'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2026-07-18', '14:00'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2026-07-18', '20:00'), 'weekly', map)).toBe('full');
  });

  it('a public holiday follows its weekday in BTN', () => {
    // Friday 25 December 2026.
    expect(meterPeriod(at('2026-12-25', '09:30'), 'weekly', map)).toBe('peak');
  });

  it('uses the legal time of each instant on the 23-hour day (29 March 2026)', () => {
    const start = startOfLisbonDay('2026-03-29');
    // 00:30 local is still winter time; 8:00 local (07:00 UTC) is summer time.
    expect(meterPeriod(start + 30 * 60, 'daily', map)).toBe('empty');
    expect(meterPeriod(Date.UTC(2026, 2, 29, 7) / 1000, 'daily', map)).toBe('full');
    expect(meterPeriod(Date.UTC(2026, 2, 29, 6, 45) / 1000, 'daily', map)).toBe('empty');
    // Monday after: summer weekday peak from 9:15 local (08:15 UTC).
    expect(meterPeriod(Date.UTC(2026, 2, 30, 8, 15) / 1000, 'weekly', map)).toBe('peak');
    expect(meterPeriod(Date.UTC(2026, 2, 30, 8) / 1000, 'weekly', map)).toBe('full');
  });

  it('uses the legal time of each instant on the 25-hour day (25 October 2026)', () => {
    // Both 01:00–02:00 local hours are empty; 09:00 UTC is 9:00 winter time: peak.
    expect(meterPeriod(Date.UTC(2026, 9, 25, 0, 30) / 1000, 'daily', map)).toBe('empty');
    expect(meterPeriod(Date.UTC(2026, 9, 25, 1, 30) / 1000, 'daily', map)).toBe('empty');
    expect(meterPeriod(Date.UTC(2026, 9, 25, 8) / 1000, 'daily', map)).toBe('full');
    expect(meterPeriod(Date.UTC(2026, 9, 25, 9) / 1000, 'daily', map)).toBe('peak');
    // The day before (summer), 9:00 local was 08:00 UTC and still full.
    expect(meterPeriod(Date.UTC(2026, 9, 24, 8) / 1000, 'daily', map)).toBe('full');
  });
});

describe('meterPeriod, new map (Diretiva 3/2026)', () => {
  const map: PeriodsMap = '2027';

  it('daily cycle is the same all year', () => {
    for (const date of ['2028-01-12', '2028-07-12']) {
      expect(meterPeriod(at(date, '08:15'), 'daily', map)).toBe('empty');
      expect(meterPeriod(at(date, '08:30'), 'daily', map)).toBe('full');
      expect(meterPeriod(at(date, '17:30'), 'daily', map)).toBe('peak');
      expect(meterPeriod(at(date, '21:30'), 'daily', map)).toBe('full');
      expect(meterPeriod(at(date, '22:30'), 'daily', map)).toBe('empty');
    }
  });

  it('weekly cycle: empty from 0:30 on weekdays, Saturday off-empty 17:00–24:00', () => {
    // Wednesday 12 January 2028 (winter) and 12 July 2028 (summer); Saturday 15 January 2028.
    expect(meterPeriod(at('2028-01-12', '00:15'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2028-01-12', '00:30'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2028-01-12', '17:00'), 'weekly', map)).toBe('peak');
    expect(meterPeriod(at('2028-01-12', '22:00'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2028-07-12', '19:30'), 'weekly', map)).toBe('peak');
    expect(meterPeriod(at('2028-07-12', '22:30'), 'weekly', map)).toBe('full');
    expect(meterPeriod(at('2028-01-15', '16:45'), 'weekly', map)).toBe('empty');
    expect(meterPeriod(at('2028-01-15', '17:00'), 'weekly', map)).toBe('full');
  });
});

describe('the new map keeps the length of every period (Diretiva 3/2026)', () => {
  /** Minutes of each period over one Lisbon day, by quarter hour. */
  function minutesByPeriod(date: string, cycle: MeterCycle, map: PeriodsMap) {
    const totals = { empty: 0, full: 0, peak: 0 };
    const start = startOfLisbonDay(date);
    for (let ts = start; ts < start + 24 * 3600; ts += QUARTER_HOUR) {
      totals[meterPeriod(ts, cycle, map)] += 15;
    }
    return totals;
  }

  // Wednesday, Saturday and Sunday in winter and in summer (days without clock changes).
  const days = ['2026-01-14', '2026-01-17', '2026-01-18', '2026-07-15', '2026-07-18', '2026-07-19'];
  it.each(days)('%s', (date) => {
    for (const cycle of ['daily', 'weekly'] as const) {
      expect(minutesByPeriod(date, cycle, '2027')).toEqual(
        minutesByPeriod(date, cycle, 'pre-2027'),
      );
    }
    expect(minutesByPeriod(date, 'daily', 'pre-2027')).toEqual({
      empty: 600,
      full: 600,
      peak: 240,
    });
  });
});
