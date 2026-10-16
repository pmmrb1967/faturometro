import { describe, expect, it } from 'vitest';
import { sumCents } from '../lib/money';
import type { PageText } from '../pdf/text';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { meoParser } from './meo';
import { findParser } from './registry';

const fixtures = layoutFixtures('meo');

/** Some PDFs give every word its own text item, ~1 pt apart. */
function splitIntoWords(page: PageText): PageText {
  return {
    ...page,
    items: page.items.flatMap((item) => {
      let x = item.x;
      return item.str.split(' ').map((word) => {
        const piece = { ...item, str: word, x, width: word.length * 4.6 };
        x += piece.width + 1;
        return piece;
      });
    }),
  };
}

describe('meo parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const [qr] = fixture.qrs;
    expect(qr).toBeDefined();
    if (!qr) return;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    expect(findParser(ctx, qr.issuerNif)).toBe(meoParser);
    expect(meoParser.detect(ctx)).toBe(true);

    const result = meoParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('telecom');
    expect(result.docId?.value).toBe(qr.docId);
    // Cross-check with the fiscal QR code.
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    expect(result.netCents!.value + result.vatCents!.value).toBe(qr.totalCents);
    // Detail lines are without VAT and add up to the net total.
    expect(result.linesIncludeVat).toBeFalsy();
    expect(sumCents(result.lines.map((line) => line.amountCents))).toBe(result.netCents?.value);
    expect(result.lines.some((line) => line.kind === 'base_fee')).toBe(true);
    expect(result.lines.some((line) => line.kind === 'discount')).toBe(true);

    expect(result.customerNumber?.value).toMatch(/^\d{9,}$/);
    expect(result.tariffName?.value).toMatch(/^M móvel/i);
    expect(result.telecomServices?.value).toEqual(['mobile']);
    expect(result.loyaltyEndDate?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.periodStart!.value < result.periodEnd!.value).toBe(true);
    expect(result.issueDate?.value).toBe(qr.date);
    expect(result.dueDate!.value > qr.date).toBe(true);
    // Monthly fees of the month before the invoice.
    expect(result.periodEnd!.value < qr.date).toBe(true);
  });

  it('reads the same invoice when every word is a separate text item', () => {
    const fixture = fixtures.find((candidate) => candidate.name.includes('synthetic-1'));
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const whole = meoParser.parse({ pages: fixture.pages, qrs: fixture.qrs }, fixture.qrs[0]);
    const pages = fixture.pages.map(splitIntoWords);
    expect(pages[1]!.items.length).toBeGreaterThan(fixture.pages[1]!.items.length);
    const split = meoParser.parse({ pages, qrs: fixture.qrs }, fixture.qrs[0]);
    expect(split).toEqual(whole);
  });

  it('reads the synthetic invoice in full', () => {
    const fixture = fixtures.find((candidate) => candidate.name.includes('synthetic-1'));
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const result = meoParser.parse({ pages: fixture.pages, qrs: fixture.qrs }, fixture.qrs[0]);
    expect(result).toMatchObject({
      docId: { value: 'FT MV/100000001' },
      issueDate: { value: '2026-06-05' },
      dueDate: { value: '2026-06-29' },
      customerNumber: { value: '1000000001' },
      tariffName: { value: 'M Móvel Exemplo' },
      periodStart: { value: '2026-05-01' },
      periodEnd: { value: '2026-05-31' },
      loyaltyEndDate: { value: '2027-12-01' },
      netCents: { value: 2000 },
      vatCents: { value: 460 },
      totalCents: { value: 2460 },
    });
    expect(result.lines.map((line) => [line.kind, line.amountCents, line.vatRate])).toEqual([
      ['other', 3000, 23],
      ['discount', -3000, 23],
      ['base_fee', 2081, 23],
      ['discount', -81, 23],
      ['other', 0, undefined],
    ]);
  });
});
