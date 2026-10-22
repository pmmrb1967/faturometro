/**
 * ERSE time-of-use periods for BTN in mainland Portugal (docs/time-cycles.md).
 * The maps are data (src/data/time-cycles.json): one map per cycle with peak,
 * full and empty hours, in Lisbon legal time; bi-hourly derives from it
 * (off-empty = peak + full). Every boundary is a multiple of 15 minutes, so a
 * quarter hour is classified by its start. Ported from Wattómetro.
 */
import { z } from 'zod';
import raw from '../data/time-cycles.json';
import { HOUR, lisbonOffset, lisbonParts, type EpochSeconds } from '../lib/lisbon-time';

/** Peak, full or empty hours of the meter. */
export type MeterPeriod = 'empty' | 'full' | 'peak';
/** Daily cycle (same every day) or weekly (weekdays, Saturdays and Sundays differ). */
export type MeterCycle = 'daily' | 'weekly';
/** Current map, or the new one of Diretiva ERSE 3/2026 (meters change during 2027). */
export type PeriodsMap = 'pre-2027' | '2027';

export const METER_CYCLES: readonly MeterCycle[] = ['daily', 'weekly'];
export const PERIODS_MAPS: readonly PeriodsMap[] = ['pre-2027', '2027'];

const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

const segmentsSchema = z
  .array(z.tuple([z.string().regex(TIME), z.enum(['empty', 'full', 'peak'])]))
  .min(1)
  .refine((segments) => segments[0]?.[0] === '00:00', 'A day starts at 00:00')
  .transform((segments) =>
    segments.map(([time, period]) => {
      const [hours = 0, minutes = 0] = time.split(':').map(Number);
      return { from: hours * 60 + minutes, period };
    }),
  )
  .refine(
    (segments) => segments.every((s, i) => i === 0 || s.from > (segments[i - 1]?.from ?? 0)),
    'Segments in order',
  );
type Segments = z.infer<typeof segmentsSchema>;

const seasonsSchema = <T extends z.ZodType>(day: T) => z.object({ winter: day, summer: day });

const mapSchema = z.object({
  daily: seasonsSchema(segmentsSchema),
  weekly: seasonsSchema(
    z.object({ weekday: segmentsSchema, saturday: segmentsSchema, sunday: segmentsSchema }),
  ),
});

const fileSchema = z.object({
  schemaVersion: z.literal(1),
  region: z.literal('continente'),
  maps: z.object({ 'pre-2027': mapSchema, '2027': mapSchema }),
});

const MAPS = fileSchema.parse(raw).maps;

function periodIn(segments: Segments, minuteOfDay: number): MeterPeriod {
  let period = segments[0]?.period ?? 'empty';
  for (const segment of segments) {
    if (segment.from > minuteOfDay) break;
    period = segment.period;
  }
  return period;
}

/** Peak, full or empty at an instant, by Lisbon legal time (summer = DST). */
export function meterPeriod(ts: EpochSeconds, cycle: MeterCycle, map: PeriodsMap): MeterPeriod {
  const { hour, minute, weekday } = lisbonParts(ts);
  const season = lisbonOffset(ts) === HOUR ? 'summer' : 'winter';
  const maps = MAPS[map];
  const segments =
    cycle === 'daily'
      ? maps.daily[season]
      : maps.weekly[season][weekday === 0 ? 'sunday' : weekday === 6 ? 'saturday' : 'weekday'];
  return periodIn(segments, hour * 60 + minute);
}
