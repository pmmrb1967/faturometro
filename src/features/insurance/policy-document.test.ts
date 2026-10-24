import { describe, expect, it } from 'vitest';
import type { PolicyDocument } from '../../parsers/policy-documents';
import {
  NEW_CONTRACT,
  contractForDocument,
  contractFromDocument,
  samePolicy,
  withPolicyDocument,
} from './policy-document';

const renewal: PolicyDocument = {
  kind: 'renewal',
  issuerName: 'Generali Seguros',
  issuerNif: '500940231',
  policyNumber: '222',
  renewal: { date: '2026-11-01', currentCents: 39789, nextCents: 43251 },
};
const conditions: PolicyDocument = {
  kind: 'conditions',
  issuerName: 'Generali Seguros',
  issuerNif: '500940231',
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

  it('falls back to the only unnumbered insurance contract', () => {
    const other = { ...renewal, policyNumber: '999' };
    const unnumbered = { id: 'unnumbered', sector: 'insurance' as const, label: 'Seguro' };
    expect(contractForDocument([unnumbered, light], other)).toBe('unnumbered');
  });

  it('proposes a new contract for a policy number no contract has', () => {
    const other = { ...renewal, policyNumber: '999' };
    // The only policy has another number: another policy.
    expect(contractForDocument([car, light], other)).toBe(NEW_CONTRACT);
    expect(contractForDocument([car, home], other)).toBe(NEW_CONTRACT);
    expect(contractForDocument([light], other)).toBe(NEW_CONTRACT);
  });

  it('asks when the document has no policy number', () => {
    const unnumbered: PolicyDocument = { ...renewal, policyNumber: undefined };
    expect(contractForDocument([car, home], unnumbered)).toBe('');
    expect(contractForDocument([light], unnumbered)).toBe(NEW_CONTRACT);
  });
});

describe('contractFromDocument', () => {
  it('makes an insurance contract with the policy data', () => {
    const contract = contractFromDocument(conditions, {
      id: 'c1',
      providerId: 'p1',
      label: 'Seguro Automóvel',
      now: '2026-10-24T12:00:00.000Z',
    });
    expect(contract).toMatchObject({
      id: 'c1',
      providerId: 'p1',
      sector: 'insurance',
      label: 'Seguro Automóvel',
      active: true,
    });
    expect(contract.insurance).toMatchObject({ policyNumber: '111', annualPremiumCents: 46138 });
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

describe('samePolicy', () => {
  it('ignores leading zeros and spaces', () => {
    expect(samePolicy('0596735', '596735')).toBe(true);
    expect(samePolicy('596 735', '596735')).toBe(true);
    expect(samePolicy('596735', '596736')).toBe(false);
    expect(samePolicy(undefined, '1')).toBe(false);
  });
});
