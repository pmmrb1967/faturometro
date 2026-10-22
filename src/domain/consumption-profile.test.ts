import { describe, expect, it } from 'vitest';
import { startOfLisbonDay } from '../lib/lisbon-time';
import {
  buildProfile,
  profileSummary,
  profileUsage,
  sameSupplyPoint,
  type Quarter,
} from './consumption-profile';
import type { ConsumptionProfile } from './types';

const QUARTER = 900;

/** Every quarter hour of `days` Lisbon days from `from`, each with `wh` Wh. */
function quarters(from: string, days: number, wh = 100): Quarter[] {
  const result: Quarter[] = [];
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const stop = startOfLisbonDay(end.toISOString().slice(0, 10));
  for (let ts = startOfLisbonDay(from); ts < stop; ts += QUARTER) {
    result.push({ ts, energyWh: wh, estimated: false });
  }
  return result;
}

function profile(days: ConsumptionProfile['days']): ConsumptionProfile {
  return {
    id: 'p',
    updatedAt: '2026-10-22T00:00:00.000Z',
    supplyPointId: 'PT0000000000000000XX',
    dateFrom: days[0]!.date,
    dateTo: days.at(-1)!.date,
    days,
    missingQuarters: 0,
    importedAt: '2026-10-22T00:00:00.000Z',
  };
}

describe('buildProfile', () => {
  it('sums each Lisbon day and splits it by period, map and cycle (docs/time-cycles.md)', () => {
    // Wednesday 14 January 2026, 100 Wh per quarter hour: 96 quarters = 9,6 kWh.
    const built = buildProfile('PT0000000000000000XX', quarters('2026-01-14', 1), 0);
    expect(built.dateFrom).toBe('2026-01-14');
    expect(built.dateTo).toBe('2026-01-14');
    const [day] = built.days;
    expect(day?.wh).toBe(9600);
    expect(day?.estimatedWh).toBeUndefined();
    // Current daily map: 10 h empty, 10 h full, 4 h peak.
    expect(day?.split['pre-2027'].daily).toEqual({ empty: 4000, full: 4000, peak: 1600 });
    // Current weekly map, weekday in winter: empty 00:00–07:00, peak 09:30–12:00 and 18:30–21:00.
    expect(day?.split['pre-2027'].weekly).toEqual({ empty: 2800, full: 4800, peak: 2000 });
    // New daily map: empty 22:30–08:30 (10 h), peak 17:30–21:30 (4 h).
    expect(day?.split['2027'].daily).toEqual({ empty: 4000, full: 4000, peak: 1600 });
  });

  it('keeps the estimated Wh and the missing quarters', () => {
    const list = quarters('2026-01-14', 1);
    list[0] = { ...list[0]!, estimated: true };
    const built = buildProfile('PT0000000000000000XX', list, 4);
    expect(built.days[0]?.estimatedWh).toBe(100);
    expect(built.missingQuarters).toBe(4);
  });

  it('puts the 23-hour and 25-hour days under their own date', () => {
    const built = buildProfile('PT0000000000000000XX', quarters('2026-03-28', 3), 0);
    expect(built.days.map((day) => [day.date, day.wh])).toEqual([
      ['2026-03-28', 9600],
      ['2026-03-29', 9200],
      ['2026-03-30', 9600],
    ]);
  });
});

describe('profileUsage', () => {
  const year = buildProfile('PT0000000000000000XX', quarters('2025-10-23', 364), 0);

  it('gives a year of kWh with the split of every cycle', () => {
    const usage = profileUsage(profile(year.days), 'pre-2027', '2026-10-22');
    expect(usage?.daysCovered).toBe(364);
    expect(usage?.total).toBeCloseTo(9.6 * 365, 6);
    expect(usage?.byCycle?.daily.empty).toBeCloseTo((usage?.total ?? 0) * (4000 / 9600), 6);
    expect(usage?.byPeriod.empty).toBe(usage?.byCycle?.daily.empty);
    expect(usage?.source).toEqual({
      kind: 'eredes',
      from: '2025-10-23',
      to: '2026-10-21',
      map: 'pre-2027',
    });
  });

  it('only counts the last 365 days', () => {
    const usage = profileUsage(profile(year.days), 'pre-2027', '2027-01-01');
    expect(usage).toBeNull();
  });

  it('needs at least 330 days', () => {
    expect(profileUsage(profile(year.days.slice(0, 329)), 'pre-2027', '2026-09-20')).toBeNull();
    expect(profileUsage(profile(year.days.slice(0, 330)), 'pre-2027', '2026-09-20')).not.toBeNull();
  });
});

describe('profileSummary', () => {
  it('totals, estimated share, empty share with both maps and days in the last year', () => {
    const list = quarters('2026-01-14', 2);
    list[0] = { ...list[0]!, estimated: true };
    const built = buildProfile('PT0000000000000000XX', list, 0);
    const summary = profileSummary(profile(built.days), '2026-10-22');
    expect(summary.kwh).toBe(19.2);
    expect(summary.days).toBe(2);
    expect(summary.estimatedShare).toBeCloseTo(100 / 19_200, 10);
    expect(summary.emptyShare['pre-2027']).toBeCloseTo(4000 / 9600, 10);
    expect(summary.emptyShare['2027']).toBeCloseTo(4000 / 9600, 10);
    expect(summary.daysInLastYear).toBe(2);
    expect(profileSummary(profile(built.days), '2027-06-01').daysInLastYear).toBe(0);
  });
});

describe('sameSupplyPoint', () => {
  it('ignores spaces and case', () => {
    expect(sameSupplyPoint('PT 0002 0000 1234 5678 xy', 'PT0002000012345678XY')).toBe(true);
    expect(sameSupplyPoint('PT0002000012345678XY', 'PT0002000012345678XZ')).toBe(false);
    expect(sameSupplyPoint(undefined, 'PT0002000012345678XY')).toBe(false);
  });
});
