import { describe, expect, it } from 'vitest';
import { addMonths, contractForecast, householdSummary, type HouseholdInput } from './household';

type Inv = HouseholdInput['invoices'][number];
const inv = (
  contractId: string,
  issueDate: string,
  totalCents: number,
  period?: [string, string],
): Inv => ({
  contractId,
  issueDate,
  totalCents,
  ...(period ? { periodStart: period[0], periodEnd: period[1] } : {}),
});

describe('addMonths', () => {
  it('crosses year ends both ways', () => {
    expect(addMonths('2026-10', -11)).toBe('2025-11');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
});

describe('householdSummary', () => {
  const contracts: HouseholdInput['contracts'] = [
    { id: 'net', sector: 'telecom', active: true },
    { id: 'luz', sector: 'electricity', active: true },
    { id: 'old', sector: 'telecom', active: false },
  ];

  it('adds the last 12 months by month and sector', () => {
    const summary = householdSummary({
      contracts,
      invoices: [
        inv('net', '2026-10-01', 4000),
        inv('net', '2026-09-01', 4000),
        inv('luz', '2026-09-20', 6000),
        inv('old', '2025-11-03', 3000),
        // Outside the window (12 months: 2025-11 to 2026-10).
        inv('net', '2025-10-31', 9999),
      ],
      today: '2026-10-14',
    });
    expect(summary.months).toHaveLength(12);
    expect(summary.months[0]).toEqual({
      month: '2025-11',
      totalCents: 3000,
      bySector: { telecom: 3000 },
    });
    expect(summary.months.at(-2)).toEqual({
      month: '2026-09',
      totalCents: 10000,
      bySector: { telecom: 4000, electricity: 6000 },
    });
    expect(summary.months.at(-1)).toMatchObject({ month: '2026-10', totalCents: 4000 });
    expect(summary.totalCents).toBe(17000);
    expect(summary.bySector).toEqual([
      { sector: 'telecom', totalCents: 11000 },
      { sector: 'electricity', totalCents: 6000 },
    ]);
    // History does not cover the 12 months before.
    expect(summary.previousTotalCents).toBeUndefined();
  });

  it('compares with the 12 months before when the history covers them', () => {
    const summary = householdSummary({
      contracts,
      invoices: [
        inv('net', '2024-11-05', 1000),
        inv('net', '2025-10-05', 2000),
        inv('net', '2026-10-05', 4000),
      ],
      today: '2026-10-14',
    });
    expect(summary.previousTotalCents).toBe(3000);
    expect(summary.totalCents).toBe(4000);
  });

  it('forecasts only the active contracts, and nothing without invoices', () => {
    expect(
      householdSummary({ contracts, invoices: [], today: '2026-10-14' }).forecastCents,
    ).toBeNull();
    const summary = householdSummary({
      contracts,
      invoices: [inv('net', '2026-10-01', 3000), inv('old', '2026-10-01', 5000)],
      today: '2026-10-14',
    });
    // One monthly invoice without a period: 30 € × 12.
    expect(summary.forecastCents).toBe(36000);
  });
});

describe('contractForecast', () => {
  it('uses the cost per day of the latest invoices, from their billing periods', () => {
    const invoices = [
      inv('w', '2026-04-01', 9999, ['2026-01-01', '2026-02-28']),
      inv('w', '2026-06-01', 3000, ['2026-03-01', '2026-04-30']),
      inv('w', '2026-08-01', 3000, ['2026-05-01', '2026-06-30']),
      inv('w', '2026-10-01', 3000, ['2026-07-01', '2026-08-31']),
    ];
    // 90 € over 61 + 61 + 62 = 184 days → × 365.
    expect(contractForecast('telecom', invoices, '2025-11')).toBe(Math.round((9000 / 184) * 365));
  });

  it('repeats the last year for metered services with a whole year of history', () => {
    const invoices = [
      inv('l', '2025-10-20', 9000),
      inv('l', '2026-01-20', 12000),
      inv('l', '2026-07-20', 5000),
    ];
    expect(contractForecast('electricity', invoices, '2025-11')).toBe(17000);
    // Telecom keeps the recent average.
    expect(contractForecast('telecom', invoices, '2025-11')).toBe(
      Math.round((26000 / 3 / (365 / 12)) * 365),
    );
  });

  it('returns null without invoices', () => {
    expect(contractForecast('gas', [], '2025-11')).toBeNull();
  });
});
