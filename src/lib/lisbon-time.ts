/**
 * Instants as epoch seconds (UTC), read in Europe/Lisbon legal time: the clock
 * of the E-Redes exports and of the ERSE time-of-use periods. Lisbon's offset
 * is always a whole number of hours, so quarter-hour boundaries are the same in
 * UTC and local time. Ported from Wattómetro (src/lib/time.ts).
 */
export type EpochSeconds = number;

export const TIME_ZONE = 'Europe/Lisbon';
export const MINUTE = 60;
export const QUARTER_HOUR = 15 * MINUTE;
export const HOUR = 60 * MINUTE;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertEpoch(ts: EpochSeconds): void {
  if (!Number.isInteger(ts)) throw new TypeError(`Not integer epoch seconds: ${ts}`);
}

/** Calendar fields of an instant in Lisbon. */
export function lisbonParts(ts: EpochSeconds): LocalParts {
  assertEpoch(ts);
  const fields: Record<string, number> = {};
  for (const part of PARTS_FORMAT.formatToParts(new Date(ts * 1000))) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  const { year = 0, month = 0, day = 0, hour = 0, minute = 0 } = fields;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, hour, minute, weekday };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** The Lisbon calendar day of an instant, as 'YYYY-MM-DD'. */
export function lisbonDate(ts: EpochSeconds): string {
  const { year, month, day } = lisbonParts(ts);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function parseDate(date: string): [number, number, number] {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Lisbon's offset from UTC at an instant, in seconds (3600 in summer, 0 in winter). */
export function lisbonOffset(ts: EpochSeconds): number {
  const { year, month, day, hour, minute } = lisbonParts(ts);
  const local = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  return local - (ts - (((ts % MINUTE) + MINUTE) % MINUTE));
}

/**
 * The instant a Lisbon day starts. Clocks change at 01:00 UTC (01:00 or 02:00
 * local), so local midnight always exists, is never repeated, and has the
 * offset of the hour before it.
 */
export function startOfLisbonDay(date: string): EpochSeconds {
  const [year, month, day] = parseDate(date);
  const utcMidnight = Date.UTC(year, month - 1, day) / 1000;
  return utcMidnight - lisbonOffset(utcMidnight - HOUR);
}

/**
 * The instant a Lisbon wall-clock time happens on a day, or null if the clocks
 * skip it (01:00–01:59 on the last Sunday of March). A time that happens twice
 * (01:00–01:59 on the last Sunday of October) gives the first, summer one.
 */
export function lisbonLocalTime(date: string, hour: number, minute: number): EpochSeconds | null {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  // With the offset of midnight, then an hour either way if the clocks changed before it.
  const guess = startOfLisbonDay(date) + hour * HOUR + minute * MINUTE;
  for (const ts of [guess, guess - HOUR, guess + HOUR]) {
    const parts = lisbonParts(ts);
    if (lisbonDate(ts) === date && parts.hour === hour && parts.minute === minute) return ts;
  }
  return null;
}

/**
 * Start of the quarter hour an E-Redes export labels with a Lisbon date and
 * time: the label is the END of the interval (docs/eredes-xlsx.md), so
 * '2025-10-26' '00:00' is 25/10 23:45–24:00. Null for a label that is not a
 * quarter-hour boundary or does not exist.
 */
export function eredesQuarterStart(
  date: string,
  hour: number,
  minute: number,
): EpochSeconds | null {
  if (minute % 15 !== 0) return null;
  const end = lisbonLocalTime(date, hour, minute);
  return end === null ? null : end - QUARTER_HOUR;
}
