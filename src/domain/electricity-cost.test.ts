import { describe, expect, it } from 'vitest';
import { repsolParser } from '../parsers/repsol';
import { layoutFixtures } from '../test/fixtures';
import { breakdownFromLines, periodDays } from './contract-prices';
import { estimateCost, reducedShare } from './electricity-cost';

describe('reducedShare (ERSE VAT rules)', () => {
  it('taxes the first 200 kWh per 30 days at 6 % up to 6,9 kVA', () => {
    // 31 days: 31/30 × 200 = 206,7 → 207 kWh (as on a real invoice).
    expect(reducedShare(226, 31, { powerKva: 6.9 }) * 226).toBe(207);
    expect(reducedShare(150, 30, { powerKva: 6.9 })).toBe(1);
    expect(reducedShare(400, 30, { powerKva: 6.9, largeFamily: true }) * 400).toBe(300);
    expect(reducedShare(150, 30, { powerKva: 10.35 })).toBe(0);
  });
});

describe('estimateCost', () => {
  it('adds fixed term, energy, discounts and VAT', () => {
    const estimate = estimateCost(
      { fixedPerDay: 0.5, energy: { simple: 0.2 }, energyDiscountPct: 10 },
      { simple: 100 },
      30,
      { powerKva: 6.9 },
    );
    // energy 100 × 0,2 × 0,9 = 18 € at 6 % (100 kWh ≤ 200); fixed 15 € at 23 %.
    expect(estimate).toEqual({
      netCents: 3300,
      vatCents: 108 + 345,
      totalCents: 3753,
      reducedKwh: 100,
    });
  });

  it('needs a price for every period with consumption', () => {
    expect(() =>
      estimateCost({ fixedPerDay: 0, energy: { simple: 0.2 } }, { empty: 10 }, 30, {
        powerKva: 6.9,
      }),
    ).toThrow();
  });
});

// PLAN.md §8: with the current contract's prices, the estimate must match real invoices ± 2 %.
const electricity = layoutFixtures('repsol').flatMap((fixture) =>
  fixture.qrs
    .map((qr, index) => ({
      name: `${fixture.name} #${index + 1}`,
      extraction: repsolParser.parse(fixture, qr),
      qr,
    }))
    .filter(({ extraction }) => extraction.sector === 'electricity'),
);

describe('estimate reproduces real electricity invoices (± 2 %)', () => {
  it.each(electricity)('$name', ({ extraction, qr }) => {
    const days = periodDays(extraction.periodStart!.value, extraction.periodEnd!.value);
    const breakdown = breakdownFromLines(extraction.lines, days);
    expect(breakdown).not.toBeNull();
    const estimate = estimateCost(
      breakdown!.prices,
      breakdown!.consumption,
      days,
      {
        powerKva: extraction.powerKva!.value,
      },
      breakdown!.common,
    );
    expect(Math.abs(estimate.totalCents - qr.totalCents) / qr.totalCents).toBeLessThanOrEqual(0.02);
  });
});
