import { describe, expect, it } from 'vitest';
import { checkSocialTariff, incomeLimit } from './social-tariff';
import type { Contract } from './types';

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
      checkSocialTariff({ benefits: ['rsi'], membersWithoutIncome: 0 }, contracts),
    );
    expect(checks.electricity?.contractNotes).toEqual(['already', 'power_too_high']);
    expect(checks.gas?.contractNotes).toEqual(['gas_tier_too_high']);
    expect(checks.internet?.contractNotes).toEqual([]);
  });
});
