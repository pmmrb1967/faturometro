import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eredesXlsx, type FixtureRow } from '../../test/eredes-fixture';
import { parseEredesXlsx } from './eredes';

const utc = (iso: string) => Date.parse(iso) / 1000;
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

describe('parseEredesXlsx (docs/eredes-xlsx.md)', () => {
  it('reads kW per quarter hour as Wh, labels as the end of the interval', () => {
    const result = parseEredesXlsx(
      eredesXlsx([
        ['2026/01/15', '00:15', '0,332', 'Real'],
        ['2026/01/15', '00:30', '1', 'Real'],
        ['2026/01/15', '00:45', '0,004', 'Estimada'],
        ['2026/01/15', '01:00', '2,5', '-'],
      ]),
    );
    // 0,332 kW × 0,25 h = 83 Wh; 1 → 250; 0,004 → 1; 2,5 → 625.
    expect(result).toEqual({
      ok: true,
      supplyPointId: 'PT0000000000000000XX',
      quarters: [
        { ts: utc('2026-01-15T00:00:00Z'), energyWh: 83, estimated: false },
        { ts: utc('2026-01-15T00:15:00Z'), energyWh: 250, estimated: false },
        { ts: utc('2026-01-15T00:30:00Z'), energyWh: 1, estimated: true },
        { ts: utc('2026-01-15T00:45:00Z'), energyWh: 625, estimated: true },
      ],
      energyWh: 959,
      estimated: 2,
      missing: 0,
    });
  });

  it('the day of 23 h: 00:45 then 02:00 are consecutive', () => {
    const result = parseEredesXlsx(
      eredesXlsx([
        ['2026/03/29', '00:45', '0,4', 'Real'],
        ['2026/03/29', '02:00', '0,4', 'Real'],
        ['2026/03/29', '02:15', '0,4', 'Real'],
      ]),
    );
    expect(result.ok && result.quarters.map((quarter) => quarter.ts)).toEqual([
      utc('2026-03-29T00:30:00Z'),
      utc('2026-03-29T00:45:00Z'),
      utc('2026-03-29T01:00:00Z'),
    ]);
    expect(result.ok && result.missing).toBe(0);
  });

  it('the day of 25 h: 96 labels, the repeated hour once, 4 quarters missing', () => {
    const rows: FixtureRow[] = [];
    for (let quarter = 0; quarter < 96; quarter++) {
      rows.push(['2025/10/26', hhmm(quarter * 15), '0,4', 'Real']);
    }
    const result = parseEredesXlsx(eredesXlsx(rows));
    expect(result.ok && result.quarters).toHaveLength(96);
    expect(result.ok && result.missing).toBe(4);
    expect(result.ok && result.quarters[0]?.ts).toBe(utc('2025-10-25T22:45:00Z'));
  });

  it('also reads shared strings', () => {
    const result = parseEredesXlsx(
      eredesXlsx([['2026/01/15', '00:15', '0,332', 'Real']], { sharedStrings: true }),
    );
    expect(result.ok && result.energyWh).toBe(83);
  });

  it('rejects other files', () => {
    expect(parseEredesXlsx(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, error: 'not_xlsx' });
    const otherUnit = ['Contador', 'Data', 'Hora', 'Consumo registado, Ativa (kWh)', 'Estado'];
    expect(parseEredesXlsx(eredesXlsx([], { header: otherUnit }))).toEqual({
      ok: false,
      error: 'not_eredes',
    });
    expect(parseEredesXlsx(eredesXlsx([]))).toEqual({ ok: false, error: 'empty' });
    expect(parseEredesXlsx(eredesXlsx([['2026/01/15', '00:15', 'x', 'Real']]))).toEqual({
      ok: false,
      error: 'bad_row',
      row: 9,
    });
    // 01:15 does not exist on the day of 23 h.
    expect(parseEredesXlsx(eredesXlsx([['2026/03/29', '01:15', '0,4', 'Real']]))).toEqual({
      ok: false,
      error: 'bad_row',
      row: 9,
    });
    expect(
      parseEredesXlsx(
        eredesXlsx([
          ['2026/01/15', '00:15', '0,4', 'Real'],
          ['2026/01/15', '00:15', '0,4', 'Real'],
        ]),
      ),
    ).toEqual({ ok: false, error: 'duplicate', row: 10 });
  });
});

// Real exports (fixtures/private/eredes, local only: never committed).
const PRIVATE = join(__dirname, '..', '..', '..', 'fixtures', 'private', 'eredes');
const realFiles = existsSync(PRIVATE)
  ? readdirSync(PRIVATE).filter((name) => /^Consumos_.*\.xlsx$/.test(name))
  : [];

describe.skipIf(realFiles.length === 0)('parseEredesXlsx with a real export', () => {
  it.each(realFiles)('%s', (name) => {
    const result = parseEredesXlsx(new Uint8Array(readFileSync(join(PRIVATE, name))));
    if (!result.ok) throw new Error(`${result.error} at row ${result.row}`);
    const first = result.quarters[0]!.ts;
    const last = result.quarters.at(-1)!.ts;
    // Only the 4 quarters of the repeated hour in October are missing.
    expect(result.missing).toBe(4);
    expect(result.quarters.length + result.missing).toBe((last - first) / 900 + 1);
    expect(result.estimated).toBeGreaterThan(0);
    expect(result.energyWh).toBeGreaterThan(1_000_000);
    expect(result.supplyPointId).toMatch(/^PT\d{16}[A-Z]{2}$/);
  });
});
