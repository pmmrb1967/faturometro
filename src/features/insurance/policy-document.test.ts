import { describe, expect, it } from 'vitest';
import type { PolicyDocument } from '../../parsers/policy-documents';
import { contractForDocument, withPolicyDocument } from './policy-document';

const renewal: PolicyDocument = {
  kind: 'renewal',
  issuerName: 'Generali Seguros',
  policyNumber: '222',
  renewal: { date: '2026-11-01', currentCents: 39789, nextCents: 43251 },
};
const conditions: PolicyDocument = {
  kind: 'conditions',
  issuerName: 'Generali Seguros',
  policyNumber: '111',
  details: {
    product: 'Automóvel Ligeiros',
    insuredObject: 'FORD Kuga Diesel',
    coverages: [{ name: 'Furto ou roubo', capital: '8 533,60 €', capitalCents: 853360 }],
    annualPremiumCents: 46138,
    bonusMalusPct: 45,
  },
};

describe('contractForDocument', () => {
  const car = {
    id: 'car',
    sector: 'insurance' as const,
    label: 'Carro',
    insurance: { policyNumber: '111' },
  };
  const home = {
    id: 'home',
    sector: 'insurance' as const,
    label: 'Casa',
    insurance: { policyNumber: '222' },
  };
  const light = { id: 'light', sector: 'electricity' as const, label: 'Luz' };

  it('finds the policy by its number', () => {
    expect(contractForDocument([car, home, light], renewal)).toBe('home');
    expect(contractForDocument([car, home, light], conditions)).toBe('car');
  });

  it('falls back to the only insurance contract, and otherwise asks', () => {
    const other = { ...renewal, policyNumber: '999' };
    // The only policy has another number: another policy, so ask.
    expect(contractForDocument([car, light], other)).toBe('');
    const unnumbered = { id: 'new', sector: 'insurance' as const, label: 'Seguro' };
    expect(contractForDocument([unnumbered, light], other)).toBe('new');
    expect(contractForDocument([car, home], other)).toBe('');
    expect(contractForDocument([light], other)).toBe('');
  });
});

describe('withPolicyDocument', () => {
  it('stores the renewal letter', () => {
    expect(withPolicyDocument({ policyNumber: '222', product: 'CASA' }, renewal)).toEqual({
      policyNumber: '222',
      product: 'CASA',
      renewal: renewal.kind === 'renewal' ? renewal.renewal : undefined,
    });
  });

  it('adds coverages and premium, keeping what the receipts already say', () => {
    const next = withPolicyDocument({ product: 'Automóvel', insuredObject: 'FORD' }, conditions);
    expect(next).toMatchObject({
      product: 'Automóvel',
      insuredObject: 'FORD',
      policyNumber: '111',
      annualPremiumCents: 46138,
      bonusMalusPct: 45,
    });
    expect(next.coverages).toHaveLength(1);
    expect(withPolicyDocument(undefined, conditions).product).toBe('Automóvel Ligeiros');
  });
});
