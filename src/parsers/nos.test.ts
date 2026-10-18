import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { nosParser } from './nos';
import { findParser } from './registry';

const fixtures = layoutFixtures('nos');

describe('nos parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const [qr] = fixture.qrs;
    expect(qr).toBeDefined();
    if (!qr) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(nosParser);
    expect(nosParser.detect(ctx)).toBe(true);

    const result = nosParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('telecom');
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    // Summary lines include VAT and add up to the total.
    expect(result.linesIncludeVat).toBe(true);
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(qr.totalCents);
    expect(result.lines.some((line) => line.kind === 'base_fee')).toBe(true);

    expect(result.customerNumber?.value).toMatch(/^C\d+$/);
    expect(result.dueDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.dueDate!.value > qr.date).toBe(true);
    expect(result.tariffName?.value).toBeTruthy();
    // Every fixture's package has internet, TV, a landline and mobile plans.
    expect(result.telecomServices?.value).toEqual(['internet', 'tv', 'landline', 'mobile']);
    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    // Fees are billed for the month starting around the invoice date.
    expect(Math.abs(Date.parse(result.periodStart!.value) - Date.parse(qr.date))).toBeLessThan(
      40 * 86_400_000,
    );
    // Usage outside the package: only non-zero amounts, without VAT.
    for (const usage of result.extraUsage ?? []) {
      expect(usage.amountCents).toBeGreaterThan(0);
      expect(usage.description).toMatch(/^\p{Lu}/u);
    }
    if (fixture.name.includes('synthetic-1')) {
      expect(result.extraUsage).toEqual([{ description: 'Roaming', amountCents: 407 }]);
      expect(result.directDebitDate?.value).toBe('2026-06-30');
    }
    // Paid by direct debit: debited on or after the invoice date.
    if (result.directDebitDate) expect(result.directDebitDate.value >= qr.date).toBe(true);
  });
});
