import { describe, expect, it } from 'vitest';
import {
  checkSocialTariff,
  contractsWithSocialTariff,
  incomeLimit,
  isSocialDiscount,
  socialDiscountCents,
  socialTariffState,
} from './social-tariff';
import type { Contract, Invoice, InvoiceLine } from './types';

const byService = (checks: ReturnType<typeof checkSocialTariff>) =>
  Object.fromEntries(checks.map((check) => [check.service, check]));

function contract(overrides: Partial<Contract>): Contract {
  return {
    id: 'c1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    providerId: 'p1',
    sector: 'electricity',
    label: 'Luz',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('incomeLimit', () => {
  it('adds 50 % per member without income, the applicant included, up to 10', () => {
    expect(incomeLimit(627264, 0)).toBe(627264);
    expect(incomeLimit(627264, 1)).toBe(940896);
    expect(incomeLimit(627264, 2)).toBe(1254528);
    expect(incomeLimit(580800, 10)).toBe(3484800);
    expect(incomeLimit(580800, 14)).toBe(3484800);
  });
});

describe('checkSocialTariff', () => {
  it('a social benefit gives the right to all three, gas only for the 1st family allowance tier', () => {
    const csi = byService(checkSocialTariff({ benefits: ['csi'], membersWithoutIncome: 0 }));
    expect([csi.electricity?.eligible, csi.gas?.eligible, csi.internet?.eligible]).toEqual([
      true,
      true,
      true,
    ]);
    expect(csi.electricity?.reason).toBe('benefit');

    const allowance = byService(
      checkSocialTariff({ benefits: ['family_allowance_other'], membersWithoutIncome: 0 }),
    );
    expect(allowance.electricity?.eligible).toBe(true);
    expect(allowance.gas?.eligible).toBe(false);
    expect(allowance.internet?.eligible).toBe(true);

    const oldAge = byService(checkSocialTariff({ benefits: ['old_age'], membersWithoutIncome: 0 }));
    expect(oldAge.gas?.eligible).toBe(false);
  });

  it('the income criterion: electricity and internet have their own limits, gas has none', () => {
    // 7 000 € for a household with one member without income.
    const checks = byService(
      checkSocialTariff({ benefits: [], annualIncomeCents: 700000, membersWithoutIncome: 1 }),
    );
    expect(checks.electricity).toMatchObject({
      eligible: true,
      reason: 'income',
      incomeLimitCents: 940896,
    });
    expect(checks.internet).toMatchObject({ eligible: true, incomeLimitCents: 871200 });
    expect(checks.gas?.eligible).toBe(false);
    expect(checks.gas?.incomeLimitCents).toBeUndefined();

    const above = byService(
      checkSocialTariff({ benefits: [], annualIncomeCents: 627265, membersWithoutIncome: 0 }),
    );
    expect(above.electricity?.eligible).toBe(false);
    const unknown = byService(checkSocialTariff({ benefits: [], membersWithoutIncome: 0 }));
    expect(unknown.electricity?.eligible).toBe(false);
  });

  it('notes what the contracts in the app say', () => {
    const contracts = [
      contract({
        electricity: { powerKva: 10.35, cycle: 'simple', socialTariff: true },
      }),
      contract({ id: 'c2', sector: 'gas', gas: { escalao: 3 } }),
      contract({
        id: 'c3',
        active: false,
        electricity: { powerKva: 3.45, cycle: 'simple', socialTariff: false },
      }),
    ];
    const checks = byService(
      checkSocialTariff(
        { benefits: ['rsi'], membersWithoutIncome: 0 },
        contracts,
        new Set(['c1', 'c2', 'c3']),
      ),
    );
    expect(checks.electricity?.contractNotes).toEqual(['already', 'power_too_high']);
    expect(checks.gas?.contractNotes).toEqual(['already', 'gas_tier_too_high']);
    expect(checks.internet?.contractNotes).toEqual([]);
  });
});

function invoice(id: string, issueDate: string, contractId = 'c1'): Invoice {
  return {
    id,
    updatedAt: `${issueDate}T10:00:00.000Z`,
    contractId,
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate,
    totalCents: 5000,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: `${issueDate}T10:00:00.000Z`,
  };
}

function line(
  invoiceId: string,
  kind: InvoiceLine['kind'],
  description: string,
  amountCents: number,
): InvoiceLine {
  return {
    id: `${invoiceId}-${description}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    invoiceId,
    kind,
    description,
    amountCents,
  };
}

// As on Repsol invoices: the discounts, and the charge that funds the tariff (everyone pays it).
const withDiscount = (invoiceId: string) => [
  line(invoiceId, 'energy', 'Energia', 3000),
  line(invoiceId, 'discount', 'Desc. Social Redes Energia', -820),
  line(invoiceId, 'discount', 'Desc. Social Redes Termo Fixo', -20),
  line(invoiceId, 'other', 'Financ. T. Social (Dir. ERSE 3-4/2026)', 12),
];
const withoutDiscount = (invoiceId: string) => [
  line(invoiceId, 'energy', 'Energia', 3000),
  line(invoiceId, 'other', 'Financ. T. Social (Dir. ERSE 3-4/2026)', 12),
];

describe('social tariff discount', () => {
  it('counts the discount lines, not the charge that funds the tariff', () => {
    expect(isSocialDiscount({ kind: 'discount', description: 'Desc. Social Redes Potência' })).toBe(
      true,
    );
    expect(isSocialDiscount({ kind: 'other', description: 'Financ. T. Social' })).toBe(false);
    expect(socialDiscountCents(withDiscount('i1'))).toBe(840);
    expect(socialDiscountCents(withoutDiscount('i1'))).toBe(0);
  });
});

describe('socialTariffState', () => {
  const linesFrom = (lines: InvoiceLine[]) => (target: Invoice) =>
    lines.filter((candidate) => candidate.invoiceId === target.id);
  const gas = contract({ sector: 'gas' });

  it('active when the latest invoice has the discount', () => {
    const history = [invoice('i1', '2026-08-01'), invoice('i2', '2026-09-01')];
    const state = socialTariffState(
      gas,
      history,
      linesFrom([...withoutDiscount('i1'), ...withDiscount('i2')]),
    );
    expect(state).toMatchObject({ state: 'active', discountCents: 840 });
    expect(state?.invoice.id).toBe('i2');
  });

  it('lost when the previous invoice had it and the latest does not', () => {
    const history = [invoice('i2', '2026-09-01'), invoice('i1', '2026-08-01')];
    const state = socialTariffState(
      gas,
      history,
      linesFrom([...withDiscount('i1'), ...withoutDiscount('i2')]),
    );
    expect(state).toMatchObject({ state: 'lost', previousDiscountCents: 840 });
    expect(state?.state === 'lost' && state.previous.id).toBe('i1');
  });

  it('ignores invoices without lines, other sectors and contracts that never had it', () => {
    const history = [invoice('i1', '2026-08-01'), invoice('i2', '2026-09-01')];
    expect(socialTariffState(gas, history, linesFrom(withDiscount('i1')))?.state).toBe('active');
    expect(
      socialTariffState(contract({ sector: 'water' }), history, linesFrom(withDiscount('i2'))),
    ).toBeNull();
    expect(socialTariffState(gas, history, linesFrom(withoutDiscount('i2')))).toBeNull();
  });

  it('lists the contracts that have it', () => {
    const contracts = [contract({}), contract({ id: 'c2', sector: 'gas' })];
    const invoices = [invoice('i1', '2026-09-01'), invoice('i2', '2026-09-01', 'c2')];
    const lines = [...withDiscount('i1'), ...withoutDiscount('i2')];
    expect([...contractsWithSocialTariff(contracts, invoices, lines)]).toEqual(['c1']);
  });
});
