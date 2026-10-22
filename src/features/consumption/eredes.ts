/**
 * Reader of the consumption export of the E-Redes Balcão Digital (.xlsx), in the
 * browser: quarter hours with their energy in Wh and whether E-Redes estimated
 * them, plus the CPE (to match the electricity contract). Format and its quirks:
 * docs/eredes-xlsx.md. The meter number is not kept. Ported from Wattómetro.
 */
import { strFromU8, unzipSync } from 'fflate';
import { z } from 'zod';
import { eredesQuarterStart, QUARTER_HOUR, type EpochSeconds } from '../../lib/lisbon-time';

/** Energy in whole watt-hours. */
type Wh = number;

export interface EredesQuarter {
  /** Start of the quarter hour. */
  ts: EpochSeconds;
  energyWh: Wh;
  /** E-Redes estimated it ('Estimada', or no state given). */
  estimated: boolean;
}

export interface EredesFile {
  /** CPE from the file's header, without spaces. */
  supplyPointId: string;
  /** Oldest first, one per quarter hour. */
  quarters: EredesQuarter[];
  energyWh: Wh;
  estimated: number;
  /** Quarter hours missing between the first and the last (e.g. the repeated hour in October). */
  missing: number;
}

export type EredesError =
  /** Not a readable .xlsx file. */
  | 'not_xlsx'
  /** An .xlsx, but not the E-Redes consumption export (other header or unit). */
  | 'not_eredes'
  /** A data row that cannot be read. */
  | 'bad_row'
  /** Two rows for the same quarter hour. */
  | 'duplicate'
  | 'empty';

export type EredesResult =
  ({ ok: true } & EredesFile) | { ok: false; error: EredesError; row?: number };

const HEADER = ['Contador', 'Data', 'Hora', 'Consumo registado, Ativa (kW)', 'Estado'];

const rowSchema = z.tuple([
  z.string(),
  z.string().regex(/^\d{4}[/-]\d{2}[/-]\d{2}$/),
  z.string().regex(/^\d{2}:\d{2}$/),
  z.string().regex(/^\d{1,4}(?:[,.]\d{1,3})?$/),
  z.string(),
]);

/** XML text with its five predefined entities and numeric references decoded. */
function xmlText(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? '';
  });
}

/** All the <t> texts inside an element, joined (rich text has several). */
function texts(xml: string): string {
  let text = '';
  for (const match of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += match[1] ?? '';
  return xmlText(text);
}

/** Column index of a cell reference: "D9" → 3. */
function columnOf(reference: string): number {
  let column = 0;
  for (const char of reference.replace(/\d+$/, '')) column = column * 26 + char.charCodeAt(0) - 64;
  return column - 1;
}

/** The rows of the first sheet as text cells (row number → cells by column). */
function sheetRows(files: Record<string, Uint8Array>): Map<number, string[]> {
  const sheetName = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  const sheet = sheetName ? files[sheetName] : undefined;
  if (!sheet) throw new Error('No sheet');
  const shared = files['xl/sharedStrings.xml'];
  const strings = shared
    ? [...strFromU8(shared).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
        texts(match[1] ?? ''),
      )
    : [];

  const rows = new Map<number, string[]>();
  for (const row of strFromU8(sheet).matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1] ?? '';
      const body = cell[2] ?? '';
      const reference = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1];
      if (!reference) continue;
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      cells[columnOf(reference)] =
        type === 'inlineStr'
          ? texts(body)
          : type === 's'
            ? (strings[Number(value)] ?? '')
            : xmlText(value ?? '');
    }
    rows.set(Number(row[1]), cells);
  }
  return rows;
}

/** "0,332" kW (average over the quarter hour) → 83 Wh: kW × 0,25 h. Exact for multiples of 0,004. */
function quarterWh(kw: string): Wh {
  const [integer = '0', decimals = ''] = kw.split(/[,.]/);
  const milliKw = Number(integer) * 1000 + Number(decimals.padEnd(3, '0'));
  return Math.round(milliKw / 4);
}

export function parseEredesXlsx(bytes: Uint8Array): EredesResult {
  let rows: Map<number, string[]>;
  try {
    rows = sheetRows(unzipSync(bytes));
  } catch {
    return { ok: false, error: 'not_xlsx' };
  }

  // The header row (row 8 in the files seen; found by its content to tolerate a shift).
  const headerRow = [...rows].find(([, cells]) => cells[0] === HEADER[0])?.[0];
  if (
    headerRow === undefined ||
    HEADER.some((name, index) => rows.get(headerRow)?.[index]?.trim() !== name)
  ) {
    return { ok: false, error: 'not_eredes' };
  }

  const byStart = new Map<EpochSeconds, EredesQuarter>();
  for (const [number, cells] of [...rows].sort(([a], [b]) => a - b)) {
    if (number <= headerRow || cells.every((cell) => !cell)) continue;
    const parsed = rowSchema.safeParse(cells.slice(0, 5).map((cell) => (cell ?? '').trim()));
    if (!parsed.success) return { ok: false, error: 'bad_row', row: number };
    const [, date, time, kw, state] = parsed.data;
    const [hour = '', minute = ''] = time.split(':');
    const ts = eredesQuarterStart(date.replace(/\//g, '-'), Number(hour), Number(minute));
    if (ts === null) return { ok: false, error: 'bad_row', row: number };
    if (byStart.has(ts)) return { ok: false, error: 'duplicate', row: number };
    byStart.set(ts, { ts, energyWh: quarterWh(kw), estimated: state !== 'Real' });
  }

  const supplyPointId = [...rows.values()]
    .find((cells) => cells[0]?.trim() === 'CPE')?.[1]
    ?.replace(/\s+/g, '')
    .toUpperCase();
  if (!supplyPointId) return { ok: false, error: 'not_eredes' };

  const quarters = [...byStart.values()].sort((a, b) => a.ts - b.ts);
  const first = quarters[0];
  const last = quarters.at(-1);
  if (!first || !last) return { ok: false, error: 'empty' };
  let energyWh = 0;
  let estimated = 0;
  for (const quarter of quarters) {
    energyWh += quarter.energyWh;
    if (quarter.estimated) estimated += 1;
  }
  return {
    ok: true,
    supplyPointId,
    quarters,
    energyWh,
    estimated,
    missing: (last.ts - first.ts) / QUARTER_HOUR + 1 - quarters.length,
  };
}
