/** Text and coordinate helpers shared by the layout parsers. */
import { parsePtAmount, type Cents } from '../lib/money';
import type { PageText, TextItem } from '../pdf/text';

export interface Row {
  y: number;
  items: TextItem[];
  /** Items joined left to right with " | ". */
  text: string;
}

/** Groups a page's items into rows (same baseline within `tolerance` points), top to bottom. */
export function rows(page: PageText, tolerance = 2.5): Row[] {
  const sorted = [...page.items].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: Row[] = [];
  for (const item of sorted) {
    const row = result.at(-1);
    if (row && Math.abs(item.y - row.y) <= tolerance) row.items.push(item);
    else result.push({ y: item.y, items: [item], text: '' });
  }
  for (const row of result) {
    row.items.sort((a, b) => a.x - b.x);
    row.text = row.items.map((item) => item.str.trim()).join(' | ');
  }
  return result;
}

export function normalize(text: string): string {
  return text
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findItem(page: PageText, pattern: RegExp): TextItem | undefined {
  return page.items.find((item) => pattern.test(normalize(item.str)));
}

export function findRow(page: PageText, pattern: RegExp): Row | undefined {
  return rows(page).find((row) => pattern.test(row.text));
}

/**
 * The item just below a label (headers laid out as label over value),
 * horizontally aligned with it.
 */
export function valueBelow(page: PageText, label: TextItem, maxGap = 20): TextItem | undefined {
  return page.items
    .filter(
      (item) =>
        item !== label &&
        item.y > label.y + 1 &&
        item.y - label.y <= maxGap &&
        Math.abs(item.x - label.x) <= 6,
    )
    .sort((a, b) => a.y - b.y)[0];
}

/** The first item to the right of a label on the same row. */
export function valueRightOf(page: PageText, label: TextItem): TextItem | undefined {
  return page.items
    .filter((item) => item !== label && Math.abs(item.y - label.y) <= 2.5 && item.x > label.x)
    .sort((a, b) => a.x - b.x)[0];
}

/** "€43,49", "42,79€", "-0,03", "1.234,56 €" → cents. */
export function amount(text: string | undefined): Cents | null {
  if (text === undefined) return null;
  return parsePtAmount(normalize(text).replace(/€/g, ''));
}

/** "0,176159" → "0.176159" (decimal string, no float). */
export function decimalString(text: string): string | null {
  const match = /^-?\d+(?:,\d+)?$/.exec(normalize(text).replace(/\./g, ''));
  return match ? match[0].replace(',', '.') : null;
}

/** "6,90" / "6.90" → 6.9 (non-monetary quantities: kWh, kVA, days). */
export function quantity(text: string): number | null {
  const clean = normalize(text);
  const value = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(clean)
    ? Number(clean.replace(/\./g, '').replace(',', '.'))
    : Number(clean.replace(',', '.'));
  return Number.isFinite(value) && clean !== '' ? value : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026-06-21", "24-09-2026", "24/09/2026", "24.09.2026", "19 out 2026" → ISO date. */
export function date(text: string | undefined): string | null {
  if (text === undefined) return null;
  const clean = normalize(text).toLowerCase();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(clean);
  if (match) return iso(Number(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{1,2}) ([a-zç]{3})[a-zç]* (\d{4})$/.exec(clean);
  if (match) {
    const month = MONTHS[match[2] ?? ''];
    return month ? iso(Number(match[3]), month, Number(match[1])) : null;
  }
  return null;
}

/**
 * A day/month range without year ("22/05 a 21/06", "23 set - 22 out"), with
 * years taken from a reference date: the end is the latest date not after
 * `reference` + `endSlackDays` (ranges may be billed in advance).
 */
export function dayMonthRange(
  text: string,
  reference: string,
  endSlackDays = 62,
): { start: string; end: string } | null {
  const clean = normalize(text).toLowerCase();
  const numeric = /^(\d{1,2})\/(\d{1,2}) a (\d{1,2})\/(\d{1,2})$/.exec(clean);
  const named = /^(\d{1,2}) ([a-zç]{3}) - (\d{1,2}) ([a-zç]{3})$/.exec(clean);
  let parts: [number, number, number, number] | null = null;
  if (numeric) {
    parts = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3]), Number(numeric[4])];
  } else if (named) {
    const startMonth = MONTHS[named[2] ?? ''];
    const endMonth = MONTHS[named[4] ?? ''];
    if (startMonth && endMonth) parts = [Number(named[1]), startMonth, Number(named[3]), endMonth];
  }
  if (!parts) return null;
  const [startDay, startMonth, endDay, endMonth] = parts;

  const limit = new Date(`${reference}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + endSlackDays);
  let endYear = limit.getUTCFullYear();
  let end = iso(endYear, endMonth, endDay);
  if (end && new Date(`${end}T00:00:00Z`) > limit) {
    endYear -= 1;
    end = iso(endYear, endMonth, endDay);
  }
  const startYear = startMonth > endMonth ? endYear - 1 : endYear;
  const start = iso(startYear, startMonth, startDay);
  return start && end ? { start, end } : null;
}

export function addDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
