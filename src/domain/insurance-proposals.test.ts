import { describe, expect, it } from 'vitest';
import {
  compareProposal,
  coverageSummary,
  currentPremiumCents,
  deductibleCents,
} from './insurance-proposals';
import type { InsuranceDetails, InsuranceProposal } from './types';

const policy: InsuranceDetails = {
  product: 'Casa',
  option: 'Mais',
  insuredObject: 'Recheio e imóvel',
  annualPremiumCents: 30000,
  coverages: [
    { name: 'Incêndio', capital: '150 000,00 €', capitalCents: 15000000, deductible: '150,00 €' },
    {
      name: 'Danos por água',
      capital: '5 000,00 €',
      capitalCents: 500000,
      deductible: '10 % mín. 250 €',
    },
    { name: 'Responsabilidade civil', capital: '50 000,00 €', capitalCents: 5000000 },
  ],
};

function proposal(overrides: Partial<InsuranceProposal> = {}): InsuranceProposal {
  return {
    id: 'p1',
    insurer: 'Seguradora B',
    annualPremiumCents: 26000,
    createdAt: '2026-10-18T10:00:00.000Z',
    coverages: [
      { name: 'Incêndio', included: true, capitalCents: 15000000, deductibleCents: 15000 },
      { name: 'Danos por água', included: true, capitalCents: 400000, deductibleCents: 30000 },
      { name: 'Responsabilidade civil', included: false },
    ],
    ...overrides,
  };
}

describe('deductibleCents', () => {
  it('reads plain amounts and leaves rules like "10 % mín." alone', () => {
    expect(deductibleCents('150,00 €')).toBe(15000);
    expect(deductibleCents('1 000,00 €')).toBe(100000);
    expect(deductibleCents('10 % mín. 250 €')).toBeUndefined();
    expect(deductibleCents(undefined)).toBeUndefined();
  });
});

describe('compareProposal', () => {
  it('flags missing coverages, lower capitals and higher deductibles, with the price difference', () => {
    const result = compareProposal(policy, proposal());
    expect(result.premiumDifferenceCents).toBe(-4000);
    expect(result.coverages.map((coverage) => [coverage.name, coverage.verdicts])).toEqual([
      ['Incêndio', ['ok']],
      // The current deductible is a rule, so only the capital is compared.
      ['Danos por água', ['lower_capital']],
      ['Responsabilidade civil', ['missing']],
    ]);
    expect(result.worse).toBe(2);
  });

  it('a higher deductible counts as worse; a coverage the proposal does not list is missing', () => {
    const result = compareProposal(
      policy,
      proposal({
        coverages: [{ name: 'Incêndio', included: true, deductibleCents: 50000 }],
      }),
    );
    expect(result.coverages.map((coverage) => coverage.verdicts)).toEqual([
      ['higher_deductible'],
      ['missing'],
      ['missing'],
    ]);
  });

  it('uses the renewal letter premium when the conditions have none', () => {
    const renewalOnly: InsuranceDetails = {
      renewal: { date: '2027-01-01', currentCents: 28000, nextCents: 31000 },
    };
    expect(currentPremiumCents(renewalOnly)).toBe(31000);
    expect(compareProposal(renewalOnly, proposal()).premiumDifferenceCents).toBe(-5000);
    expect(compareProposal({}, proposal()).premiumDifferenceCents).toBeUndefined();
  });
});

describe('coverageSummary', () => {
  it('lists the policy for the simulators', () => {
    const text = coverageSummary(
      policy,
      {
        capital: 'Capital',
        deductible: 'Franquia',
        premium: (amount) => `Prémio anual: ${amount}`,
      },
      (cents) => `${cents / 100} €`,
    );
    expect(text).toBe(
      [
        'Casa — Mais',
        'Recheio e imóvel',
        'Prémio anual: 300 €',
        '- Incêndio (Capital: 150 000,00 €; Franquia: 150,00 €)',
        '- Danos por água (Capital: 5 000,00 €; Franquia: 10 % mín. 250 €)',
        '- Responsabilidade civil (Capital: 50 000,00 €)',
      ].join('\n'),
    );
  });
});
