/**
 * Consumption profile from an E-Redes export (docs/eredes-xlsx.md): the
 * quarter hours are summed per Lisbon day and split by the periods of every
 * cycle and map (docs/time-cycles.md), so the comparator can price any ERSE
 * cycle with the real consumption, and the quarter hours need not be stored.
 */
import { lisbonDate, type EpochSeconds } from '../lib/lisbon-time';
import type { AnnualUsage } from './compare';
import {
  meterPeriod,
  METER_CYCLES,
  PERIODS_MAPS,
  type MeterCycle,
  type MeterPeriod,
  type PeriodsMap,
} from './time-cycles';
import type { ConsumptionDay, ConsumptionProfile, PeriodSplit } from './types';

const YEAR = 365;
/** Fewer days in the last year and the invoices are used instead (PLAN.md §8). */
export const PROFILE_MIN_DAYS = 330;

export interface Quarter {
  /** Start of the quarter hour. */
  ts: EpochSeconds;
  /** Whole Wh. */
  energyWh: number;
  estimated: boolean;
}

const emptySplit = (): PeriodSplit => ({ empty: 0, full: 0, peak: 0 });

function emptyDay(date: string): ConsumptionDay {
  return {
    date,
    wh: 0,
    split: {
      'pre-2027': { daily: emptySplit(), weekly: emptySplit() },
      '2027': { daily: emptySplit(), weekly: emptySplit() },
    },
  };
}

/** Daily sums of a file's quarter hours (oldest first). */
export function buildProfile(
  supplyPointId: string,
  quarters: readonly Quarter[],
  missingQuarters: number,
): Pick<ConsumptionProfile, 'supplyPointId' | 'dateFrom' | 'dateTo' | 'days' | 'missingQuarters'> {
  const days = new Map<string, ConsumptionDay>();
  for (const quarter of quarters) {
    const date = lisbonDate(quarter.ts);
    let day = days.get(date);
    if (!day) {
      day = emptyDay(date);
      days.set(date, day);
    }
    day.wh += quarter.energyWh;
    if (quarter.estimated) day.estimatedWh = (day.estimatedWh ?? 0) + quarter.energyWh;
    for (const map of PERIODS_MAPS) {
      for (const cycle of METER_CYCLES) {
        day.split[map][cycle][meterPeriod(quarter.ts, cycle, map)] += quarter.energyWh;
      }
    }
  }
  const sorted = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    supplyPointId,
    dateFrom: sorted[0]?.date ?? '',
    dateTo: sorted.at(-1)?.date ?? '',
    days: sorted,
    missingQuarters,
  };
}

/** The profile's days in the 365 days up to today. */
function lastYear(profile: ConsumptionProfile, today: string): ConsumptionDay[] {
  const since = new Date(`${today}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - YEAR);
  const from = since.toISOString().slice(0, 10);
  return profile.days.filter((day) => day.date > from && day.date <= today);
}

/**
 * Annual kWh from the profile's days in the 365 days up to today, with the
 * split of both cycles for one map; null with fewer than PROFILE_MIN_DAYS.
 */
export function profileUsage(
  profile: ConsumptionProfile,
  map: PeriodsMap,
  today: string,
): AnnualUsage | null {
  const days = lastYear(profile, today);
  if (days.length < PROFILE_MIN_DAYS) return null;

  const scale = YEAR / days.length / 1000;
  let wh = 0;
  const raw: Record<MeterCycle, PeriodSplit> = { daily: emptySplit(), weekly: emptySplit() };
  for (const day of days) {
    wh += day.wh;
    for (const cycle of METER_CYCLES) {
      for (const period of Object.keys(raw[cycle]) as MeterPeriod[]) {
        raw[cycle][period] += day.split[map][cycle][period];
      }
    }
  }
  const kwh = (split: PeriodSplit): PeriodSplit => ({
    empty: split.empty * scale,
    full: split.full * scale,
    peak: split.peak * scale,
  });
  const byCycle = { daily: kwh(raw.daily), weekly: kwh(raw.weekly) };
  return {
    byPeriod: { ...byCycle.daily },
    byCycle,
    total: wh * scale,
    daysCovered: days.length,
    source: { kind: 'eredes', from: profile.dateFrom, to: profile.dateTo, map },
  };
}

export interface ProfileSummary {
  kwh: number;
  days: number;
  /** Share of the kWh that E-Redes estimated, 0–1. */
  estimatedShare: number;
  /** Share in empty hours on the daily cycle, with the current map and with the 2027 one, 0–1. */
  emptyShare: Record<PeriodsMap, number>;
  /** Days in the last 365: the comparator uses the profile from PROFILE_MIN_DAYS. */
  daysInLastYear: number;
}

export function profileSummary(profile: ConsumptionProfile, today: string): ProfileSummary {
  let wh = 0;
  let estimated = 0;
  const empty: Record<PeriodsMap, number> = { 'pre-2027': 0, '2027': 0 };
  for (const day of profile.days) {
    wh += day.wh;
    estimated += day.estimatedWh ?? 0;
    for (const map of PERIODS_MAPS) empty[map] += day.split[map].daily.empty;
  }
  const share = (value: number) => (wh > 0 ? value / wh : 0);
  return {
    kwh: wh / 1000,
    days: profile.days.length,
    estimatedShare: share(estimated),
    emptyShare: { 'pre-2027': share(empty['pre-2027']), '2027': share(empty['2027']) },
    daysInLastYear: lastYear(profile, today).length,
  };
}

const normalized = (id: string) => id.replace(/\s+/g, '').toUpperCase();

/** Same CPE, ignoring the spaces and case of how an invoice prints it. */
export function sameSupplyPoint(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && normalized(a) === normalized(b);
}
