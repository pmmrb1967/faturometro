import { describe, expect, it } from 'vitest';
import { layoutFixtures } from '../test/fixtures';
import { readPolicyDocument } from './policy-documents';

const fixtures = layoutFixtures('generali-docs');

describe('insurance documents without a QR code', () => {
  it('has fixtures to test against', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)('$name', (fixture) => {
    const document = readPolicyDocument(fixture.pages);
    expect(document).not.toBeNull();
    expect(document?.issuerName).toBe('Generali Seguros');
    expect(document?.title).toMatch(/^Seguro \S/);
    expect(document?.policyNumber).toMatch(/^\d+$/);
    if (document?.kind === 'renewal') {
      const { renewal } = document;
      expect(renewal.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(renewal.nextCents).toBeGreaterThan(renewal.currentCents);
      expect(renewal.factors?.length).toBeGreaterThanOrEqual(5);
      expect(renewal.factors?.map((factor) => factor.name)).toContain('Inflação de mercado');
      expect(renewal.capitals?.map((capital) => capital.name)).toContain('Valor do Recheio');
    } else if (document?.kind === 'conditions') {
      const { details } = document;
      expect(details.product).toBe('Automóvel Ligeiros');
      expect(details.annualPremiumCents).toBeGreaterThan(0);
      expect(details.bonusMalusPct).toBeGreaterThan(0);
      const coverages = details.coverages ?? [];
      // No group headings ("Responsabilidade civil") and no value attached to the wrong name.
      expect(coverages.map((coverage) => coverage.name)).not.toContain('Responsabilidade civil');
      const assistance = coverages.find((coverage) => /^Assistência em viagem/.test(coverage.name));
      expect(assistance?.capital).toBe('Conforme Cond. Gerais e/ou Especiais');
      expect(coverages[0]).toMatchObject({
        name: 'Responsabilidade civil danos corporais',
        capitalCents: 645_000_000,
        deductible: 'Não Aplicável',
      });
    }
  });

  it('ignores other documents', () => {
    expect(readPolicyDocument([])).toBeNull();
    for (const fixture of layoutFixtures('nos'))
      expect(readPolicyDocument(fixture.pages)).toBeNull();
  });
});
