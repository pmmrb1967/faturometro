import { describe, expect, it } from 'vitest';
import { isValidNif } from '../domain/nif';
import { vatCents } from '../qr/parse';
import { layoutFixtures } from '../test/fixtures';
import { findParser } from './registry';
import { viaVerdeParser } from './via-verde';

const fixtures = layoutFixtures('via-verde');
const documents = fixtures.flatMap((fixture) =>
  fixture.qrs.map((qr, index) => ({ name: `${fixture.name} #${index + 1}`, fixture, qr })),
);

describe('via-verde parser', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(documents)('$name', ({ fixture, qr }) => {
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    // Every issuer of the statement (Brisa, Infraestruturas de Portugal, parking…) uses this reader.
    expect(findParser(ctx, qr.issuerNif)).toBe(viaVerdeParser);
    expect(viaVerdeParser.detect(ctx)).toBe(true);

    const result = viaVerdeParser.parse(ctx, qr);
    expect(result.warnings).toEqual([]);
    expect(result.sector).toBe('other');
    expect(result.contractLabel?.value).toBe('Via Verde');
    expect(result.usageBased).toBe(true);
    // Cross-check with the fiscal QR code of this invoice, not another one of the statement.
    expect(result.docId?.value).toBe(qr.docId);
    expect(result.issueDate?.value).toBe(qr.date);
    expect(result.totalCents?.value).toBe(qr.totalCents);
    expect(result.vatCents?.value).toBe(vatCents(qr));
    // The issuer's name as printed in its block, without the series code "(BR)".
    expect(result.issuerName?.value).toMatch(/\S/);
    expect(result.issuerName?.value).not.toMatch(/\(|\)/);
    // One contract for the whole statement, with Via Verde (NIPC in the footer).
    expect(result.contractHolder?.value.name).toBe('Via Verde');
    expect(isValidNif(result.contractHolder?.value.nif ?? '')).toBe(true);
    expect(result.customerNumber?.value).toMatch(/^\d+$/);
  });

  it('reads the synthetic statement', () => {
    const fixture = fixtures.find((candidate) => candidate.name === 'synthetic-1.json')!;
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    const read = fixture.qrs.map((qr) => viaVerdeParser.parse(ctx, qr));
    expect(read.map((result) => result.issuerName?.value)).toEqual([
      'Brisa Concessão Rodoviária',
      'I. de Portugal',
      'I. de Portugal',
      'VIA VERDE PORTUGAL',
    ]);
    expect(read.map((result) => result.totalCents?.value)).toEqual([1240, 285, 55, 149]);
    expect(read[0]?.contractHolder?.value.nif).toBe('504656767');
    expect(read[0]?.customerNumber?.value).toBe('100000001');
  });

  it('does not claim other documents', () => {
    const page = { page: 1, width: 595, height: 842, items: [] };
    expect(viaVerdeParser.detect({ pages: [page], qrs: [] })).toBe(false);
  });
});
