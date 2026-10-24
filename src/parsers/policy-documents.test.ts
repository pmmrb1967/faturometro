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

  it('ignores the product general conditions (not the policy)', () => {
    for (const fixture of layoutFixtures('fidelidade-general')) {
      expect(readPolicyDocument(fixture.pages)).toBeNull();
    }
  });

  it('ignores other documents', () => {
    expect(readPolicyDocument([])).toBeNull();
    for (const fixture of layoutFixtures('nos'))
      expect(readPolicyDocument(fixture.pages)).toBeNull();
  });
});

describe('Fidelidade health insurance particular conditions', () => {
  const health = layoutFixtures('fidelidade-docs');

  it('has fixtures to test against', () => {
    expect(health.length).toBeGreaterThan(0);
  });

  it.each(health)('$name', (fixture) => {
    const document = readPolicyDocument(fixture.pages);
    expect(document?.kind).toBe('conditions');
    if (document?.kind !== 'conditions') return;
    expect(document.issuerName).toBe('Fidelidade');
    expect(document.title).toMatch(/^Seguro Multicare /);
    expect(document.policyNumber).toMatch(/^\d+$/);
    const { details } = document;
    expect(details.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(details.annualPremiumCents).toBeGreaterThan(0);
    expect(details.insuredPersons).toBeGreaterThanOrEqual(1);
    const coverages = details.coverages ?? [];
    const hospital = coverages[0];
    expect(hospital?.name).toMatch(/^Internamento Hospitalar?/);
    expect(hospital?.capitalCents).toBeGreaterThan(0);
    expect(hospital?.network).toMatch(/^Multicare \d+% · cliente \d+%$/);
    expect(hospital?.waitingPeriod).toMatch(/^\d+ dias$/);
    // The indented "Franquia por Sinistro" row is the coverage's deductible, not a coverage.
    expect(hospital?.deductible).toMatch(/^rede /);
    expect(coverages.some((coverage) => /^Franquia/.test(coverage.name))).toBe(false);
    // A coverage without values is still listed; the page footer is not.
    expect(coverages.map((coverage) => coverage.name)).toContain('Transporte De Urgência');
    expect(coverages.some((coverage) => /Página|M-\d/.test(coverage.name))).toBe(false);
  });
});

describe('Fidelidade insurance proposal', () => {
  const proposals = layoutFixtures('fidelidade-proposal');

  it('has fixtures to test against', () => {
    expect(proposals.length).toBeGreaterThan(0);
  });

  it.each(proposals)('$name', (fixture) => {
    const document = readPolicyDocument(fixture.pages);
    expect(document?.kind).toBe('conditions');
    if (document?.kind !== 'conditions') return;
    expect(document.source).toBe('proposal');
    expect(document.issuerName).toBe('Fidelidade');
    expect(document.title).toBe('Seguro Pets');
    expect(document.policyNumber).toMatch(/^[A-Z]{2}\d+$/);
    const { details } = document;
    expect(details.product).toBe('FIDELIDADE PETS');
    expect(details.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The proposal has no premium; the receipts give it.
    expect(details.annualPremiumCents).toBeUndefined();
    // Species and breed only: the animal's name is never kept.
    expect(details.insuredObject).toMatch(/^Cão \(\S/);
    const coverages = details.coverages ?? [];
    // The table goes on to the second page; the "(*)" notes are not coverages.
    expect(coverages).toHaveLength(7);
    expect(coverages[0]).toEqual({
      name: 'Medicina Preventiva (Check-up)',
      capital: 'incluída',
      deductible: 'Sem Franquia',
    });
    const liability = coverages.find((coverage) => coverage.name === 'Responsabilidade Civil');
    expect(liability?.capitalCents).toBeGreaterThan(0);
    expect(liability?.deductible).toMatch(/^\d+,\d{2} €$/);
    expect(coverages.map((coverage) => coverage.name)).toContain('Proteção Jurídica');
    expect(coverages.some((coverage) => /\*|Franquia|Coberturas/.test(coverage.name))).toBe(false);
  });
});
