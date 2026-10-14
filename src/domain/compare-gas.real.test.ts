import { describe, expect, it } from 'vitest';
import { repsolParser } from '../parsers/repsol';
import { layoutFixtures } from '../test/fixtures';
import { periodDays } from './contract-prices';
import { estimateGasCost, gasBreakdownFromLines, hasEarlierAdjustments } from './gas-cost';

// Real gas invoices (private fixtures, local only; skipped in CI).
const gasInvoices = layoutFixtures('repsol')
  .filter((fixture) => fixture.private)
  .flatMap((fixture) => fixture.qrs.map((qr) => ({ qr, result: repsolParser.parse(fixture, qr) })))
  .filter(({ result }) => result.sector === 'gas')
  // Invoices that settle earlier estimates carry amounts of other periods.
  .filter(({ result }) => !hasEarlierAdjustments(result.lines));

describe.skipIf(gasInvoices.length === 0)('gas cost with real invoices', () => {
  it.each(gasInvoices.map((item, index) => ({ ...item, name: `invoice ${index + 1}` })))(
    '$name: the estimate for its own period matches the total ±2 %',
    ({ qr, result }) => {
      const days = periodDays(result.periodStart!.value, result.periodEnd!.value);
      const breakdown = gasBreakdownFromLines(result.lines, days);
      expect(breakdown).not.toBeNull();
      const estimate = estimateGasCost(breakdown!.prices, breakdown!.kwh, days, breakdown!.common);
      expect(Math.abs(estimate.totalCents - qr.totalCents)).toBeLessThanOrEqual(
        Math.max(2, qr.totalCents * 0.02),
      );
    },
  );
});
