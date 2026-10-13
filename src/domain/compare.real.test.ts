import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repsolParser } from '../parsers/repsol';
import { layoutFixtures } from '../test/fixtures';
import { annualUsage, compareOffers } from './compare';
import { offersFileSchema } from './erse';
import type { Invoice, InvoiceLine, Reading } from './types';

// Real invoices (private fixtures, local only) against the real ERSE offers file.
const documents = layoutFixtures('repsol')
  .filter((fixture) => fixture.private)
  .flatMap((fixture) =>
    fixture.qrs.map((qr) => ({ qr, extraction: repsolParser.parse(fixture, qr) })),
  )
  .filter(({ extraction }) => extraction.sector === 'electricity');

const META = { updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' };

describe.skipIf(documents.length === 0)('comparator with real data', () => {
  it('estimates the current contract and ranks real ERSE offers', () => {
    const offers = offersFileSchema.parse(
      JSON.parse(readFileSync(join(__dirname, '../../public/data/erse-offers.json'), 'utf8')),
    ).offers;
    const invoices: Invoice[] = documents.map(({ qr, extraction }, index) => ({
      ...META,
      id: `i${index}`,
      contractId: 'c',
      providerId: 'p',
      fileHash: `h${index}`,
      docType: 'FT',
      issueDate: qr.date,
      periodStart: extraction.periodStart!.value,
      periodEnd: extraction.periodEnd!.value,
      totalCents: qr.totalCents,
      qrStatus: 'ok',
      validation: 'passed',
      sources: {},
      confidence: {},
    }));
    const readings: Reading[] = documents.flatMap(({ extraction }, index) =>
      extraction.readings.map((reading, n) => ({
        ...META,
        ...reading,
        id: `r${index}-${n}`,
        invoiceId: `i${index}`,
        contractId: 'c',
        dateFrom: extraction.periodStart!.value,
      })),
    );
    const latestIndex = invoices.length - 1;
    const latest = documents[latestIndex]!.extraction;
    const lines: InvoiceLine[] = latest.lines.map((line, n) => ({
      ...META,
      ...line,
      id: `l${n}`,
      invoiceId: `i${latestIndex}`,
    }));
    const today = invoices
      .map((invoice) => invoice.issueDate)
      .sort()
      .at(-1)!;
    const days = invoices.reduce(
      (sum, invoice) =>
        sum + (Date.parse(invoice.periodEnd!) - Date.parse(invoice.periodStart!)) / 86_400_000 + 1,
      0,
    );
    const actualAnnual =
      (invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0) * 365) / days;

    const usage = annualUsage(invoices, readings, today)!;
    const result = compareOffers({
      offers,
      latest: { lines, periodStart: latest.periodStart!.value, periodEnd: latest.periodEnd!.value },
      usage,
      household: { powerKva: latest.powerKva!.value },
      today,
    })!;

    // The current contract estimate is close to what the invoices actually cost per year.
    expect(Math.abs(result.currentAnnualCents - actualAnnual) / actualAnnual).toBeLessThan(0.05);
    expect(result.results.length).toBeGreaterThan(50);
    // Sorted, and every estimate is a plausible yearly bill.
    expect(result.results[0]!.annualCents).toBeLessThanOrEqual(result.results[1]!.annualCents);
    for (const item of result.results) expect(item.annualCents).toBeGreaterThan(10_000);
  });
});
