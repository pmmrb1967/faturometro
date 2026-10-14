import { describe, expect, it } from 'vitest';
import { estimateCost } from './electricity-cost';
import { switchSavings, type SwitchInvoice } from './switch-savings';

type Line = SwitchInvoice['lines'][number];

const energy = (kwh: number, price: string, period?: 'empty' | 'off_empty'): Line => ({
  kind: 'energy',
  description: 'Energia',
  amountCents: Math.round(kwh * Number(price) * 100),
  quantity: kwh,
  unit: 'kWh',
  unitPrice: price,
  ...(period ? { period } : {}),
});
const power = (days: number, price: string): Line => ({
  kind: 'power',
  description: 'Potência',
  amountCents: Math.round(days * Number(price) * 100),
  quantity: days,
  unit: 'day',
  unitPrice: price,
});
const entry = (
  issueDate: string,
  totalCents: number,
  period?: [string, string],
  lines: Line[] = [],
): SwitchInvoice => ({
  invoice: {
    issueDate,
    totalCents,
    ...(period ? { periodStart: period[0], periodEnd: period[1] } : {}),
  },
  lines,
});

describe('switchSavings', () => {
  it('telecom: cost per day of the old contract × the days of the new invoices', () => {
    const result = switchSavings({
      sector: 'telecom',
      since: '2026-06-01',
      before: [
        entry('2026-04-01', 4500, ['2026-04-01', '2026-04-30']),
        entry('2026-05-01', 4650, ['2026-05-01', '2026-05-31']),
      ],
      after: [
        // Before the change: not counted.
        entry('2026-05-20', 9999, ['2026-05-20', '2026-05-31']),
        entry('2026-06-01', 3000, ['2026-06-01', '2026-06-30']),
        entry('2026-07-01', 3100, ['2026-07-01', '2026-07-31']),
      ],
    });
    // 91,50 € over 61 days, then 30 + 31 days.
    const perDay = 9150 / 61;
    expect(result).toEqual({
      invoices: 2,
      paidCents: 6100,
      wouldCents: Math.round(perDay * 30) + Math.round(perDay * 31),
      savingCents: Math.round(perDay * 30) + Math.round(perDay * 31) - 6100,
      method: 'perDay',
    });
  });

  it('electricity: the old prices applied to the new consumption', () => {
    const household = { powerKva: 6.9 };
    const newLines = [energy(250, '0.15'), power(30, '0.30')];
    const result = switchSavings({
      sector: 'electricity',
      since: '2026-06-01',
      household,
      before: [
        entry(
          '2026-05-31',
          5000,
          ['2026-05-01', '2026-05-30'],
          [energy(150, '0.20'), power(30, '0.30')],
        ),
      ],
      after: [entry('2026-07-01', 5300, ['2026-06-01', '2026-06-30'], newLines)],
    });
    const would = estimateCost(
      { fixedPerDay: 0.3, energy: { simple: 0.2 } },
      { simple: 250 },
      30,
      household,
    ).totalCents;
    expect(result).toMatchObject({ method: 'prices', paidCents: 5300, wouldCents: would });
    expect(result?.savingCents).toBe(would - 5300);
    // More consumption in the new period does not count against the new supplier.
    expect(result!.savingCents).toBeGreaterThan(0);
  });

  it('electricity: bi-hourly consumption priced at an old simple tariff', () => {
    const result = switchSavings({
      sector: 'electricity',
      since: '2026-06-01',
      household: { powerKva: 6.9 },
      before: [
        entry(
          '2026-05-31',
          5000,
          ['2026-05-01', '2026-05-30'],
          [energy(150, '0.20'), power(30, '0.30')],
        ),
      ],
      after: [
        entry(
          '2026-07-01',
          4000,
          ['2026-06-01', '2026-06-30'],
          [energy(100, '0.10', 'empty'), energy(100, '0.18', 'off_empty'), power(30, '0.30')],
        ),
      ],
    });
    expect(result?.method).toBe('prices');
  });

  it('falls back to the cost per day when prices cannot be applied', () => {
    const bi = [energy(60, '0.10', 'empty'), energy(90, '0.20', 'off_empty'), power(30, '0.30')];
    const result = switchSavings({
      sector: 'electricity',
      since: '2026-06-01',
      household: { powerKva: 6.9 },
      // Old bi-hourly, new simple: the simple kWh cannot be split.
      before: [entry('2026-05-31', 3000, ['2026-05-01', '2026-05-30'], bi)],
      after: [
        entry(
          '2026-07-01',
          4000,
          ['2026-06-01', '2026-06-30'],
          [energy(150, '0.15'), power(30, '0.3')],
        ),
        // Without lines (read from the QR code only).
        entry('2026-08-01', 4000, ['2026-07-01', '2026-07-30']),
      ],
    });
    expect(result).toMatchObject({ method: 'perDay', wouldCents: 6000, savingCents: -2000 });
  });

  it('returns null without old invoices or new invoices since the change', () => {
    const one = [entry('2026-05-01', 3000, ['2026-05-01', '2026-05-31'])];
    expect(
      switchSavings({ sector: 'telecom', since: '2026-06-01', before: [], after: one }),
    ).toBeNull();
    expect(
      switchSavings({ sector: 'telecom', since: '2026-06-01', before: one, after: one }),
    ).toBeNull();
  });
});
