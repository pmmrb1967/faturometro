import { describe, expect, it } from 'vitest';
import { categoryShare, lastFromIssuer, spendingMonth, type SpendingData } from './spending';
import type { Contract, Invoice, RecurringExpense, SpendingTransaction } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function contract(id: string, sector: Contract['sector']): Contract {
  return { ...META, id, sector } as Contract;
}

function invoice(id: string, contractId: string, dueDate: string, totalCents: number): Invoice {
  return {
    ...META,
    id,
    contractId,
    providerId: 'p1',
    fileHash: id,
    docKey: `key-${id}`,
    docType: 'FT',
    issueDate: dueDate,
    dueDate,
    totalCents,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: META.updatedAt,
  };
}

function expense(extra: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    ...META,
    id: 'rent',
    name: 'Renda',
    amountCents: 65000,
    everyMonths: 1,
    dueDay: 8,
    startMonth: '2026-01',
    createdAt: META.updatedAt,
    ...extra,
  };
}

function purchase(
  id: string,
  date: string,
  amountCents: number,
  extra: Partial<SpendingTransaction> = {},
): SpendingTransaction {
  return {
    ...META,
    id,
    date,
    amountCents,
    category: 'food',
    description: '',
    source: 'manual',
    createdAt: META.updatedAt,
    ...extra,
  };
}

const empty: SpendingData = { invoices: [], expenses: [], transactions: [], contracts: [] };

describe('spendingMonth', () => {
  it('joins invoices, recurring expenses and purchases, newest first', () => {
    const summary = spendingMonth('2026-10', {
      contracts: [contract('light', 'electricity'), contract('car', 'insurance')],
      invoices: [
        invoice('i1', 'light', '2026-10-20', 4000),
        invoice('i2', 'car', '2026-10-02', 12000),
      ],
      expenses: [expense({ category: 'home' })],
      transactions: [purchase('t1', '2026-10-15', 2550)],
    });

    expect(summary.items.map((item) => item.id)).toEqual([
      'invoice-i1',
      'transaction-t1',
      'expense-rent-2026-10',
      'invoice-i2',
    ]);
    expect(summary.totalCents).toBe(83550);
    expect(summary.byCategory).toEqual([
      { category: 'home', totalCents: 65000 },
      { category: 'insurance', totalCents: 12000 },
      { category: 'bills', totalCents: 4000 },
      { category: 'food', totalCents: 2550 },
    ]);
  });

  it('leaves out forecasts and other months, and gives the previous total', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      transactions: [purchase('t1', '2026-09-30', 1000), purchase('t2', '2026-11-01', 500)],
    });
    expect(summary.items).toEqual([]);
    expect(summary.totalCents).toBe(0);
    expect(summary.previousTotalCents).toBe(1000);
  });

  it('puts expenses without a category and invoices without a contract in "other"', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      invoices: [invoice('i1', 'gone', '2026-10-20', 4000)],
      expenses: [expense()],
    });
    expect(summary.byCategory).toEqual([{ category: 'other', totalCents: 69000 }]);
  });

  it('does not count a purchase whose document was later added as an invoice', () => {
    const stored = invoice('i1', 'light', '2026-10-20', 4000);
    const summary = spendingMonth('2026-10', {
      ...empty,
      contracts: [contract('light', 'electricity')],
      invoices: [stored],
      transactions: [purchase('t1', '2026-10-19', 4000, { docKey: stored.docKey })],
    });
    expect(summary.totalCents).toBe(4000);
    expect(summary.items).toHaveLength(1);
  });

  it('takes refunds off the month and keeps the category when it nets to zero', () => {
    const summary = spendingMonth('2026-10', {
      ...empty,
      transactions: [purchase('t1', '2026-10-10', 1000), purchase('t2', '2026-10-11', -1000)],
    });
    expect(summary.totalCents).toBe(0);
    expect(summary.byCategory).toEqual([{ category: 'food', totalCents: 0 }]);
  });
});

describe('categoryShare', () => {
  it('is a whole percent of what was spent, ignoring negative categories', () => {
    const byCategory = [
      { category: 'food', totalCents: 7500 },
      { category: 'home', totalCents: 2500 },
      { category: 'other', totalCents: -1000 },
    ] as const;
    expect(categoryShare(7500, [...byCategory])).toBe(75);
    expect(categoryShare(-1000, [...byCategory])).toBe(0);
    expect(categoryShare(0, [])).toBe(0);
  });
});

describe('lastFromIssuer', () => {
  it('finds the newest purchase from a NIF', () => {
    const transactions = [
      purchase('t1', '2026-10-01', 100, { issuerNif: '123456789', description: 'Antiga' }),
      purchase('t2', '2026-10-09', 100, { issuerNif: '123456789', description: 'Nova' }),
      purchase('t3', '2026-10-20', 100, { issuerNif: '500000000' }),
    ];
    expect(lastFromIssuer(transactions, '123456789')?.description).toBe('Nova');
    expect(lastFromIssuer(transactions, '111111111')).toBeUndefined();
  });
});
