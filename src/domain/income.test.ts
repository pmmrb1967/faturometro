import { describe, expect, it } from 'vitest';
import { incomeMonth } from './income';
import { withAmountFrom } from './month';
import type { Income } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function income(id: string, extra: Partial<Income> = {}): Income {
  return {
    ...META,
    id,
    kind: 'salary',
    name: '',
    amountCents: 150000,
    everyMonths: 1,
    dueDay: 28,
    startMonth: '2026-01',
    createdAt: META.updatedAt,
    ...extra,
  };
}

describe('incomeMonth', () => {
  it('adds up what comes in, first to come in first', () => {
    const month = incomeMonth('2026-10', [
      income('salary'),
      income('rent', { kind: 'rent', amountCents: 50000, dueDay: 5 }),
    ]);
    expect(month.items.map((item) => item.date)).toEqual(['2026-10-05', '2026-10-28']);
    expect(month.totalCents).toBe(200000);
  });

  it('counts only between the first and last month', () => {
    const stopped = income('old', { startMonth: '2026-03', endMonth: '2026-09' });
    expect(incomeMonth('2026-02', [stopped]).totalCents).toBe(0);
    expect(incomeMonth('2026-09', [stopped]).totalCents).toBe(150000);
    expect(incomeMonth('2026-10', [stopped]).items).toEqual([]);
  });

  it('counts a one-off income only in its month', () => {
    const bonus = income('bonus', {
      kind: 'bonus',
      oneOff: true,
      startMonth: '2026-07',
      endMonth: '2026-07',
    });
    expect(incomeMonth('2026-07', [bonus]).totalCents).toBe(150000);
    expect(incomeMonth('2026-08', [bonus]).totalCents).toBe(0);
  });

  it('counts a quarterly income in its months', () => {
    const interest = income('interest', {
      kind: 'interest',
      everyMonths: 3,
      startMonth: '2026-01',
    });
    expect(incomeMonth('2026-04', [interest]).items).toHaveLength(1);
    expect(incomeMonth('2026-05', [interest]).items).toHaveLength(0);
  });

  it('keeps the old amount before a raise', () => {
    const raised = withAmountFrom(income('salary'), '2026-07', 160000);
    expect(incomeMonth('2026-06', [raised]).totalCents).toBe(150000);
    expect(incomeMonth('2026-07', [raised]).totalCents).toBe(160000);
  });

  it('uses the last day of a shorter month', () => {
    const late = income('late', { dueDay: 31 });
    expect(incomeMonth('2026-02', [late]).items[0]?.date).toBe('2026-02-28');
  });
});
