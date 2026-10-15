import { describe, expect, it } from 'vitest';
import { billingFrequency, byGroup, groupOf } from './grouping';
import type { Sector } from './types';

describe('groups', () => {
  it('puts electricity and gas together, and keeps the group order', () => {
    expect(groupOf('gas')).toBe('energy');
    expect(groupOf('water')).toBe('water');
    const items: { id: string; sector: Sector }[] = [
      { id: 'seguro', sector: 'insurance' },
      { id: 'luz', sector: 'electricity' },
      { id: 'net', sector: 'telecom' },
      { id: 'gas', sector: 'gas' },
    ];
    expect(
      byGroup(items, (item) => item.sector).map(({ group, items }) => [
        group,
        items.map((item) => item.id),
      ]),
    ).toEqual([
      ['energy', ['luz', 'gas']],
      ['telecom', ['net']],
      ['insurance', ['seguro']],
    ]);
  });
});

describe('billingFrequency', () => {
  it('names the usual billing periods', () => {
    expect(billingFrequency('2026-09-01', '2026-09-30')).toBe('monthly');
    expect(billingFrequency('2026-02-01', '2026-02-28')).toBe('monthly');
    expect(billingFrequency('2026-03-04', '2026-05-04')).toBe('bimonthly');
    expect(billingFrequency('2026-01-01', '2026-03-31')).toBe('quarterly');
    expect(billingFrequency('2026-01-01', '2026-06-30')).toBe('semiannual');
    expect(billingFrequency('2025-11-01', '2026-10-31')).toBe('annual');
  });

  it('says nothing without a period or for an irregular one', () => {
    expect(billingFrequency(undefined, '2026-09-30')).toBeUndefined();
    expect(billingFrequency('2026-09-01', '2026-09-14')).toBeUndefined();
  });
});
